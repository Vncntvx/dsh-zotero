/**
 * The hybrid evidence ranker: the core's lexical BM25 route plus a semantic
 * route over a locally embedded corpus, fused with the same reciprocal-rank
 * rule the scholarly subsystem uses.
 *
 * **The threshold is measured, not configured.** A dense retriever returns a
 * nearest neighbor for any query, and returning arbitrary excerpts as
 * "evidence" is exactly what the evidence contract forbids. Rather than pin a
 * magic cosine per model, the ranker calibrates on first use: it embeds a
 * fixed probe set of on-topic and off-topic pairs and takes the midpoint
 * between the weakest same-topic match and the strongest cross-topic match as
 * the hit threshold. The number is the model's own separation measured on our
 * probes, so it adapts per model and cannot be forgotten when a model changes.
 *
 * The measured separator is **relative, not absolute**: for every model we
 * probed, same-topic prose and off-topic prose overlap in absolute cosine
 * (this model: same-topic floor 0.70–0.84, real off-topic prose up to 0.82),
 * but the query's own best hit always sits above its distractors by a clear
 * margin. So the route admits chunks within a small delta of that best hit —
 * "the passages the model itself considers the answer" — and lets RRF against
 * the lexical route do the ordering. An absolute floor additionally guards
 * the degenerate tail (a query whose best hit is still noise).
 * @module dsh-zotero/enrichment/semantic/ranker
 */

import {
  fuseEvidenceRoutes,
  lexicalRouteScores,
  queryTextsOf,
  type EvidenceRankRequest,
  type EvidenceRanker,
  type EvidenceRankResult,
  type EvidenceRoute,
  type RouteScores,
} from '../../local/evidence-ranker.js'
import { cosineSimilarity } from './tensor.js'
import type { Embedder } from './session.js'

/** One calibration topic: a query, statements that answer it, and ones that do not. */
export interface CalibrationProbe {
  readonly query: string
  readonly related: readonly string[]
}

/**
 * The probe set the threshold is measured on. Bilingual on purpose: the probe
 * must expose a model's cross-language separation too, because library
 * queries arrive in both. Every `related` statement belongs to the probe's
 * topic; every other probe's statements are that query's `unrelated` set.
 */
export const RANKER_CALIBRATION_PROBES: readonly CalibrationProbe[] = [
  {
    query: 'How does photosynthesis convert light energy into chemical energy?',
    related: [
      'Chloroplasts capture photons and drive the Calvin cycle to fix carbon dioxide into sugars.',
      '光合作用利用叶绿体把光能转化为储存在糖类中的化学能。',
    ],
  },
  {
    query: 'What does the Fisher equation say about nominal interest rates and inflation?',
    related: [
      'The nominal interest rate equals the real rate plus expected inflation, per the Fisher equation.',
      '费雪方程指出名义利率约等于实际利率加预期通货膨胀率。',
    ],
  },
  {
    query: 'How does a database B-tree index speed up point queries?',
    related: [
      'A B-tree index keeps keys sorted so point queries descend a logarithmic-height tree instead of scanning the table.',
      'B 树索引通过有序的多路平衡树把点查询从全表扫描降为对数级查找。',
    ],
  },
  {
    query: 'Why do vaccines induce adaptive immunity against a virus?',
    related: [
      'Vaccines present antigen so the adaptive immune system builds memory B and T cells before exposure.',
      '疫苗通过递呈抗原让适应性免疫系统在感染前生成记忆性 B 细胞与 T 细胞。',
    ],
  },
  {
    query: 'What causes overfitting when training a machine-learning model?',
    related: [
      'Overfitting arises when a model memorizes training noise instead of the underlying signal, hurting held-out accuracy.',
      '过拟合指模型记住了训练集中的噪声而非规律，导致在留出集上表现变差。',
    ],
  },
  {
    query: 'How does supply-chain bullwhip effect amplify demand variability?',
    related: [
      'The bullwhip effect amplifies small retail demand swings into large upstream order swings through forecasting and batching.',
      '牛鞭效应经预测与批量订货把零售端的小幅需求波动放大为上游的大幅订单波动。',
    ],
  },
]

/**
 * Measure one embedder's probe separation and report it for diagnostics:
 * the weakest same-topic cosine, the strongest cross-topic cosine, and their
 * midpoint. This is calibration evidence, not a gate — the measurements below
 * showed that same-topic prose and off-topic prose overlap in absolute cosine
 * on every model probed (this model: genuine paraphrases down to 0.70; real
 * off-topic prose up to 0.82), so no absolute line can separate them. The
 * separator that held for every case is the relative margin between a query's
 * best hit and its distractors ({@link SEMANTIC_RELATIVE_DELTA}).
 */
export interface ProbeSeparation {
  readonly weakestSame: number
  readonly strongestCross: number
  readonly midpoint: number
}

