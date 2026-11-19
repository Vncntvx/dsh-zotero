/**
 * Feature CSS keeps type emphasis at or below 500. This suite exercises the
 * weight ceiling and the focus-state border exemption.
 * @module tests/unit/style-guard-weight
 */
import { describe, expect, it } from 'vitest'
import {
  type TokenPalette,
  fontWeightViolations,
  stateBorderViolations,
} from '../../../scripts/style-guard.mjs'

/** One stylesheet, as the guards receive it. */
const sheet = (css: string) => ({ file: 'probe.module.css', css })

/** The palette a synthetic case resolves against. */
const KNOWN = {
  dsw: ['--dsw-alias-label-primary', '--dsw-alias-state-business-primary', '--dsw-alias-border-l4'],
  dsh: ['--dsh-content-font-size'],
  ds: ['--ds-ease-in-out'],
} satisfies TokenPalette

describe('fontWeightViolations', () => {
  it('accepts 500 and a token role', () => {
    expect(fontWeightViolations(sheet('.a { font-weight: 500; }'), KNOWN)).toEqual([])
    expect(
      fontWeightViolations(sheet('.a { font: var(--dsw-font-xs-strong-13); }'), KNOWN),
    ).toEqual([])
  })

  it('fires on 600 in the longhand and in the shorthand', () => {
    expect(fontWeightViolations(sheet('.a { font-weight: 600; }'), KNOWN)).toHaveLength(1)
    expect(
      fontWeightViolations(sheet('.a { font: 600 13px/20px sans-serif; }'), KNOWN),
    ).toHaveLength(1)
  })

  it('fires on the bold keywords', () => {
    expect(fontWeightViolations(sheet('.a { font-weight: bold; }'), KNOWN)).toHaveLength(1)
  })
})

describe('stateBorderViolations focus exemption', () => {
  it('lets focus feedback keep the field width the host Input uses', () => {
    const css = [
      '.field { border: 0.5px solid var(--dsw-alias-border-l4); }',
      '.field:focus-visible { border-color: var(--dsw-alias-state-business-primary); }',
    ].join('\n')
    expect(stateBorderViolations(sheet(css), KNOWN)).toEqual([])
  })
})
