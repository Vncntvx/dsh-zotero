/**
 * The hybrid ranker over a scripted embedder and a tier profile: the measured
 * floor plus margin replaces the old relative `routeBest - 0.02` gate, a wholly
 * irrelevant corpus is refused, duplicate texts keep every caller handle, a new
 * phrasing can only add hits, a missing profile fails closed, and the bounded
 * vector cache is used when supplied. No model, no WASM.
 * @module tests/unit/semantic-ranker
 */

import { describe, expect, it, vi } from 'vitest'
import {
  probeSeparationOf,
  semanticEvidenceRanker,
  RANKER_CALIBRATION_PROBES,
} from '../../src/enrichment/semantic/ranker.ts'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'
import type { AdmissionRules } from '../../src/enrichment/semantic/admission.ts'
import { createVectorCache } from '../../src/enrichment/semantic/vector-cache.ts'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../src/errors.ts'

const DIMENSION = 8

/** A scripted embedder: every text maps to a vector through a table. */
function embedderOf(
  table: Record<string, readonly number[]>,
  fallback: readonly number[] = new Array<number>(DIMENSION).fill(0),
): Embedder {
  return {
    dimension: fallback.length,
    embed: async (texts) => texts.map((text) => new Float32Array(table[text] ?? fallback)),
    dispose: async () => {},
  }
}

/** Unit vector along one axis. */
function axis(index: number, dimension = DIMENSION): readonly number[] {
  return Array.from({ length: dimension }, (_, i) => (i === index ? 1 : 0))
}

/**
 * The admission rules the production table uses: an absolute floor plus a
 * relative margin. These unit tests pick values that separate the scripted
 * vectors below, not the measured catalog numbers.
 */
function rulesOf(overrides: Partial<AdmissionRules> = {}): AdmissionRules {
  return { floor: 0.5, margin: 0.06, ...overrides }
}

/** A corpus where one passage is on-topic and the other two are not. */
function scoringEmbedder(): Embedder {
  const table: Record<string, readonly number[]> = {
    'vaccine question': axis(0),
    'ceramic sintering': axis(1),
    'bridges and tunnels': [0.9, Math.sqrt(1 - 0.81), 0, 0, 0, 0, 0, 0],
    bridges: axis(0),
    'paraphrase of bridges': [0.95, Math.sqrt(1 - 0.95 * 0.95), 0, 0, 0, 0, 0, 0],
  }
  return embedderOf(table)
}

describe('probeSeparationOf (diagnostic only)', () => {
  it('measures separation without being a production gate', async () => {
    const table: Record<string, readonly number[]> = {}
    RANKER_CALIBRATION_PROBES.forEach((probe, index) => {
      const direction = axis(index, RANKER_CALIBRATION_PROBES.length)
      table[probe.query] = direction
      for (const related of probe.related) table[related] = direction
    })
    const embedder = embedderOf(
      table,
      axis(RANKER_CALIBRATION_PROBES.length, RANKER_CALIBRATION_PROBES.length + 1),
    )
    const separation = await probeSeparationOf(embedder)
    expect(separation.weakestSame).toBe(1)
    expect(separation.strongestCross).toBe(0)
    // Cached per embedder; a second call does no work.
    const embed = vi.spyOn(embedder, 'embed')
    await probeSeparationOf(embedder)
    expect(embed).not.toHaveBeenCalled()
  })
})