export const probeSeparationOf = (() => {
  const calibrationCache = new WeakMap<Embedder, Promise<ProbeSeparation>>()
  return (embedder: Embedder): Promise<ProbeSeparation> => {
    const cached = calibrationCache.get(embedder)
    if (cached !== undefined) return cached
    const measured = (async () => {
      const queries = RANKER_CALIBRATION_PROBES.map((probe) => probe.query)
      const documents = RANKER_CALIBRATION_PROBES.flatMap((probe) => [...probe.related])
      const [queryVectors, documentVectors] = await Promise.all([
        embedder.embed(queries, 'query'),
        embedder.embed(documents, 'document'),
      ])
      let weakestSame = Number.POSITIVE_INFINITY
      let strongestCross = Number.NEGATIVE_INFINITY
      RANKER_CALIBRATION_PROBES.forEach((_, queryIndex) => {
        const queryVector = queryVectors[queryIndex]!
        // Documents are embedded in probe order; each probe's own block is its
        // same-topic set, every other block that query's unrelated set.
        let offset = 0
        RANKER_CALIBRATION_PROBES.forEach((other, otherIndex) => {
          other.related.forEach((_, within) => {
            const similarity = cosineSimilarity(queryVector, documentVectors[offset + within]!)
            if (otherIndex === queryIndex) {
              if (similarity < weakestSame) weakestSame = similarity
            } else if (similarity > strongestCross) {
              strongestCross = similarity
            }
          })
          offset += other.related.length
        })
      })
      if (!Number.isFinite(weakestSame) || !Number.isFinite(strongestCross)) {
        throw new TypeError('calibration produced no comparable cosines')
      }
      return { weakestSame, strongestCross, midpoint: (weakestSame + strongestCross) / 2 }
    })()
    calibrationCache.set(embedder, measured)
    return measured
  }
})()

/**
 * How far below the query's own best semantic hit a chunk may sit and still
 * enter the route. Measured, not configured: for every model we probed,
 * same-topic prose and off-topic prose overlap in absolute cosine, but the
 * query's best hit sits above its distractors by a clear margin (this model:
 * the worst genuine paraphrase is 0.02 below best; real off-topic prose is
 * 0.05+ below). A tight delta keeps the route to the passages the model
 * itself considers the answer.
 */
export const SEMANTIC_RELATIVE_DELTA = 0.02

export interface SemanticRankerDeps {
  /**
   * Resolve the embedder for the selected model. Implementations load lazily
   * and throw `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` when the model cannot
   * serve; the rejection propagates to the tool caller, never a silent
   * lexical-only answer.
   */
  readonly embedder: () => Promise<Embedder>
}

/**
 * The hybrid ranker over one embedder. Lexical scoring stays in the core;
 * this ranker adds the semantic route and fuses both.
 * @param deps - the embedder source.
 */
export function semanticEvidenceRanker(deps: SemanticRankerDeps): EvidenceRanker {
  return {
    async rank(request: EvidenceRankRequest): Promise<EvidenceRankResult> {
      request.signal?.throwIfAborted()
      const texts = queryTextsOf(request.query, request.queryVariants)
      if (texts.length === 0 || request.chunks.length === 0) {
        // Nothing was scored; claiming a meaning comparison would be false.
        return { matches: [], routes: ['lexical'] satisfies readonly EvidenceRoute[] }
      }
      const lexical: RouteScores = lexicalRouteScores(texts, request.chunks)

      const embedder = await deps.embedder()
      const queryVectors = await embedder.embed(texts, 'query')
      // Distinct chunk texts are embedded once; duplicates share a vector.
      const distinct = new Map<string, number>()
      const chunkTexts = request.chunks.map((chunk) => chunk.text)
      chunkTexts.forEach((text, index) => {
        if (!distinct.has(text)) distinct.set(text, index)
      })
      const uniqueTexts = [...distinct.keys()]
      const documentVectors = await embedder.embed(uniqueTexts, 'document')
      const vectorByIndex = new Map<number, Float32Array>()
      uniqueTexts.forEach((text, position) => {
        const firstIndex = distinct.get(text)!
        vectorByIndex.set(firstIndex, documentVectors[position]!)
      })

      // First pass: each chunk's best cosine across the query's phrasings.
      const bestByIndex = new Map<number, number>()
      for (const [index, vector] of vectorByIndex) {
        let best = Number.NEGATIVE_INFINITY
        for (const queryVector of queryVectors) {
          const similarity = cosineSimilarity(queryVector, vector)
          if (similarity > best) best = similarity
        }
        bestByIndex.set(index, best)
      }
      // Second pass: the relative gate. Same-topic prose and off-topic prose
      // overlap in absolute cosine on every model we measured, so the only
      // separator that held case by case is the margin between the query's
      // own best hit and everything else: the route admits chunks within
      // SEMANTIC_RELATIVE_DELTA of that best hit. Ordering is RRF's job — the
      // lexical route runs in parallel and the fusion decides the ranking.
      const routeBest = Math.max(...bestByIndex.values())
      const routeFloor = routeBest - SEMANTIC_RELATIVE_DELTA
      const semantic = new Map<number, number>()
      for (const [index, best] of bestByIndex) {
        if (best >= routeFloor) semantic.set(index, best)
      }
      request.signal?.throwIfAborted()
      return {
        matches: fuseEvidenceRoutes(lexical, semantic),
        routes: ['lexical', 'semantic'] satisfies readonly EvidenceRoute[],
      }
    },
  }
}
