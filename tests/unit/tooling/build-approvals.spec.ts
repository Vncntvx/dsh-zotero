/**
 * The profile build approvals the packed plugin needs — none, on purpose.
 *
 * `onnxruntime-web` pulls `protobufjs`, whose postinstall is a no-op, and pnpm
 * 11 fails an install while any dependency script has no decision. The plugin
 * therefore vendors that runtime's build artifacts into `assets/onnxruntime/` so
 * the published dependency closure remains free of install scripts. The user
 * downloads only the embedding model when enabling semantic ranking. This
 * ledger fails when a production dependency grows an install script, or when an
 * approval no longer has anything to run.
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
import { approvalGaps } from '../../../scripts/shared/build-approvals.mjs'
import { installScriptsInRuntimeClosure } from '../../../scripts/verify-pack.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Every name in the published runtime closure that declares an install script. */
function declaredBuildScripts(): string[] {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8')) as Record<
    string,
    unknown
  >
  return installScriptsInRuntimeClosure(manifest, lockfile).map((s) =>
    s.slice(0, s.lastIndexOf('@')),
  )
}

describe('the profile build approvals', () => {
  it('keeps the production dependency tree free of install scripts', () => {
    const { missing, stale } = approvalGaps(declaredBuildScripts())
    expect(
      missing,
      'a production dependency declares an install script; pnpm 11 fails every install until the profile approves it. ' +
        "Vendor that package's build artifacts (as scripts/vendor-onnxruntime.mjs does for onnxruntime-web), or add " +
        'it to APPROVED_BUILD_SCRIPTS and name it in the install and troubleshooting docs',
    ).toEqual([])
    expect(stale, 'an approval with nothing left to run hides the next change').toEqual([])
  })
})
