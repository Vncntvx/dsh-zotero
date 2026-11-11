/**
 * The evidence-ranking seam shared by `zotero_retrieve` and
 * `scholarly_read query=`.
 *
 * Both tools ask one question — which of these passages answers the query —
 * and both must answer it the same way, over the same chunk boundaries, or one
 * library gets two descriptions of what a passage is. The ranking therefore
 * sits behind this interface instead of being called directly:
 * `bm25EvidenceRanker` below is the core's own complete lexical ranker, and
 * the optional enrichment component installs a hybrid ranker over it while
 * mounted. The core never imports the component, its model runtime, or its
 * transport; it only holds the slot.
 *
 * Three facts the seam owns, because the tools render them:
 *
 * - `matchKind` says *why* a passage came back. A meaning-level hit must never
 *   be reported as wording the paper contains, so the label travels with the
 *   passage rather than being inferred later from a score.
 * - `score` is the fused, normalized ordering value in `[0, 1]`. It is derived
 *   from reciprocal rank, so it orders the answer and says nothing about how
 *   strong the match was. Callers that need magnitude read `lexicalScore` /
 *   `semanticScore`, which are each route's own value on its own scale.
 * - An empty result is one specific fact: no route hit any chunk. A chunk that
 *   no route matches is never returned, because "arbitrary excerpt" would read
 *   as "evidence" and a zero-overlap query would look like a finding.
 *
 * Reciprocal-rank fusion, equal weights, `k = 60`: the constant the scholarly
 * subsystem already uses in `src/scholarly/fusion.ts`, so two result lists of
 * different provenance combine the same way across the plugin.
 * @module dsh-zotero/local/evidence-ranker
 */

import { ZOTERO_RRF_K } from '../constants.js'
import { prepareCorpus, queryTermsOf, rankPrepared, type EvidenceChunk } from '../evidence.js'
import type { EvidenceMatchKind } from '../evidence-item.js'

export type { EvidenceMatchKind }

/**
 * The reciprocal-rank constant; equal weights across routes. Aliases the
 * shared constant so the scholarly fusion and this seam cannot drift.
 */
export const EVIDENCE_RRF_K = ZOTERO_RRF_K

/** One ranking request: the query, any paraphrases of it, and the corpus. */
export interface EvidenceRankRequest {
  /** The caller's own query text. */
  readonly query: string
  /**
   * Additional phrasings of the same question. Each is scored independently
   * and the best score per chunk wins, so a paraphrase can only raise a
   * passage, never dilute the original query the way pooling the words would.
   */
  readonly queryVariants?: readonly string[]
  /** The passages to rank; `index` is the caller's own handle on each. */
  readonly chunks: readonly EvidenceChunk[]
  /** Caller cancellation, checked before each costly step. */
  readonly signal?: AbortSignal
}

/** One ranked passage: the caller's index plus why and how strongly it matched. */
export interface RankedEvidence {
  /** The `index` of the chunk this describes. */
  readonly index: number
  /** Fused, normalized ordering value in `[0, 1]`; orders the answer only. */
  readonly score: number
  /** Which routes hit this chunk. */
  readonly matchKind: EvidenceMatchKind
  /** 1-based position on the lexical route; absent when that route missed. */
  readonly lexicalRank?: number
  /** 1-based position on the semantic route; absent when that route missed. */
  readonly semanticRank?: number
  /** The lexical route's own value (BM25); absent when that route missed. */
  readonly lexicalScore?: number
  /** The semantic route's own value (cosine); absent when that route missed. */
  readonly semanticScore?: number
}

/** A ranking strategy. Asynchronous because a semantic route does real work. */
export interface EvidenceRanker {
  /**
   * Rank `chunks` against the request's query.
   * @param request - the query, its paraphrases, the corpus, and cancellation.
   * @returns the matching passages best first, plus the routes that ran — the
   * fact a caller needs to phrase an empty answer honestly ("nothing matched
   * the words" vs "nothing matched the words or the meaning").
   */
  rank(request: EvidenceRankRequest): Promise<EvidenceRankResult>
}

/** Which scoring routes a ranking call actually ran. */
export type EvidenceRoute = 'lexical' | 'semantic'

/** One ranking outcome: the hits and the routes that produced them. */
export interface EvidenceRankResult {
  /** The matching passages, best first; empty when no route hit any chunk. */
  readonly matches: readonly RankedEvidence[]
  /** The routes that ran, in a fixed order (`lexical` before `semantic`). */
  readonly routes: readonly EvidenceRoute[]
}

/**
 * The query texts to score, in order: the caller's query first, then each
 * distinct non-empty paraphrase. Identical or blank paraphrases are dropped
 * rather than scored twice, because two identical texts can only produce
 * duplicate work and identical scores.
 * @param query - the caller's query.
 * @param variants - paraphrases supplied by the caller.
 * @returns the texts to score, query first.
 */
export function queryTextsOf(query: string, variants?: readonly string[]): string[] {
  const texts: string[] = []
  const seen = new Set<string>()
  for (const raw of [query, ...(variants ?? [])]) {
    const text = raw.trim()
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    texts.push(text)
  }
  return texts
}

/**
 * The distinct lexical terms the ranking actually scores across the query and
 * every paraphrase, in first-occurrence order. This is what the result reports
 * as `queryTerms`, so a caller can see that a query of pure function words left
 * nothing to score instead of guessing why the answer was empty.
 * @param query - the caller's query.
 * @param variants - paraphrases supplied by the caller.
 * @returns the distinct content terms.
 */
