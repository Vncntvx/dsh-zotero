/**
 * The ranking seam's own contract: what `rank` promises to the two tools that
 * call it, independent of which strategy is installed.
 *
 * The core's `bm25EvidenceRanker` is one complete strategy behind this
 * interface, and the enrichment component installs a hybrid one. Both have to
 * agree on the promises below, because `zotero_retrieve` and `scholarly_read`
 * read the result without knowing which one ran: an emptied result means "no
 * overlap", `score` orders but does not measure, `matchKind` says what may be
 * done with the passage, and a paraphrase may only ever raise a passage.
 * @module tests/local/retrieve/evidence-ranker
 */

import { describe, expect, it } from 'vitest'
import { rankChunks } from '../../../src/evidence.js'
import {
  bm25EvidenceRanker,
  EVIDENCE_RRF_K,
  fuseEvidenceRoutes,
  queryTermsAcross,
  queryTextsOf,
} from '../../../src/local/evidence-ranker.js'

/** Chunks a caller would pass: the passage text plus its own handle. */
function chunksOf(passages: readonly string[]) {
  return passages.map((text, index) => ({ text, index }))
}

/**
 * The matches half of a lexical ranking, so the spec reads like the array it
 * asserts on; route facts get their own assertions.
 */
function matchesOf(request: Parameters<typeof bm25EvidenceRanker.rank>[0]) {
  return bm25EvidenceRanker.rank(request).then((result) => result.matches)
}

/** The raw BM25 value one text gives one passage, or 0 when absent. */
function bm25Of(text: string, passages: readonly string[], index: number): number {
  const ranked = rankChunks(text, chunksOf(passages))
  return ranked.find((entry) => entry.index === index)?.score ?? 0
}

describe('query texts and terms', () => {
  it('puts the caller query first and drops blank or repeated paraphrases', () => {
    expect(queryTextsOf('trust', [' legitimacy ', 'trust', '', '   ', 'adherence'])).toEqual([
      'trust',
      'legitimacy',
      'adherence',
    ])
    expect(queryTextsOf('  trust  ')).toEqual(['trust'])
    expect(queryTextsOf('   ')).toEqual([])
  })

  it('reports the folded content terms across the query and its paraphrases', () => {
    expect(queryTermsAcross('the trust of', ['institutional legitimacy', 'trust'])).toEqual([
      'trust',
      'institutional',
      'legitimacy',
    ])
    expect(queryTermsAcross('the of and')).toEqual([])
  })
})

