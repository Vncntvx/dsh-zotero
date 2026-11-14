/**
 * The hybrid evidence ranker: the core's lexical BM25 route plus a semantic
 * route over a locally embedded corpus, fused with the same reciprocal-rank
 * rule the scholarly subsystem uses.
 *
 * Admission is the tier's measured absolute floor plus a margin over the
 * corpus's own best cosine (`admittedIndexes`). A new phrasing adds hits
 * without removing another phrasing's admitted members. The offline
 * ridge-logistic probes in this module are calibration evidence for the
 * measured floors and are never part of the runtime decision.
 *
 * The semantic route orders by best admitted confidence; raw cosine stays in
 * `semanticScore`. RRF orders results and does not express confidence.
 * @module dsh-zotero/enrichment/semantic/ranker
 */
import { assertUniqueChunkIndexes, fuseEvidenceRoutes, lexicalRouteScores, queryTextsOf, } from '../../local/evidence-ranker.js';
import { admittedIndexes, validateAdmissionRules } from './admission.js';
import { cosineSimilarity } from './tensor.js';
/**
 * Diagnostic sample probes retained from the baseline; production admission
 * does not use them. The offline calibration chain in
 * `scripts/semantic-calibration/` owns the dataset, split, fit, and held-out
 * evaluation.
 */
export const RANKER_CALIBRATION_PROBES = [
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
];
/**
 * Measure one embedder's probe separation for diagnostics; `rank()` does not
 * call it.
 */
export const probeSeparationOf = (() => {
    const diagnosticCache = new WeakMap();
    return async (embedder) => {
        const cached = diagnosticCache.get(embedder);
        if (cached !== undefined)
            return cached;
        const measured = (async () => {
            const queries = RANKER_CALIBRATION_PROBES.map((probe) => probe.query);
            const documents = RANKER_CALIBRATION_PROBES.flatMap((probe) => [...probe.related]);
            const [queryVectors, documentVectors] = await Promise.all([
                embedder.embed(queries, 'query'),
                embedder.embed(documents, 'document'),
            ]);
            let weakestSame = Number.POSITIVE_INFINITY;
            let strongestCross = Number.NEGATIVE_INFINITY;
            RANKER_CALIBRATION_PROBES.forEach((probe, queryIndex) => {
                const queryVector = queryVectors[queryIndex];
                let offset = 0;
                RANKER_CALIBRATION_PROBES.forEach((other, otherIndex) => {
                    other.related.forEach((_, within) => {
                        const similarity = cosineSimilarity(queryVector, documentVectors[offset + within]);
                        if (otherIndex === queryIndex)
                            weakestSame = Math.min(weakestSame, similarity);
                        else
                            strongestCross = Math.max(strongestCross, similarity);
                    });
                    offset += other.related.length;
                });
            });
            if (!Number.isFinite(weakestSame) || !Number.isFinite(strongestCross))
                throw new TypeError('diagnostic probes produced no comparable cosines');
            return { weakestSame, strongestCross, midpoint: (weakestSame + strongestCross) / 2 };
        })();
        diagnosticCache.set(embedder, measured);
        return measured;
    };
})();
/** Embed through the cache when present, otherwise straight to the embedder. */
async function embedWithCache(embedder, cache, texts, side, signal) {
    if (cache === undefined)
        return await embedder.embed(texts, side, signal);
    return await cache.embed(texts, side, async (missing, runSignal) => await embedder.embed(missing, side, runSignal), signal);
}
/**
 * The hybrid ranker over one embedder. Lexical scoring stays in the core;
 * this ranker adds the calibrated semantic route and fuses both.
 * @param deps - the embedder source, the tier profile, and the vector cache.
 */
export function semanticEvidenceRanker(deps) {
    return {
        async rank(request) {
            request.signal?.throwIfAborted();
            assertUniqueChunkIndexes(request.chunks);
            const texts = queryTextsOf(request.query, request.queryVariants);
            if (texts.length === 0 || request.chunks.length === 0) {
                // Nothing was scored; claiming a meaning comparison would be false.
                return { matches: [], routes: ['lexical'] };
            }
            const lexical = lexicalRouteScores(texts, request.chunks);
            const rules = validateAdmissionRules(deps.profile(), 'the semantic model profile');
            const embedder = await deps.embedder();
            request.signal?.throwIfAborted();
            const queryVectors = await embedWithCache(embedder, deps.vectorCache, texts, 'query', request.signal);
            // Distinct chunk texts are embedded once, but every caller index that
            // carries a text maps back to that one vector: identity is never lost to
            // deduplication.
            const distinct = new Map();
            request.chunks.forEach((chunk, position) => {
                const indexes = distinct.get(chunk.text);
                if (indexes === undefined)
                    distinct.set(chunk.text, [position]);
                else
                    indexes.push(position);
            });
            const uniqueTexts = [...distinct.keys()];
            const documentVectors = await embedWithCache(embedder, deps.vectorCache, uniqueTexts, 'document', request.signal);
            request.signal?.throwIfAborted();
            // Each phrasing admits independently over its own cosine row, then the
            // rows are unioned. A new phrasing can add a passage but never remove
            // another phrasing's hit; the best cosine per passage is retained and
            // becomes `semanticScore`.
            const cosineByText = new Map();
            for (let i = 0; i < texts.length; i += 1) {
                request.signal?.throwIfAborted();
                const queryVector = queryVectors[i];
                const row = uniqueTexts.map((_, position) => cosineSimilarity(queryVector, documentVectors[position]));
                for (const index of admittedIndexes(row, rules)) {
                    const text = uniqueTexts[index];
                    const cosine = row[index];
                    const current = cosineByText.get(text);
                    if (current === undefined || cosine > current)
                        cosineByText.set(text, cosine);
                }
            }
            const semanticByIndex = new Map();
            for (const [text, positions] of distinct) {
                const cosine = cosineByText.get(text);
                if (cosine === undefined)
                    continue;
                for (const position of positions)
                    semanticByIndex.set(request.chunks[position].index, cosine);
            }
            request.signal?.throwIfAborted();
            // RRF orders the two routes; `semanticScore` stays the raw cosine so the
            // magnitude the model measured is still reported.
            const matches = fuseEvidenceRoutes(lexical, semanticByIndex).map((entry) => {
                const cosine = semanticByIndex.get(entry.index);
                return cosine === undefined ? entry : { ...entry, semanticScore: cosine };
            });
            return {
                matches,
                routes: ['lexical', 'semantic'],
            };
        },
    };
}
//# sourceMappingURL=ranker.js.map