export function queryTermsAcross(query: string, variants?: readonly string[]): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const text of queryTextsOf(query, variants)) {
    for (const term of queryTermsOf(text)) {
      if (seen.has(term)) continue
      seen.add(term)
      terms.push(term)
    }
  }
  return terms
}

/** One route's per-chunk values, keyed by the caller's chunk index. */
export type RouteScores = ReadonlyMap<number, number>

/**
 * The lexical route's per-chunk BM25 scores, best score per chunk across the
 * query and every paraphrase, positives only. A score of zero shares no
 * content word with any phrasing, which is exactly "the lexical route did not
 * hit this chunk"; negative BM25 is not a thing, but a guard keeps the route's
 * contract explicit for the fusion below.
 * @param texts - the query texts to score, query first.
 * @param chunks - the caller's corpus.
 * @returns the per-chunk best positive score.
 */
export function lexicalRouteScores(
  texts: readonly string[],
  chunks: readonly EvidenceChunk[],
): RouteScores {
  // One tokenization of the corpus, however many paraphrases score against it.
  const corpus = prepareCorpus(chunks)
  const best = new Map<number, number>()
  for (const text of texts) {
    for (const entry of rankPrepared(text, corpus)) {
      if (entry.score <= 0) continue
      const current = best.get(entry.index)
      if (current === undefined || entry.score > current) best.set(entry.index, entry.score)
    }
  }
  return best
}

/**
 * Assign 1-based ranks per route: highest value first, ties by chunk index
 * ascending, matching `rankChunks`' own tie rule so a two-route fusion does not
 * invent an order the single-route answer would not have had.
 */
function ranksOf(scores: RouteScores): Map<number, number> {
  const ordered = [...scores.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1]
    return a[0] - b[0]
  })
  const ranks = new Map<number, number>()
  ordered.forEach(([index], position) => ranks.set(index, position + 1))
  return ranks
}

/**
 * Fuse the routes that ran into one ordered list.
 *
 * Each route contributes `1 / (k + rank)`. The sum is divided by the largest
 * value the participating routes could jointly reach — `routes / (k + 1)` — so
 * the result is in `[0, 1]` whatever the number of routes, and a rank-1 hit on
 * every route is exactly `1`. `matchKind` names the routes that scored the
 * chunk at all: a positive lexical score already means a content-word overlap,
 * so no rank cutoff is involved and the label cannot change with how many
 * passages the caller happened to ask for.
 * @param lexical - the lexical route's values, if it ran.
 * @param semantic - the semantic route's values, if it ran.
 * @returns the fused ranking, best first.
 */
export function fuseEvidenceRoutes(
  lexical: RouteScores | undefined,
  semantic: RouteScores | undefined,
): RankedEvidence[] {
  const lexicalRanks = lexical === undefined ? new Map<number, number>() : ranksOf(lexical)
  const semanticRanks = semantic === undefined ? new Map<number, number>() : ranksOf(semantic)
  const routes = (lexical === undefined ? 0 : 1) + (semantic === undefined ? 0 : 1)
  if (routes === 0) return []
  const ceiling = routes / (EVIDENCE_RRF_K + 1)

  const indices = new Set<number>([...lexicalRanks.keys(), ...semanticRanks.keys()])
  const fused: RankedEvidence[] = []
  for (const index of indices) {
    const lexicalRank = lexicalRanks.get(index)
    const semanticRank = semanticRanks.get(index)
    let reciprocal = 0
    if (lexicalRank !== undefined) reciprocal += 1 / (EVIDENCE_RRF_K + lexicalRank)
    if (semanticRank !== undefined) reciprocal += 1 / (EVIDENCE_RRF_K + semanticRank)
    const lexicalScore = lexical?.get(index)
    const semanticScore = semantic?.get(index)
    fused.push({
      index,
      score: reciprocal / ceiling,
      matchKind:
        lexicalRank !== undefined && semanticRank !== undefined
          ? 'hybrid'
          : lexicalRank !== undefined
            ? 'lexical'
            : 'semantic',
      ...(lexicalRank === undefined ? {} : { lexicalRank }),
      ...(semanticRank === undefined ? {} : { semanticRank }),
      ...(lexicalScore === undefined ? {} : { lexicalScore }),
      ...(semanticScore === undefined ? {} : { semanticScore }),
    })
  }
  return fused.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })
}

/**
 * The core's lexical ranker: BM25 over the caller's own chunk corpus, scored
 * once per query text, best score per chunk. This is a complete strategy, not
 * a placeholder — with the enrichment component absent it is the whole answer,
 * and with the component mounted the hybrid ranker still feeds it the lexical
 * route.
 *
 * `rank` is `async` on purpose: an implementation that throws before its first
 * `await` would otherwise reject synchronously into the caller's stack and read
 * as a thrown exception rather than a failed promise. A cancellation lands as a
 * rejection, the same as any other strategy's.
 */
export const bm25EvidenceRanker: EvidenceRanker = {
  async rank(request: EvidenceRankRequest): Promise<EvidenceRankResult> {
    request.signal?.throwIfAborted()
    const texts = queryTextsOf(request.query, request.queryVariants)
    if (texts.length === 0 || request.chunks.length === 0) {
      return { matches: [], routes: ['lexical'] }
    }
    const best = lexicalRouteScores(texts, request.chunks)
    request.signal?.throwIfAborted()
    return { matches: fuseEvidenceRoutes(best, undefined), routes: ['lexical'] }
  },
}
