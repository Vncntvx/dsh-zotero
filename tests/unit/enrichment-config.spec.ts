/**
 * The enrichment config resolver: unwraps volatile references and refuses
 * malformed values, mirroring the library resolver's contract.
 * @module tests/unit/enrichment-config
 */

import { describe, expect, it } from 'vitest'
import { EnrichmentConfigSchema, resolveEnrichmentConfig } from '../../src/enrichment/config.ts'

/** `isVolatile` recognizes a reference by this symbol-keyed `write` member. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function volatileOf<T>(value: T): { get: () => T } & Record<symbol, unknown> {
  return { get: () => value, [VOLATILE_WRITE]: () => {} }
}

describe('resolveEnrichmentConfig', () => {
  it('returns the defaults for an absent section', () => {
    expect(resolveEnrichmentConfig()).toEqual({
      mode: 'free',
      mineruTokenRef: 'MINERU_API_TOKEN',
      outputDir: '',
      enableSemanticSearch: false,
      semanticModel: 'balanced',
      semanticDownloadSource: 'hf-mirror',
      semanticModelDir: '',
    })
  })

  it('unwraps volatile references', () => {
    expect(
      resolveEnrichmentConfig({
        mode: volatileOf('pro') as never,
        mineruTokenRef: volatileOf(' MINERU_API_TOKEN ') as never,
        outputDir: volatileOf(' /tmp/parsed ') as never,
        enableSemanticSearch: volatileOf(true) as never,
        semanticModel: volatileOf('lightweight') as never,
        semanticDownloadSource: volatileOf('huggingface') as never,
        semanticModelDir: volatileOf(' /models ') as never,
      }),
    ).toEqual({
      mode: 'pro',
      mineruTokenRef: 'MINERU_API_TOKEN',
      outputDir: '/tmp/parsed',
      enableSemanticSearch: true,
      semanticModel: 'lightweight',
      semanticDownloadSource: 'huggingface',
      semanticModelDir: '/models',
    })
  })

  it('ignores a removed upload-gate field from an old profile', () => {
    const resolved = resolveEnrichmentConfig({ allowDocumentUpload: false } as never)
    expect(resolved).toEqual(resolveEnrichmentConfig())
    expect('allowDocumentUpload' in resolved).toBe(false)
  })

  it('refuses an invalid mode through the shared contract', () => {
    expect(() => resolveEnrichmentConfig({ mode: volatileOf('turbo') as never })).toThrow(
      'Invalid enrichment preference: mode',
    )
  })

  it('refuses a relative output directory at the schema boundary', () => {
    expect(() => EnrichmentConfigSchema({ outputDir: 'relative/papers' })).toThrow()
    expect(() => EnrichmentConfigSchema({ outputDir: '~docs/papers' })).toThrow()
    expect(
      resolveEnrichmentConfig(EnrichmentConfigSchema({ outputDir: '/tmp/parsed' }) as never)
        .outputDir,
    ).toBe('/tmp/parsed')
    expect(
      resolveEnrichmentConfig(EnrichmentConfigSchema({ outputDir: '~/parsed' }) as never).outputDir,
    ).toBe('~/parsed')
    expect(
      resolveEnrichmentConfig(EnrichmentConfigSchema({ outputDir: '' }) as never).outputDir,
    ).toBe('')
  })

  it('refuses invalid or legacy semantic model and download source keys at the schema boundary', () => {
    expect(() => EnrichmentConfigSchema({ semanticModel: 'qwen3-0.6b' as never })).toThrow()
    expect(() => EnrichmentConfigSchema({ semanticModel: 'en-small' as never })).toThrow()
    expect(() => EnrichmentConfigSchema({ semanticModel: 'zh-small' as never })).toThrow()
    expect(() =>
      EnrichmentConfigSchema({ semanticDownloadSource: 'modelscope' as never }),
    ).toThrow()
    expect(() => EnrichmentConfigSchema({ semanticModel: 'unknown' as never })).toThrow()
    expect(() => EnrichmentConfigSchema({ semanticDownloadSource: 'unknown' as never })).toThrow()
  })
})
