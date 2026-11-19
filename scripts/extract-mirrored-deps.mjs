/**
 * Extract the pinned upstream client-dependency declarations into
 * `tests/fixtures/harness-mirrored-deps-pin.json`.
 *
 * The browser bundle's third-party runtime dependencies mirror the sibling's
 * `packages/client/*` manifests at the pin tag. `scripts/harness-state.mjs`
 * reads the tag directly when a sibling checkout is present; on a registry-only
 * install (CI) it falls back to this fixture, so the gate has an authority
 * there too. A pin bump must re-extract it, and the unit suite fails when the
 * fixture's pin disagrees with the manifest.
 *
 * Usage: node scripts/extract-mirrored-deps.mjs <version> [harnessRoot]
 * @module scripts/extract-mirrored-deps
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mirroredDeclarationsOf } from './shared/harness-packages.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(root, 'tests', 'fixtures', 'harness-mirrored-deps-pin.json')

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (version === undefined) {
    console.error('usage: node scripts/extract-mirrored-deps.mjs <version> [harnessRoot]')
    process.exit(1)
  }
  const harnessRoot = process.argv[3] ?? join(root, '..', 'deepseek-harness')
  const tag = `dsh-v${version}`
  /** @param {string[]} args */
  const run = (args) => execFileSync('git', ['-C', harnessRoot, ...args], { encoding: 'utf8' })
  const declarations = mirroredDeclarationsOf(run, tag)
  writeFileSync(
    fixture,
    `${JSON.stringify(
      {
        pin: tag,
        source:
          'packages/client/*/package.json (plus @types/* from the root manifest) at the pin tag',
        note: `Extract after a pin bump with: node scripts/extract-mirrored-deps.mjs ${version}`,
        declarations,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`extract-mirrored-deps: wrote ${Object.keys(declarations).length} names from ${tag}`)
}
