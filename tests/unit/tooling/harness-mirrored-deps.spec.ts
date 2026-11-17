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
import { mirroredDeclarationsOf } from '../../../scripts/shared/harness-packages.mjs'
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

describe('immutable-tag dependency declarations', () => {
  it('merges client ranges once and takes root types only when clients omit them', () => {
    const tree = new Map([
      ['ls-tree --name-only -d dsh-vtest:packages/client', 'zeta\nalpha\n'],
      [
        'show dsh-vtest:packages/client/zeta/package.json',
        JSON.stringify({ dependencies: { zod: '^4.0.0', '@types/a': '^1.0.0', invalid: 7 } }),
      ],
      [
        'show dsh-vtest:packages/client/alpha/package.json',
        JSON.stringify({
          dependencies: { zod: '^3.0.0' },
          devDependencies: { zod: '^4.0.0', react: '^19.0.0' },
        }),
      ],
      [
        'show dsh-vtest:package.json',
        JSON.stringify({
          dependencies: { '@types/a': '^2.0.0', '@types/b': '^1.0.0', server: '^9.0.0' },
        }),
      ],
    ])
    const requested: string[] = []
    const actual = mirroredDeclarationsOf((args) => {
      const command = args.join(' ')
      requested.push(command)
      const value = tree.get(command)
      if (value === undefined) throw new Error(`unexpected git command: ${command}`)
      return value
    }, 'dsh-vtest')
    expect(actual).toEqual({
      '@types/a': ['^1.0.0'],
      '@types/b': ['^1.0.0'],
      react: ['^19.0.0'],
      zod: ['^3.0.0', '^4.0.0'],
    })
    expect(Object.keys(actual)).toEqual(['@types/a', '@types/b', 'react', 'zod'])
    expect(requested).toEqual([...tree.keys()])
  })

  it('propagates an unreadable or malformed tag instead of returning an empty authority', () => {
    const unavailable = new Error('tag unavailable')
    expect(() =>
      mirroredDeclarationsOf(() => {
        throw unavailable
      }, 'dsh-vmissing'),
    ).toThrow(unavailable)
    expect(() =>
      mirroredDeclarationsOf((args) => (args[0] === 'ls-tree' ? 'client\n' : '{bad'), 'dsh-vbad'),
    ).toThrow(SyntaxError)
  })
})
