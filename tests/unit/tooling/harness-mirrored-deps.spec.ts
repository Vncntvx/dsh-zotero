/**
 * The mirrored client dependencies and the pin they were read under.
 *
 * The browser bundle ships its third-party runtime dependencies as host
 * modules, so their floors must match the sibling's client manifests at the pin
 * tag — they move with the harness, never on their own. With a sibling checkout
 * `harness-state` reads the tag; with a registry-only install (CI) it reads the
 * committed fixture. This spec is what keeps the fixture honest: a pin bump
 * that forgets to re-extract it, or a mirror floor that drifted, fails here.
 * @module tests/unit/harness-mirrored-deps
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HARNESS_MIRRORED } from '../../../scripts/shared/harness-mirrored-deps.mjs'
import { clientDepsMirrorProblems } from '../../../scripts/harness-state.mjs'
import { pinnedHarness } from '../../../scripts/style-tokens.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixturePath = join(repoRoot, 'tests/fixtures/harness-mirrored-deps-pin.json')

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  pin: string
  declarations: Record<string, string[]>
}
const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** The mirrors the manifest actually declares, the way the gate collects them. */
function localRanges(): Map<string, string> {
  const ranges = new Map<string, string>()
  for (const section of ['dependencies', 'devDependencies'] as const) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (HARNESS_MIRRORED.has(name)) ranges.set(name, range)
    }
  }
  return ranges
}

describe('the mirrored client dependencies at the pin', () => {
  it('describes the harness this repository pins', () => {
    expect(
      fixture.pin,
      'the mirror fixture is stale; re-extract with node scripts/extract-mirrored-deps.mjs <version>',
    ).toBe(`dsh-v${pinnedHarness(manifest)}`)
  })

  it('covers every mirrored name', () => {
    const missing = [...HARNESS_MIRRORED].filter((name) => fixture.declarations[name] === undefined)
    expect(missing).toEqual([])
  })

  it('declares a local floor the pin tag also declares', () => {
    const { problems, notes } = clientDepsMirrorProblems(
      HARNESS_MIRRORED,
      localRanges(),
      new Map(Object.entries(fixture.declarations)),
    )
    expect(problems).toEqual([])
    // A name the sibling spells with two floors is reported, not failed; the
    // note is part of the accepted answer, not a defect.
    expect(notes.every((note) => note.includes('matches one of them'))).toBe(true)
  })

  it('fails when a mirror floor drifts above the pin tag', () => {
    const drifted = new Map(localRanges())
    drifted.set('zod', '4.7.0')
    const { problems } = clientDepsMirrorProblems(
      HARNESS_MIRRORED,
      drifted,
      new Map(Object.entries(fixture.declarations)),
    )
    expect(problems.join('\n')).toContain('zod')
  })
})
