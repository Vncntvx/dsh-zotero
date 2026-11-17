/** The tarball and published tree must carry identical, proven bytes. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { writeBuildState } from '../../../scripts/build-state.mjs'
import {
  prepareReleaseArtifact,
  verifyReleaseArtifact,
} from '../../../scripts/release-artifact.mjs'
import { withTempDir } from '../../helpers/temp-dir.js'

async function artifact(root: string) {
  const base = join(root, 'source')
  await mkdir(join(base, 'lib'), { recursive: true })
  await writeFile(
    join(base, 'package.json'),
    JSON.stringify({
      name: 'dsh-zotero',
      version: '1.0.0',
      main: './lib/index.js',
      types: './lib/index.d.ts',
      files: ['lib'],
      scripts: { prepare: 'exit 91' },
      devDependencies: { dangerous: '1.0.0' },
      peerDependencies: { dangerous: '>=1.0.0' },
      overrides: { dangerous: '1.0.0' },
    }),
  )
  await writeFile(join(base, 'lib/index.js'), 'export const answer = 42')
  await writeFile(join(base, 'lib/index.d.ts'), 'export declare const answer: 42')
  await writeFile(join(base, 'LICENSE'), 'MIT')
  await writeFile(join(base, '.gitignore'), 'lib/.build-state.json\n')
  execFileSync('git', ['init', '--quiet'], { cwd: base })
  execFileSync('git', ['add', '.'], { cwd: base })
  execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: base },
  )
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim()
  writeBuildState(base)
  const out = join(root, 'artifact')
  return { out, sha, verified: prepareReleaseArtifact(out, sha, base) }
}

it('packs public declarations and removes install-time code from the checked artifact', async () => {
  await withTempDir(async (root) => {
    const { verified, out, sha } = await artifact(root)
    const manifest = JSON.parse(await readFile(join(verified.stage, 'package.json'), 'utf8'))
    expect(manifest.scripts).toBeUndefined()
    expect(manifest.devDependencies).toBeUndefined()
    expect(manifest.overrides).toBeUndefined()
    expect(manifest.peerDependencies).toEqual({ dangerous: '>=1.0.0' })
    expect(verifyReleaseArtifact(out, sha).provenance.files).toHaveProperty('lib/index.d.ts')
  })
})

it('rejects changed bytes, extra files and source identity substitution', async () => {
  await withTempDir(async (root) => {
    const { verified, out, sha } = await artifact(root)
    expect(() => verifyReleaseArtifact(out, 'b'.repeat(40))).toThrow('identity')
    await writeFile(join(verified.stage, 'unexpected-secret'), 'secret')
    expect(() => verifyReleaseArtifact(out, sha)).toThrow('digest mismatch')
  })
})

it('rejects a substituted tarball even if its envelope digest is updated', async () => {
  await withTempDir(async (root) => {
    const { verified, out, sha } = await artifact(root)
    const substitute = join(root, 'substitute')
    await mkdir(substitute)
    await writeFile(join(substitute, 'package.json'), '{"name":"substitute","version":"1.0.0"}')
    const packed = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', substitute],
        { cwd: substitute, encoding: 'utf8' },
      ),
    )
    const report = (Array.isArray(packed) ? packed : Object.values(packed))[0]
    const bytes = await readFile(join(substitute, report.filename))
    await writeFile(verified.tarball, bytes)
    const envelopePath = join(out, 'artifact.json')
    const envelope = JSON.parse(await readFile(envelopePath, 'utf8'))
    envelope.tarballSha256 = createHash('sha256').update(bytes).digest('hex')
    await writeFile(envelopePath, JSON.stringify(envelope))
    expect(() => verifyReleaseArtifact(out, sha)).toThrow('does not match')
  })
})