describe('bm25EvidenceRanker', () => {
  it('returns nothing when no passage overlaps the query', async () => {
    const ranked = await matchesOf({
      query: 'institutional trust',
      chunks: chunksOf(['perceived legitimacy drives adherence', 'a study of bridges']),
    })
    expect(ranked).toEqual([])
  })

  it('returns nothing for an empty corpus or a termless query', async () => {
    expect(await matchesOf({ query: 'trust', chunks: [] })).toEqual([])
    expect(await matchesOf({ query: 'the of and', chunks: chunksOf(['the role of law']) })).toEqual(
      [],
    )
  })

  it('reports the lexical route even when it scored nothing', async () => {
    const empty = await bm25EvidenceRanker.rank({ query: 'trust', chunks: [] })
    expect(empty.routes).toEqual(['lexical'])
    const termless = await matchesOf({ query: 'the of and', chunks: chunksOf(['the role of law']) })
    expect(termless).toEqual([])
  })

  it('labels every returned passage lexical and gives each a 1-based rank', async () => {
    const ranked = await matchesOf({
      query: 'bridges',
      chunks: chunksOf(['bridges over rivers', 'bridges and tunnels', 'unrelated']),
    })
    expect(ranked.map((entry) => entry.index)).toEqual([0, 1])
    expect(ranked.map((entry) => entry.matchKind)).toEqual(['lexical', 'lexical'])
    expect(ranked.map((entry) => entry.lexicalRank)).toEqual([1, 2])
    expect(ranked.every((entry) => entry.semanticRank === undefined)).toBe(true)
    expect(ranked.every((entry) => entry.lexicalScore !== undefined)).toBe(true)
  })

  it('orders by the fused value, which decays with rank and starts at 1', async () => {
    const ranked = await matchesOf({
      query: 'bridges',
      chunks: chunksOf(['bridges bridges bridges', 'a bridge too far', 'unrelated']),
    })
    expect(ranked[0]!.score).toBe(1)
    for (const entry of ranked.slice(1)) {
      expect(entry.score).toBeLessThan(1)
      expect(entry.score).toBeGreaterThan(0)
      // One route's ceiling is 1/(k+1), so rank r is (k+1)/(k+r).
      expect(entry.score).toBe((EVIDENCE_RRF_K + 1) / (EVIDENCE_RRF_K + entry.lexicalRank!))
    }
  })

  it('cannot be amplified by repeating the query text as a paraphrase', async () => {
    // The stage-1 fix, seen from the seam: a reviewer who pastes the same
    // wording twice must get the same answer, not twice the weight.
    const passages = ['trust in institutions', 'trust and compliance', 'unrelated text']
    const once = await matchesOf({ query: 'trust', chunks: chunksOf(passages) })
    const twice = await matchesOf({
      query: 'trust',
      queryVariants: ['trust', ' trust '],
      chunks: chunksOf(passages),
    })
    expect(twice).toEqual(once)
  })

  it('scores a paraphrase separately and keeps the best value per passage', async () => {
    // Max, not sum: a passage matched by both wordings must not collect two
    // scores, which is the pooling bug the seam exists to keep out.
    const passages = ['legitimacy and adherence', 'a study of perceived legitimacy', 'unrelated']
    const ranked = await matchesOf({
      query: 'regulatory adherence',
      queryVariants: ['perceived legitimacy'],
      chunks: chunksOf(passages),
    })
    for (const entry of ranked) {
      const best = Math.max(
        bm25Of('regulatory adherence', passages, entry.index),
        bm25Of('perceived legitimacy', passages, entry.index),
      )
      expect(entry.lexicalScore).toBeCloseTo(best, 12)
    }
    // The passage only the paraphrase reaches is now in the answer.
    expect(ranked.map((entry) => entry.index)).toContain(1)
  })

  it('propagates cancellation instead of returning a partial answer', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    await expect(
      bm25EvidenceRanker.rank({
        query: 'trust',
        chunks: chunksOf(['trust']),
        signal: controller.signal,
      }),
    ).rejects.toThrow('user cancelled')
  })

  it('breaks ties by the caller chunk order, like the primitive it wraps', async () => {
    // Two identical passages carry identical scores; the caller's own order is
    // the only tie-break that keeps the answer reproducible.
    const ranked = await matchesOf({
      query: 'bridges',
      chunks: chunksOf(['bridges here', 'bridges here']),
    })
    expect(ranked.map((entry) => entry.index)).toEqual([0, 1])
  })
})

describe('fuseEvidenceRoutes', () => {
  it('names the routes that scored a passage', () => {
    const fused = fuseEvidenceRoutes(
      new Map([
        [0, 5],
        [1, 3],
      ]),
      new Map([
        [1, 0.8],
        [2, 0.6],
      ]),
    )
    const kindOf = new Map(fused.map((entry) => [entry.index, entry.matchKind]))
    expect(kindOf.get(0)).toBe('lexical')
    expect(kindOf.get(1)).toBe('hybrid')
    expect(kindOf.get(2)).toBe('semantic')
  })

  it('normalizes so a rank-1 hit on every route is exactly 1', () => {
    const fused = fuseEvidenceRoutes(new Map([[0, 9]]), new Map([[0, 0.9]]))
    expect(fused).toHaveLength(1)
    expect(fused[0]!.score).toBe(1)
    expect(fused[0]!.lexicalRank).toBe(1)
    expect(fused[0]!.semanticRank).toBe(1)
  })

  it('is empty when no route ran', () => {
    expect(fuseEvidenceRoutes(undefined, undefined)).toEqual([])
    expect(fuseEvidenceRoutes(new Map(), new Map())).toEqual([])
  })

  it('keeps a semantic-only ranker inside [0, 1]', () => {
    const fused = fuseEvidenceRoutes(
      undefined,
      new Map([
        [3, 0.71],
        [1, 0.42],
      ]),
    )
    expect(fused.map((entry) => entry.index)).toEqual([3, 1])
    expect(fused[0]!.score).toBe(1)
    expect(fused[1]!.score).toBeCloseTo((EVIDENCE_RRF_K + 1) / (EVIDENCE_RRF_K + 2), 12)
    expect(fused.every((entry) => entry.matchKind === 'semantic')).toBe(true)
  })
})
