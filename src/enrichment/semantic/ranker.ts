/**
 * The hybrid evidence ranker: the core's lexical BM25 route plus a semantic
 * route over a locally embedded corpus, fused with the same reciprocal-rank
 * rule the scholarly subsystem uses.
 *
 * Admission is the tier's measured absolute floor plus a margin over the
 * corpus's own best cosine (`admittedIndexes`). A new phrasing adds hits
 * without removing another phrasing's admitted members. Every distinct retained
 * chunk is embedded on its first read: lexical prefiltering would lose hits
 * without shared words. The model generation owns a bounded vector cache.
 * Offline measurement lives in scripts/semantic-calibration/.
 *
 * The semantic route orders by best admitted confidence; raw cosine stays in
 * `semanticScore`. RRF orders results and does not express confidence.
 * @module dsh-zotero/enrichment/semantic/ranker
 */

import {
  assertUniqueChunkIndexes,
  fuseEvidenceRoutes,
  lexicalRouteScores,
  queryTextsOf,
  type EvidenceRankRequest,
  type EvidenceRanker,
  type EvidenceRankResult,
  type EvidenceRoute,
  type RouteScores,
} from '../../local/evidence-ranker.js'
import { admittedIndexes, validateAdmissionRules, type AdmissionRules } from './admission.js'
import { cosineSimilarity } from './tensor.js'
import type { VectorCache } from './vector-cache.js'
import type { Embedder } from './session.js'

interface SemanticRankerDeps {
  /**
   * Resolve the embedder for the selected model. Implementations load lazily
   * and throw `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` when the model cannot
   * serve; the rejection propagates to the tool caller without a lexical-only
   * fallback.
   */
  readonly embedder: (signal?: AbortSignal) => Promise<Embedder>
  /**
   * The selected tier's admission rules (absolute floor plus relative margin),
   * fixed in code per model. An unknown tier fails with the semantic-unavailable
   * code rather than admitting passages on a guess.
   */
  readonly profile: () => AdmissionRules
  /**
   * Optional bounded cross-request vector cache. The service owns one per
   * model generation; omitting it (unit tests) still ranks correctly, just
   * without reuse. A model switch constructs a new cache rather than reusing
   * an old generation's entries.
   */
  readonly vectorCache?: VectorCache
}

/** Embed through the cache when present, otherwise straight to the embedder. */
async function embedWithCache(
  embedder: Embedder,
  cache: VectorCache | undefined,
  texts: readonly string[],
  side: 'query' | 'document',
  signal: AbortSignal | undefined,
): Promise<readonly Float32Array[]> {
  if (cache === undefined) return await embedder.embed(texts, side, signal)
  return await cache.embed(
    texts,
    side,
    async (missing, runSignal) => await embedder.embed(missing, side, runSignal),
    signal,
    embedder.retain === undefined
      ? undefined
      : () => {
          const lease = embedder.retain!()
          return {
            run: async (missing, runSignal) => await lease.embed(missing, side, runSignal),
            release: async () => await lease.dispose(),
          }
        },
  )
}

/**
 * The hybrid ranker over one embedder. Lexical scoring stays in the core;
 * this ranker adds the calibrated semantic route and fuses both.
 * @param deps - the embedder source, the tier profile, and the vector cache.
 */
export function semanticEvidenceRanker(deps: SemanticRankerDeps): EvidenceRanker {
  return {
    async rank(request: EvidenceRankRequest): Promise<EvidenceRankResult> {
      request.signal?.throwIfAborted()
      assertUniqueChunkIndexes(request.chunks)
      const texts = queryTextsOf(request.query, request.queryVariants)
      if (texts.length === 0 || request.chunks.length === 0) {
        // Nothing was scored; claiming a meaning comparison would be false.
        return { matches: [], routes: ['lexical'] satisfies readonly EvidenceRoute[] }
      }
      const lexical: RouteScores = lexicalRouteScores(texts, request.chunks)

      const rules = validateAdmissionRules(deps.profile(), 'the semantic model profile')
      const embedder = await deps.embedder(request.signal)
      request.signal?.throwIfAborted()
      const queryVectors = await embedWithCache(
        embedder,
        deps.vectorCache,
        texts,
        'query',
        request.signal,
      )

      // Distinct chunk texts are embedded once, but every caller index that
      // carries a text maps back to that one vector: identity is never lost to
      // deduplication.
      const distinct = new Map<string, number[]>()
      request.chunks.forEach((chunk, position) => {
        const indexes = distinct.get(chunk.text)
        if (indexes === undefined) distinct.set(chunk.text, [position])
        else indexes.push(position)
      })
      const uniqueTexts = [...distinct.keys()]
      const documentVectors = await embedWithCache(
        embedder,
        deps.vectorCache,
        uniqueTexts,
        'document',
        request.signal,
      )
      request.signal?.throwIfAborted()

      // Each phrasing admits independently over its own cosine row, then the
      // rows are unioned. A new phrasing can add a passage but never remove
      // another phrasing's hit; the best cosine per passage is retained and
      // becomes `semanticScore`.
      const cosineByText = new Map<string, number>()
      for (let i = 0; i < texts.length; i += 1) {
        request.signal?.throwIfAborted()
        const queryVector = queryVectors[i]!
        const row = uniqueTexts.map((_, position) =>
          cosineSimilarity(queryVector, documentVectors[position]!),
        )
        for (const index of admittedIndexes(row, rules)) {
          const text = uniqueTexts[index]!
          const cosine = row[index]!
          const current = cosineByText.get(text)
          if (current === undefined || cosine > current) cosineByText.set(text, cosine)
        }
      }

      const semanticByIndex = new Map<number, number>()
      for (const [text, positions] of distinct) {
        const cosine = cosineByText.get(text)
        if (cosine === undefined) continue
        for (const position of positions)
          semanticByIndex.set(request.chunks[position]!.index, cosine)
      }
      request.signal?.throwIfAborted()
      // RRF orders the two routes; `semanticScore` stays the raw cosine so the
      // magnitude the model measured is still reported.
      const matches = fuseEvidenceRoutes(lexical, semanticByIndex).map((entry) => {
        const cosine = semanticByIndex.get(entry.index)
        return cosine === undefined ? entry : { ...entry, semanticScore: cosine }
      })
      return {
        matches,
        routes: ['lexical', 'semantic'] satisfies readonly EvidenceRoute[],
      }
    },
  }
}
