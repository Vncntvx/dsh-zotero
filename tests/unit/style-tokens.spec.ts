/**
 * The palette snapshot's own rules, driven through the same functions the CLI
 * runs (`scripts/style-tokens.mjs`).
 *
 * The snapshot is what makes the client style guard enforceable at all: CI has
 * no sibling harness checkout, so the published `--dsw-*` names are committed
 * rather than read at test time. That trade has one failure mode — a snapshot
 * that stops describing the pinned harness — so it is asserted here rather
 * than left to whoever remembers to rerun `--write`.
 *
 * The `--dsh-*` half is hand-maintained, because those seams are published by
 * host code at runtime and no stylesheet defines them. `--write` carries them
 * over, which is asserted too: regenerating the palette must never quietly
 * erase the seam list.
 * @module tests/unit/style-tokens
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectThemeTokens,
  diffTokens,
  mergeThemeTokens,
  pinnedHarness,
  snapshotOf,
} from '../../scripts/style-tokens.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const snapshot = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'style-tokens.json'), 'utf8'),
)
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('pinnedHarness', () => {
  it('reads the pin from dependencies before devDependencies', () => {
    expect(pinnedHarness({ dependencies: { '@deepseek-ai/dsh-client-ui-theme': '1.2.3' } })).toBe(
      '1.2.3',
    )
    expect(
      pinnedHarness({ devDependencies: { '@deepseek-ai/dsh-client-ui-primitives': '4.5.6' } }),
    ).toBe('4.5.6')
  })

  it('is empty when no harness line is declared, rather than undefined', () => {
    expect(pinnedHarness({})).toBe('')
    expect(pinnedHarness(undefined)).toBe('')
  })
})

describe('collectThemeTokens', () => {
  it('collects a definition and ignores a reference', () => {
    const css = ':root { --dsw-alias-bg-base: #fff; } .a { background: var(--dsw-alias-bg-base); }'
    expect(collectThemeTokens(css)).toEqual(['--dsw-alias-bg-base'])
  })

  it('ignores a definition that only survives in a comment', () => {
    const css = ['/* --dsw-alias-retired: #000; */', ':root { --dsw-alias-live: #fff; }'].join('\n')
    expect(collectThemeTokens(css)).toEqual(['--dsw-alias-live'])
  })

  it('collects every definition of a token, deduplicated by the merge', () => {
    const sheets: Record<string, string> = {
      'light.css': ':root { --dsw-alias-bg-base: #fff; --dsw-alias-label-primary: #111; }',
      'dark.css': 'body[data-ds-dark-theme] { --dsw-alias-bg-base: #000; }',
    }
    const read = (name: string) => sheets[name] ?? ''
    expect(mergeThemeTokens(read, ['light.css', 'dark.css'])).toEqual([
      '--dsw-alias-bg-base',
      '--dsw-alias-label-primary',
    ])
  })
})

describe('diffTokens', () => {
  it('reports both directions, sorted, and nothing when they agree', () => {
    expect(diffTokens(['--dsw-b'], ['--dsw-a', '--dsw-b'])).toEqual({
      missing: ['--dsw-a'],
      removed: [],
    })
    expect(diffTokens(['--dsw-a', '--dsw-b'], ['--dsw-b'])).toEqual({
      missing: [],
      removed: ['--dsw-a'],
    })
    expect(diffTokens(['--dsw-a'], ['--dsw-a'])).toEqual({ missing: [], removed: [] })
  })
})

describe('snapshotOf', () => {
  it('carries the hand-maintained seam list across a regeneration', () => {
    const current = { harness: '0.0.0', dsw: ['--dsw-old'], dsh: ['--dsh-content-font-size'] }
    expect(snapshotOf(current, { harness: '1.0.0', dsw: ['--dsw-new'] })).toEqual({
      harness: '1.0.0',
      dsw: ['--dsw-new'],
      dsh: ['--dsh-content-font-size'],
    })
  })

  it('starts an absent seam list empty rather than undefined', () => {
    expect(snapshotOf(undefined, { harness: '1.0.0', dsw: [] })).toEqual({
      harness: '1.0.0',
      dsw: [],
      dsh: [],
    })
  })
})

describe('the committed snapshot', () => {
  it('describes the harness this repository pins', () => {
    expect(
      snapshot.harness,
      'the palette snapshot is stale; run node scripts/style-tokens.mjs --write',
    ).toBe(pinnedHarness(manifest))
  })

  it('is sorted and unique on both halves', () => {
    for (const half of ['dsw', 'dsh']) {
      const names = snapshot[half]
      expect(names).toEqual([...new Set(names)].sort())
    }
  })

  it('publishes a palette worth guarding', () => {
    expect(snapshot.dsw.length).toBeGreaterThan(300)
  })

  it('lists the runtime seams this plugin consumes', () => {
    expect(snapshot.dsh).toContain('--dsh-content-font-size')
    expect(snapshot.dsh).toContain('--dsh-composer-height')
  })
})