describe('semanticEvidenceRanker with measured admission', () => {
  it('fuses a calibrated semantic hit with the lexical route', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () => scoringEmbedder(),
      profile: () => rulesOf(),
    })
    const result = await ranker.rank({
      query: 'bridges',
      chunks: [
        { text: 'bridges and tunnels', index: 0 },
        { text: 'ceramic sintering', index: 1 },
      ],
    })
    expect(result.routes).toEqual(['lexical', 'semantic'])
    const semantic = result.matches.find((entry) => entry.index === 0)
    expect(semantic?.matchKind).toBe('hybrid')
    expect(semantic?.semanticScore).toBeCloseTo(0.9, 5)
    // The unrelated passage never enters the semantic route.
    expect(result.matches.find((entry) => entry.index === 1)?.semanticScore).toBeUndefined()
  })

  it('refuses a wholly irrelevant corpus instead of returning a nearest neighbour', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () =>
        embedderOf({
          'vaccine question': axis(0),
          'ceramic sintering': axis(1),
          'bridge construction': axis(2),
        }),
      profile: () => rulesOf(),
    })
    const result = await ranker.rank({
      query: 'vaccine question',
      chunks: [
        { text: 'ceramic sintering', index: 0 },
        { text: 'bridge construction', index: 1 },
      ],
    })
    expect(result.matches).toEqual([])
  })

  it('keeps every caller handle when two passages share the same text', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () => scoringEmbedder(),
      profile: () => rulesOf(),
    })
    const result = await ranker.rank({
      query: 'bridges',
      chunks: [
        { text: 'bridges and tunnels', index: 11 },
        { text: 'bridges and tunnels', index: 23 },
      ],
    })
    expect(result.matches.map((entry) => entry.index)).toEqual([11, 23])
    expect(result.matches.every((entry) => entry.semanticScore !== undefined)).toBe(true)
  })

  it('lets a new phrasing add a hit but never remove an existing member', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () => scoringEmbedder(),
      profile: () => rulesOf(),
    })
    const chunks = [
      { text: 'bridges and tunnels', index: 0 },
      { text: 'ceramic sintering', index: 1 },
    ]
    const once = await ranker.rank({ query: 'bridges', chunks })
    const withVariant = await ranker.rank({
      query: 'bridges',
      queryVariants: ['paraphrase of bridges'],
      chunks,
    })
    for (const entry of once.matches)
      expect(withVariant.matches.some((candidate) => candidate.index === entry.index)).toBe(true)
  })

  it('fails closed when the tier has no admission profile', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () => scoringEmbedder(),
      profile: () => {
        throw new ZoteroError('no profile', ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE)
      },
    })
    await expect(
      ranker.rank({ query: 'bridges', chunks: [{ text: 'bridges and tunnels', index: 0 }] }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE })
  })

  it('embeds through the bounded vector cache when one is supplied', async () => {
    const embedder = scoringEmbedder()
    const embed = vi.spyOn(embedder, 'embed')
    const cache = createVectorCache({
      key: 'balanced',
      physicalKey: 'qwen3-0.6b',
      revision: 'a'.repeat(40),
      dimension: DIMENSION,
      pooling: 'mean',
      normalize: true,
      queryPrefix: '',
      documentPrefix: '',
      scoringVersion: 'test',
      fileDigests: {},
    })
    const ranker = semanticEvidenceRanker({
      embedder: async () => embedder,
      profile: () => rulesOf(),
      vectorCache: cache,
    })
    const chunks = [{ text: 'bridges and tunnels', index: 0 }]
    const first = await ranker.rank({ query: 'bridges', chunks })
    const callsAfterFirst = embed.mock.calls.length
    const second = await ranker.rank({ query: 'bridges', chunks })
    expect(second.matches).toEqual(first.matches)
    // Both the query and the passage are cached: the second read encodes nothing.
    expect(embed.mock.calls.length).toBe(callsAfterFirst)
    cache.dispose()
  })

  it('returns no semantic claim for an empty corpus', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () => scoringEmbedder(),
      profile: () => rulesOf(),
    })
    const result = await ranker.rank({ query: 'anything', chunks: [] })
    expect(result.matches).toEqual([])
    expect(result.routes).toEqual(['lexical'])
  })

  it('propagates cancellation instead of returning a partial answer', async () => {
    const ranker = semanticEvidenceRanker({
      embedder: async () => scoringEmbedder(),
      profile: () => rulesOf(),
    })
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    await expect(
      ranker.rank({
        query: 'q',
        chunks: [{ text: 't', index: 0 }],
        signal: controller.signal,
      }),
    ).rejects.toThrow('user cancelled')
  })
})

describe('SemanticEmbedderLoader', () => {
  const target = { spec: { key: 'balanced' }, dir: '/models/qwen3-0.6b' } as never

  it('single-flights one load and maps failures to the fail-closed error', async () => {
    const open = vi.fn(async () => ({
      dimension: 4,
      embed: async () => [],
      dispose: async () => {},
    }))
    const loader = new SemanticEmbedderLoader({ open })
    const [first, second] = await Promise.all([loader.get(target), loader.get(target)])
    expect(open).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    await loader.dispose()
  })

  it('wraps an unknown loader failure with the remedy in the message', async () => {
    const loader = new SemanticEmbedderLoader({
      open: async () => {
        throw new Error('wasm unavailable')
      },
    })
    await expect(loader.get(target)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
    })
    await expect(loader.get(target)).rejects.toThrow(/npm run assets:semantic/)
  })

  it('keeps a ZoteroError as-is instead of double wrapping', async () => {
    const original = new ZoteroError('bundle corrupted', ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE)
    const loader = new SemanticEmbedderLoader({
      open: async () => {
        throw original
      },
    })
    await expect(loader.get(target)).rejects.toBe(original)
  })

  it('releases the previous resident when the target changes', async () => {
    const disposed: string[] = []
    const loader = new SemanticEmbedderLoader({
      open: async (resolved) => ({
        dimension: 4,
        embed: async () => [],
        dispose: async () => {
          disposed.push((resolved as { spec: { key: string } }).spec.key)
        },
      }),
    })
    await loader.get(target)
    const other = { spec: { key: 'lightweight' }, dir: '/models/granite-97m' } as never
    await loader.get(other)
    expect(disposed).toEqual(['balanced'])
    await loader.dispose()
    expect(disposed).toEqual(['balanced', 'lightweight'])
  })
})
