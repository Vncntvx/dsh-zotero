/**
 * The hybrid ranker over a scripted embedder: the measured calibration
 * threshold, threshold filtering into the semantic route, RRF fusion with the
 * lexical route, and the loader's fail-closed error mapping. No model, no
 * WASM — the embedder is a table of vectors.
 * @module tests/unit/semantic-ranker
 */

import { describe, expect, it, vi } from 'vitest'
import { bm25EvidenceRanker } from '../../src/local/evidence-ranker.ts'
import {
  probeSeparationOf,
  semanticEvidenceRanker,
  RANKER_CALIBRATION_PROBES,
} from '../../src/enrichment/semantic/ranker.ts'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.ts'
import type { Embedder } from '../../src/enrichment/semantic/session.ts'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../src/errors.ts'

/**
 * A scripted embedder: every text maps to a unit vector through a table with
 * one shared fallback, so tests can place texts at chosen angles.
 */
function embedderOf(
  table: Record<string, readonly number[]>,
  fallback: readonly number[],
): Embedder {
  return {
    dimension: fallback.length,
    embed: async (texts) => texts.map((text) => new Float32Array(table[text] ?? fallback)),
    dispose: async () => {},
  }
}

/** One-hot helper: unit vectors that are pairwise orthogonal. */
function oneHot(index: number, dimension: number): readonly number[] {
  return Array.from({ length: dimension }, (_, i) => (i === index ? 1 : 0))
}

describe('probeSeparationOf', () => {
  it('measures the same separation for the same embedder, once', async () => {
    // Each calibration text gets its own orthogonal direction, so same-topic
    // cosines are 1 and cross-topic ones are 0: the midpoint is exactly 0.5.
    const table: Record<string, readonly number[]> = {}
    RANKER_CALIBRATION_PROBES.forEach((probe, index) => {
      const direction = oneHot(index, RANKER_CALIBRATION_PROBES.length)
      table[probe.query] = direction
      for (const related of probe.related) table[related] = direction
    })
    const embedder = embedderOf(
      table,
      oneHot(RANKER_CALIBRATION_PROBES.length, RANKER_CALIBRATION_PROBES.length + 1),
    )
    const separation = await probeSeparationOf(embedder)
    expect(separation.weakestSame).toBe(1)
    expect(separation.strongestCross).toBe(0)
    expect(separation.midpoint).toBeGreaterThan(0.49)
    expect(separation.midpoint).toBeLessThanOrEqual(0.51)
    // Cached per embedder: the second call does not re-embed anything.
    const embed = vi.spyOn(embedder, 'embed')
    await probeSeparationOf(embedder)
    expect(embed).not.toHaveBeenCalled()
  })
})

describe('semanticEvidenceRanker', () => {
  const probes = RANKER_CALIBRATION_PROBES

  /** A perfect embedder: queries match their own related passages at 0.9, off-topic at 0.1. */
  function scoringEmbedder(): Embedder {
    const dimension = probes.length
    const table: Record<string, readonly number[]> = {}
    const queryVectors: readonly (readonly number[])[] = probes.map((_, index) =>
      oneHot(index, dimension),
    )
    probes.forEach((probe, index) => {
      table[probe.query] = queryVectors[index]!
      for (const related of probe.related) {
        // Related passages sit at 0.9 cosine from their own query; the spare
        // mass lands on one other axis, so cross-topic cosines are identical
        // and the measured threshold sits between 0.9 and that value.
        const vector = new Array<number>(dimension).fill(0)
        vector[index] = 0.9
        vector[(index + 1) % dimension] = Math.sqrt(1 - 0.9 * 0.9)
        table[related] = vector
      }
    })
    // The synthetic queries used by the rank tests behave like probe 0's query.
    table['synthetic query'] = queryVectors[0]!
    table['bridges'] = queryVectors[0]!
    // A chunk that shares a word with the lexical query: the relative gate
    // must still admit it as the query's best hit.
    table['bridges and tunnels'] = queryVectors[0]!
    return embedderOf(table, new Array<number>(dimension).fill(0))
  }

  it('fuses the lexical route with threshold-filtered semantic hits', async () => {
    const ranker = semanticEvidenceRanker({ embedder: async () => scoringEmbedder() })
    const result = await ranker.rank({
      query: 'synthetic query',
      chunks: [
        { text: probes[0]!.related[0]!, index: 0 },
        { text: probes[1]!.related[0]!, index: 1 },
        { text: 'attention bridges', index: 2 },
      ],
    })
    expect(result.routes).toEqual(['lexical', 'semantic'])
    const kindOf = new Map(result.matches.map((entry) => [entry.index, entry.matchKind]))
    // Chunk 0 is a 0.9 semantic hit (and no lexical overlap) — semantic only.
    expect(kindOf.get(0)).toBe('semantic')
    // Chunk 1 is off-topic at 0.1 cosine: below the measured threshold, so it
    // must not ride in on the semantic route.
    expect(kindOf.get(1)).toBeUndefined()
    // Chunk 2 shares the word "attention" with nothing here… give it a lexical
    // hit instead: the query words do not appear, so it is absent too.
    expect(kindOf.get(2)).toBeUndefined()
    const semantic = result.matches.find((entry) => entry.index === 0)
    expect(semantic?.semanticScore).toBeGreaterThan(0.8)
  })

  it('admits the query\u2019s own best hit regardless of its absolute cosine', async () => {
    // The relative gate: with one chunk, its cosine IS the best, so it enters
    // the semantic route whatever its absolute value — and RRF labels the
    // fusion, not the raw score.
    const ranker = semanticEvidenceRanker({ embedder: async () => scoringEmbedder() })
    const result = await ranker.rank({
      query: 'bridges',
      chunks: [{ text: 'bridges and tunnels', index: 0 }],
    })
    const entry = result.matches[0]
    expect(entry?.lexicalScore).toBeGreaterThan(0)
    expect(entry?.semanticScore).toBeGreaterThan(0)
  })

  it('returns no matches and only the lexical route for an empty corpus', async () => {
    const ranker = semanticEvidenceRanker({ embedder: async () => scoringEmbedder() })
    const result = await ranker.rank({ query: 'anything', chunks: [] })
    expect(result.matches).toEqual([])
    // No meaning comparison was made, so the routes must not claim semantic.
    expect(result.routes).toEqual(['lexical'])
  })

  it('propagates cancellation before and after the embedder runs', async () => {
    const ranker = semanticEvidenceRanker({ embedder: async () => scoringEmbedder() })
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

  it('reports only the lexical route while the embedder is the core one', async () => {
    const result = await bm25EvidenceRanker.rank({
      query: 'bridges',
      chunks: [{ text: 'bridges and tunnels', index: 0 }],
    })
    expect(result.routes).toEqual(['lexical'])
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
