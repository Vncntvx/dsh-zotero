/**
 * The pack gate's pure helpers. `npm pack --json` stdout is not always pure
 * JSON: a version-pinned npm runs `prepare` even under `--ignore-scripts` and
 * prints its output first, which used to fail `JSON.parse` on the whole
 * stream. The locator keeps the gate green on either kind of npm. The path
 * resolver enumerates wildcard exports from disk instead of restating them —
 * and fails loud when a declared pattern has nothing behind it, so the gate
 * can never narrow itself to "assert only what exists".
 * @module tests/unit/verify-pack
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectedPaths, packReportOf } from '../../scripts/verify-pack.mjs'

const REPORT = '[\n  {\n    "name": "dsh-zotero"\n  }\n]'

/** The real manifest's locale shape, read from the repository root. */
const MANIFEST = {
  main: './lib/index.js',
  exports: { '.': './lib/index.js', './locale/*.json': './locale/*.json' },
  files: ['lib', 'locale'],
}

describe('packReportOf', () => {
  it('parses a stream that is already the report', () => {
    expect(JSON.parse(packReportOf(REPORT))).toEqual([{ name: 'dsh-zotero' }])
  })

  it('drops the lifecycle script output npm prints ahead of the report', () => {
    const polluted = `prepare skipped: a full build is already present (127 outputs)\n${REPORT}`
    expect(JSON.parse(packReportOf(polluted))).toEqual([{ name: 'dsh-zotero' }])
  })

  it('accepts the name-keyed object npm answers on newer versions', () => {
    const objectShape = `transpiled 63 Node-half module(s) into lib/\n{"dsh-zotero": {"files": []}}\n`
    expect(JSON.parse(packReportOf(objectShape))).toEqual({ 'dsh-zotero': { files: [] } })
  })

  it('refuses a stream with no report at all instead of parsing prose', () => {
    expect(() => packReportOf('prepare failed\n')).toThrow(/printed no JSON report/)
    expect(() => packReportOf('')).toThrow(/printed no JSON report/)
  })
})

/** Run an assertion against a temporary directory cleaned at exit. */
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'verify-pack-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('expectedPaths', () => {
  it('enumerates the locale bundles the repository actually ships', () => {
    const { paths, problems } = expectedPaths(MANIFEST)
    expect(problems).toEqual([])
    expect(paths).toContain('locale/en.json')
    expect(paths).toContain('locale/zh.json')
    expect(paths).toContain('lib/index.js')
  })

  it('reports a declared locale wildcard with an empty directory on disk', async () => {
    // An empty `locale/`: the manifest still promises the dictionaries, so
    // the gate must fail instead of asserting nothing.
    await withTempDir(async (root) => {
      await mkdir(join(root, 'lib'), { recursive: true })
      await mkdir(join(root, 'locale'), { recursive: true })
      const { paths, problems } = expectedPaths(MANIFEST, root)
      expect(paths).not.toContain('locale/en.json')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('declares the locale export "./locale/*.json"')
      expect(problems[0]).toContain('carries no *.json bundle')
    })
  })

  it('reports a non-locale wildcard export whose directory is gone', async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, 'README.md'), 'x', 'utf8')
      const manifest = { files: ['README.md'], exports: { './styles/*.css': './styles/*.css' } }
      const { problems } = expectedPaths(manifest, root)
      expect(problems).toEqual([
        'the manifest declares the wildcard export "./styles/*.css" but ./styles does not exist' +
          ' on disk — the tarball would ship an export that resolves to nothing',
      ])
    })
  })

  it('reports a files entry that the disk never had', async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, 'README.md'), 'x', 'utf8')
      const manifest = { files: ['README.md', 'nodir'] }
      const { problems } = expectedPaths(manifest, root)
      expect(problems).toEqual(['the manifest "files" entry "nodir" does not exist on disk'])
    })
  })

  it('leaves a manifest with no locale wildcard alone', () => {
    const { paths, problems } = expectedPaths({ main: './lib/index.js' }, '/nonexistent-root')
    expect(problems).toEqual([])
    expect(paths).toEqual(['README.md', 'lib/index.js', 'package.json'])
  })

  it('includes non-directory entries from manifest.files such as README.en.md', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'lib'), { recursive: true })
      await mkdir(join(root, 'locale'), { recursive: true })
      await writeFile(join(root, 'lib', 'index.js'), 'x', 'utf8')
      await writeFile(join(root, 'README.md'), 'x', 'utf8')
      await writeFile(join(root, 'README.en.md'), 'x', 'utf8')
      await writeFile(join(root, 'cordis.patch.yml'), 'x', 'utf8')
      const manifest = {
        main: './lib/index.js',
        files: ['lib', 'README.md', 'README.en.md', 'cordis.patch.yml', 'locale'],
      }
      const { paths, problems } = expectedPaths(manifest, root)
      expect(problems).toEqual([])
      expect(paths).toContain('README.en.md')
      expect(paths).toContain('cordis.patch.yml')
      expect(paths).toContain('README.md')
      expect(paths).toContain('package.json')
      expect(paths).toContain('lib/index.js')
      expect(paths).not.toContain('lib')
      expect(paths).not.toContain('locale')
    })
  })
})
