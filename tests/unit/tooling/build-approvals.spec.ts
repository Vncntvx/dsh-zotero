/**
 * The profile build approvals the packed plugin needs, kept honest on both
 * sides: the production dependency tree in `package-lock.json` and the install
 * docs a user reads. `onnxruntime-web` pulls `protobufjs`, whose postinstall is
 * an undecided build script to pnpm 11; approving one is a real permission, so
 * this ledger fails when a new dependency needs one or when an approval no
 * longer has anything to run.
 *
 * Scope: the repository's own declaration surface — the lockfile's production
 * tree. A consumer resolving wider semver ranges can differ; the discovery
 * smoke covers that end to end.
 * @module tests/unit/build-approvals
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APPROVED_BUILD_SCRIPTS,
  approvalGaps,
  buildScriptHooksOf,
} from '../../../scripts/shared/build-approvals.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

interface Lockfile {
  readonly packages: Record<string, { readonly dev?: boolean }>
}

/** Every name in the lockfile's production tree whose manifest declares an install hook. */
function declaredBuildScripts(): string[] {
  const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8')) as Lockfile
  const declared: string[] = []
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '' || entry.dev === true) continue
    const manifest = JSON.parse(readFileSync(join(repoRoot, path, 'package.json'), 'utf8')) as {
      readonly name?: string
      readonly scripts?: Record<string, string>
    }
    if (buildScriptHooksOf(manifest).length > 0) declared.push(manifest.name ?? path)
  }
  return declared
}

describe('the profile build approvals', () => {
  it('covers exactly the production dependencies that declare an install script', () => {
    const { missing, stale } = approvalGaps(declaredBuildScripts())
    expect(
      missing,
      'add each name to APPROVED_BUILD_SCRIPTS and name it in the install docs, or drop the dependency',
    ).toEqual([])
    expect(stale, 'an approval with nothing left to run hides the next change').toEqual([])
  })

  it('names every approved script in the install and troubleshooting docs', () => {
    const docs = ['getting-started', 'troubleshooting'].flatMap((name) => [
      join(repoRoot, `docs/${name}.md`),
      join(repoRoot, `docs/${name}.en.md`),
    ])
    for (const doc of docs) {
      const text = readFileSync(doc, 'utf8')
      for (const name of APPROVED_BUILD_SCRIPTS) {
        expect(text, `${doc} must name the approved build script ${name}`).toContain(name)
      }
    }
  })
})
