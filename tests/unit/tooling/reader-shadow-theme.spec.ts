/**
 * The Reader's shadow root is outside the reach of both the host theme rules and
 * `npm run style:check` (which scans `src/**\/*.css`), so the block that
 * `scripts/build-reader-pdf.mjs` appends behind the PDF.js sheet carries the
 * palette contract by itself: every colour is a `--dsw-*` alias, never a literal
 * or a self-owned palette.
 * @module tests/unit/tooling/reader-shadow-theme
 */

import { describe, expect, it } from 'vitest'
import { shadowTheme } from '../../../scripts/build-reader-pdf.mjs'

describe('the Reader shadow theme block', () => {
  it('states no colour literal of its own', () => {
    expect(shadowTheme).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|light-dark\(/)
  })

  it('reads the palette through --dsw-* aliases only', () => {
    const references = shadowTheme.match(/var\(--[a-z0-9-]+/g) ?? []
    expect(references.length).toBeGreaterThan(0)
    expect(references.filter((reference) => !reference.startsWith('var(--dsw-'))).toEqual([])
  })

  it('pairs every full-round radius with corner-shape: round', () => {
    // The theme's universal corner cap does not cross the shadow boundary, so a
    // 50% radius would render as a squircle without its own pairing.
    const rounds = shadowTheme.match(/[^{}]*\{[^{}]*border-radius: ?50%[^{}]*\}/g) ?? []
    expect(rounds.length).toBeGreaterThan(0)
    for (const rule of rounds) expect(rule).toContain('corner-shape:round')
  })

  it('owns the focus ring the host cannot reach across the shadow boundary', () => {
    expect(shadowTheme).toContain('--dsw-focus-ring-color')
    expect(shadowTheme).toContain(':focus-visible')
  })
})
