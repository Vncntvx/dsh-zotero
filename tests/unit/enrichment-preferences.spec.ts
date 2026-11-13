import { ARTIFACT_READER_DEFAULTS } from '../../src/artifact-reader-preferences.ts'
/**
 * The enrichment preferences contract: defaults, omitted-field resolution, and
 * refusal of malformed values (which are never repaired).
 * @module tests/unit/enrichment-preferences
 */

import { describe, expect, it } from 'vitest'
import {
  isEnrichmentOutputDirPath,
  ENRICHMENT_DEFAULTS,
  ENRICHMENT_MODE_CHOICES,
  ENRICHMENT_PREFERENCE_KEYS,
  enrichmentPreferencesOf,
} from '../../src/enrichment-preferences.ts'

describe('enrichment preferences', () => {
  it('defaults to free mode with no output override', () => {
    expect(enrichmentPreferencesOf({})).toEqual({
      artifactReader: ARTIFACT_READER_DEFAULTS,
      mode: 'free',
      mineruTokenRef: 'MINERU_API_TOKEN',
      outputDir: '',
      enableSemanticSearch: false,
      semanticModel: 'balanced',
      semanticDownloadSource: 'hf-mirror',
      semanticModelDir: '',
    })
    expect(ENRICHMENT_MODE_CHOICES).toEqual(['free', 'pro'])
    expect(ENRICHMENT_PREFERENCE_KEYS).toEqual([
      'artifactReader',
      'mode',
      'mineruTokenRef',
      'outputDir',
      'enableSemanticSearch',
      'semanticModel',
      'semanticDownloadSource',
      'semanticModelDir',
    ])
  })

  it('keeps the mode independent from the token reference', () => {
    // A configured token does not force pro, and pro does not require the
    // caller to have set one — the switch alone decides.
    expect(
      enrichmentPreferencesOf({ mode: 'free', mineruTokenRef: 'MINERU_API_TOKEN' }),
    ).toMatchObject({ mode: 'free', mineruTokenRef: 'MINERU_API_TOKEN' })
    expect(enrichmentPreferencesOf({ mode: 'pro', mineruTokenRef: '' })).toMatchObject({
      mode: 'pro',
      mineruTokenRef: '',
    })
  })

  it('refuses a mode outside the closed set instead of repairing it', () => {
    expect(() => enrichmentPreferencesOf({ mode: 'turbo' })).toThrow(
      'Invalid enrichment preference: mode',
    )
  })

  it('refuses non-string text fields', () => {
    expect(() => enrichmentPreferencesOf({ outputDir: 7 })).toThrow(
      'Invalid enrichment preference: outputDir',
    )
    expect(() => enrichmentPreferencesOf({ mineruTokenRef: null })).toThrow(
      'Invalid enrichment preference: mineruTokenRef',
    )
  })

  it('freezes the resolved value', () => {
    expect(Object.isFrozen(enrichmentPreferencesOf({}))).toBe(true)
    expect(Object.isFrozen(ENRICHMENT_DEFAULTS)).toBe(true)
  })

  it('accepts only absolute-shaped output directories', () => {
    expect(isEnrichmentOutputDirPath('')).toBe(true)
    expect(isEnrichmentOutputDirPath('/tmp/parsed')).toBe(true)
    expect(isEnrichmentOutputDirPath('~/parsed')).toBe(true)
    expect(isEnrichmentOutputDirPath('C:\\parsed')).toBe(true)
    expect(isEnrichmentOutputDirPath('\\\\server\\share')).toBe(true)
    expect(isEnrichmentOutputDirPath('papers')).toBe(false)
    expect(isEnrichmentOutputDirPath('~docs/papers')).toBe(false)
  })

  it('refuses legacy or invalid model and download source preferences', () => {
    expect(() => enrichmentPreferencesOf({ semanticModel: 'qwen3-0.6b' as never })).toThrow(
      'Invalid enrichment preference: semanticModel',
    )
    expect(() => enrichmentPreferencesOf({ semanticModel: 'en-small' as never })).toThrow(
      'Invalid enrichment preference: semanticModel',
    )
    expect(() =>
      enrichmentPreferencesOf({ semanticDownloadSource: 'modelscope' as never }),
    ).toThrow('Invalid enrichment preference: semanticDownloadSource')
  })
})
