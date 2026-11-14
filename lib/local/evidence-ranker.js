/**
 * The evidence-ranking seam shared by `zotero_retrieve` and
 * `scholarly_read query=`.
 *
 * Both tools rank passages over the same chunk boundaries and must return the
 * same result. Ranking sits behind this interface rather than being called
 * directly. `bm25EvidenceRanker` is the core's lexical ranker; the enrichment
 * component installs a hybrid ranker over it while mounted. The core holds the
 * slot and does not import the component, its model runtime, or its transport.
 *
 * The seam exposes three facts to the tools:
 *
 * - `matchKind` says *why* a passage came back. A meaning-level hit must never
 *   be reported as wording the paper contains, so the label travels with the
 *   passage rather than being inferred later from a score.
 * - `score` is the fused, normalized ordering value in `[0, 1]`. It is derived
 *   from reciprocal rank, so it orders the answer and says nothing about how
 *   strong the match was. Callers that need magnitude read `lexicalScore` /
 *   `semanticScore`, which are each route's own value on its own scale.
 * - An empty result means no route hit any chunk. Chunks that no route matches
 *   are not returned.
 *
 * Reciprocal-rank fusion, equal weights, `k = 60`, matching the scholarly
 * subsystem's constant in `src/scholarly/fusion.ts`.
 * @module dsh-zotero/local/evidence-ranker
 */
import { ZOTERO_RRF_K } from '../constants.js';
import { prepareCorpus, queryTermsOf, rankPrepared } from '../evidence.js';
/**
 * The reciprocal-rank constant, equal weights across routes; aliases the
 * shared constant used by scholarly fusion.
 */
export const EVIDENCE_RRF_K = ZOTERO_RRF_K;
/**
 * Refuse an ambiguous corpus. Each caller handle identifies exactly one
 * passage; a duplicate makes ranked results unaddressable and can collapse
 * two distinct sources into one.
 */
export function assertUniqueChunkIndexes(chunks) {
    const seen = new Set();
    for (const chunk of chunks) {
        if (seen.has(chunk.index)) {
            throw new RangeError(`duplicate evidence chunk index ${chunk.index}`);
        }
        seen.add(chunk.index);
    }
}
/**
 * The query texts to score, in order: the caller's query, then each distinct
 * non-empty paraphrase. Blank and duplicate paraphrases are dropped.
 * @param query - the caller's query.
 * @param variants - paraphrases supplied by the caller.
 * @returns the texts to score, query first.
 */
export function queryTextsOf(query, variants) {
    const texts = [];
    const seen = new Set();
    for (const raw of [query, ...(variants ?? [])]) {
        const text = raw.trim();
        if (text === '' || seen.has(text))
            continue;
        seen.add(text);
        texts.push(text);
    }
    return texts;
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
export function queryTermsAcross(query, variants) {
    const terms = [];
    const seen = new Set();
    for (const text of queryTextsOf(query, variants)) {
        for (const term of queryTermsOf(text)) {
            if (seen.has(term))
                continue;
            seen.add(term);
            terms.push(term);
        }
    }
    return terms;
}
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
export function lexicalRouteScores(texts, chunks) {
    // One tokenization of the corpus, however many paraphrases score against it.
    const corpus = prepareCorpus(chunks);
    const best = new Map();
    for (const text of texts) {
        for (const entry of rankPrepared(text, corpus)) {
            if (entry.score <= 0)
                continue;
            const current = best.get(entry.index);
            if (current === undefined || entry.score > current)
                best.set(entry.index, entry.score);
        }
    }
    return best;
}
/**
 * Assign 1-based ranks per route: highest value first, ties by chunk index
 * ascending, matching `rankChunks`' own tie rule so a two-route fusion does not
 * invent an order the single-route answer would not have had.
 */
function ranksOf(scores) {
    const ordered = [...scores.entries()].sort((a, b) => {
        if (a[1] !== b[1])
            return b[1] - a[1];
        return a[0] - b[0];
    });
    const ranks = new Map();
    ordered.forEach(([index], position) => ranks.set(index, position + 1));
    return ranks;
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
export function fuseEvidenceRoutes(lexical, semantic) {
    const lexicalRanks = lexical === undefined ? new Map() : ranksOf(lexical);
    const semanticRanks = semantic === undefined ? new Map() : ranksOf(semantic);
    const routes = (lexical === undefined ? 0 : 1) + (semantic === undefined ? 0 : 1);
    if (routes === 0)
        return [];
    const ceiling = routes / (EVIDENCE_RRF_K + 1);
    const indices = new Set([...lexicalRanks.keys(), ...semanticRanks.keys()]);
    const fused = [];
    for (const index of indices) {
        const lexicalRank = lexicalRanks.get(index);
        const semanticRank = semanticRanks.get(index);
        let reciprocal = 0;
        if (lexicalRank !== undefined)
            reciprocal += 1 / (EVIDENCE_RRF_K + lexicalRank);
        if (semanticRank !== undefined)
            reciprocal += 1 / (EVIDENCE_RRF_K + semanticRank);
        const lexicalScore = lexical?.get(index);
        const semanticScore = semantic?.get(index);
        fused.push({
            index,
            score: reciprocal / ceiling,
            matchKind: lexicalRank !== undefined && semanticRank !== undefined
                ? 'hybrid'
                : lexicalRank !== undefined
                    ? 'lexical'
                    : 'semantic',
            ...(lexicalRank === undefined ? {} : { lexicalRank }),
            ...(semanticRank === undefined ? {} : { semanticRank }),
            ...(lexicalScore === undefined ? {} : { lexicalScore }),
            ...(semanticScore === undefined ? {} : { semanticScore }),
        });
    }
    return fused.sort((a, b) => {
        if (a.score !== b.score)
            return b.score - a.score;
        return a.index - b.index;
    });
}
/**
 * The core's lexical ranker: BM25 over the caller's chunk corpus, scored once
 * per query text, best score per chunk. It is the full answer when the
 * enrichment component is absent; with the component mounted, the hybrid
 * ranker uses it for the lexical route.
 *
 * `rank` is `async` so a throw before its first `await` rejects as a promise
 * instead of throwing synchronously into the caller's stack. Cancellation
 * rejects like any other strategy.
 */
export const bm25EvidenceRanker = {
    async rank(request) {
        request.signal?.throwIfAborted();
        assertUniqueChunkIndexes(request.chunks);
        const texts = queryTextsOf(request.query, request.queryVariants);
        if (texts.length === 0 || request.chunks.length === 0) {
            return { matches: [], routes: ['lexical'] };
        }
        const best = lexicalRouteScores(texts, request.chunks);
        request.signal?.throwIfAborted();
        return { matches: fuseEvidenceRoutes(best, undefined), routes: ['lexical'] };
    },
};
//# sourceMappingURL=evidence-ranker.js.map