/**
 * The parsing preferences contract: defaults, omitted-field resolution, and
 * refusal of malformed values (which are never repaired).
 * @module tests/unit/parsing-preferences
 */

import { describe, expect, it } from 'vitest'
import {
  isParsingOutputDirPath,
  PARSING_DEFAULTS,
  PARSING_MODE_CHOICES,
  PARSING_PREFERENCE_KEYS,
  parsingPreferencesOf,
} from '../../src/parsing-preferences.ts'

describe('parsing preferences', () => {
  it('defaults to the free mode with egress off and no output override', () => {
    expect(parsingPreferencesOf({})).toEqual({
      mode: 'free',
      mineruTokenRef: '',
      allowParsingUpload: false,
      outputDir: '',
    })
    expect(PARSING_MODE_CHOICES).toEqual(['free', 'pro'])
    expect(PARSING_PREFERENCE_KEYS).toEqual([
      'mode',
      'mineruTokenRef',
      'allowParsingUpload',
      'outputDir',
    ])
  })

  it('keeps the mode independent from the token reference', () => {
    // A configured token does not force pro, and pro does not require the
    // caller to have set one — the switch alone decides.
    expect(
      parsingPreferencesOf({ mode: 'free', mineruTokenRef: 'MINERU_API_TOKEN' }),
    ).toMatchObject({ mode: 'free', mineruTokenRef: 'MINERU_API_TOKEN' })
    expect(parsingPreferencesOf({ mode: 'pro', mineruTokenRef: '' })).toMatchObject({
      mode: 'pro',
      mineruTokenRef: '',
    })
  })

  it('refuses a mode outside the closed set instead of repairing it', () => {
    expect(() => parsingPreferencesOf({ mode: 'turbo' })).toThrow(
      'Invalid parsing preference: mode',
    )
  })

  it('refuses non-boolean egress and non-string text fields', () => {
    expect(() => parsingPreferencesOf({ allowParsingUpload: 'yes' })).toThrow(
      'Invalid parsing preference: allowParsingUpload',
    )
    expect(() => parsingPreferencesOf({ outputDir: 7 })).toThrow(
      'Invalid parsing preference: outputDir',
    )
    expect(() => parsingPreferencesOf({ mineruTokenRef: null })).toThrow(
      'Invalid parsing preference: mineruTokenRef',
    )
  })

  it('freezes the resolved value', () => {
    expect(Object.isFrozen(parsingPreferencesOf({}))).toBe(true)
    expect(Object.isFrozen(PARSING_DEFAULTS)).toBe(true)
  })

  it('accepts only absolute-shaped output directories', () => {
    expect(isParsingOutputDirPath('')).toBe(true)
    expect(isParsingOutputDirPath('/tmp/parsed')).toBe(true)
    expect(isParsingOutputDirPath('~/parsed')).toBe(true)
    expect(isParsingOutputDirPath('C:\\parsed')).toBe(true)
    expect(isParsingOutputDirPath('\\\\server\\share')).toBe(true)
    expect(isParsingOutputDirPath('papers')).toBe(false)
    expect(isParsingOutputDirPath('~docs/papers')).toBe(false)
  })
})
