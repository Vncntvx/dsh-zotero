/**
 * Fulltext outline extraction and passage ranking for `scholarly_read`.
 *
 * Segmentation and ranking are **the host's**: `chunkText` here and the
 * `EvidenceRanker` the host supplies, both from `src/evidence.ts` and
 * `src/local/evidence-ranker.ts`. A second splitter or a second ranker here
 * would cut a `scholarly_read query=` hit and a `zotero_retrieve` hit over the
 * same paper on different boundaries, or rank them by different rules: two
 * answers to "what is a passage" and "what counts as a match" for one library.
 * This module adds section addressing on top, nothing else.
 *
 * The offsets reported here are character spans of the source text, labelled
 * as such: `zotero_retrieve` reports ranked chunks, and a bare `offset` would
 * read as the same unit.
 *
 * @module dsh-zotero/scholarly/fulltext/evidence-bridge
 */
import type { EvidenceMatchKind, EvidenceRanker, EvidenceRoute } from '../../local/evidence-ranker.js';
interface SectionNode {
    id: string;
    level: number;
    title: string;
    start: number;
    end: number;
}
/** One ranked passage, carrying the character span it occupies in the source. */
export interface RankedPassage {
    /** First character index, inclusive. */
    start: number;
    /** Last character index, exclusive. */
    end: number;
    text: string;
    /**
     * The fused ordering value in [0, 1]. It is derived from rank position, so it
     * orders the answer and is not a strength measure; `lexicalScore` /
     * `semanticScore` carry each route's own magnitude.
     */
    score: number;
    /** Why the passage was returned: query words, meaning, or both. */
    matchKind: EvidenceMatchKind;
    /** The lexical route's own BM25 value; absent when that route missed. */
    lexicalScore?: number;
    /** The semantic route's own cosine value; absent when that route missed. */
    semanticScore?: number;
}
/**
 * Extracts hierarchical section outline from structured full text (Markdown, ar5iv/HTML, JATS).
 */
export declare function extractOutline(text: string): SectionNode[];
export declare function findSection(sections: readonly SectionNode[], query: string): SectionNode | undefined;
/** One ranking request over a source text. */
export interface RankPassagesOptions {
    /** The ranking strategy: the core's lexical ranker, or the hybrid one. */
    readonly ranker: EvidenceRanker;
    /** The source text to cut into passages. */
    readonly text: string;
    /** The reader's question. */
    readonly query: string;
    /** How many passages to return; default 5. */
    readonly limit?: number;
    /** Word ceiling per passage; must match `zotero_retrieve`'s chunking. */
    readonly maxWords?: number;
    /** Character ceiling per passage. */
    readonly maxCharsPerChunk?: number;
    /** Additional phrasings of the same question. */
    readonly queryVariants?: readonly string[];
    /** Caller cancellation, forwarded to the ranker. */
    readonly signal?: AbortSignal;
    /**
     * A ranking scope the caller admitted before source I/O. When present this
     * function forwards it and does not release it; the caller owns the lifetime.
     */
    readonly scope?: symbol;
}
/**
 * Ranks source passages against a natural-language query through the host's
 * ranking strategy over the host's own chunking.
 *
 * Chunk size is expressed in words with a character ceiling taken from the
 * core's live limits, so `scholarly_read query=` and `zotero_retrieve` cut the
 * same paper on the same passage boundaries and rank by the same rules.
 * @param options - the ranker, the text, the question, and the boundaries.
 * @returns the best-scoring passages with their character spans and the routes
 * that ran.
 */
export declare function rankPassages(options: RankPassagesOptions): Promise<{
    passages: RankedPassage[];
    routes: readonly EvidenceRoute[];
}>;
export {};
//# sourceMappingURL=evidence-bridge.d.ts.map