/**
 * Fulltext outline extraction and BM25 passage ranking for `scholarly_read`.
 *
 * Segmentation and ranking are **the host's**: `chunkText` and `rankChunks`
 * from `src/evidence.ts`. A second splitter here would cut a
 * `scholarly_read query=` hit and a `zotero_retrieve` hit over the same paper
 * on different boundaries, two answers to "what is a passage" for one library.
 * This module adds section addressing on top, nothing else.
 *
 * The offsets reported here are character spans of the source text, labelled
 * as such: `zotero_retrieve` reports ranked chunks, and a bare `offset` would
 * read as the same unit.
 *
 * @module dsh-zotero/scholarly/fulltext/evidence-bridge
 */
interface SectionNode {
    id: string;
    level: number;
    title: string;
    start: number;
    end: number;
}
/** One ranked passage, carrying the character span it occupies in the source. */
interface RankedPassage {
    /** First character index, inclusive. */
    start: number;
    /** Last character index, exclusive. */
    end: number;
    text: string;
    score: number;
}
/**
 * Extracts hierarchical section outline from structured full text (Markdown, ar5iv/HTML, JATS).
 */
export declare function extractOutline(text: string): SectionNode[];
export declare function findSection(sections: readonly SectionNode[], query: string): SectionNode | undefined;
/**
 * Ranks source passages against a natural-language query with the host's BM25
 * implementation over the host's own chunking.
 *
 * Chunk size is expressed in words with a character ceiling, matching
 * `zotero_retrieve`, so both tools describe the same paper with the same
 * passage boundaries.
 * @param text - the source text.
 * @param query - the reader's question.
 * @param limit - how many passages to return.
 * @param maxWords - word ceiling per passage.
 * @param maxCharsPerChunk - optional character ceiling per passage.
 * @returns the best-scoring passages, each carrying its character span.
 */
export declare function rankPassagesWithBM25(text: string, query: string, limit?: number, maxWords?: number, maxCharsPerChunk?: number): RankedPassage[];
export {};
//# sourceMappingURL=evidence-bridge.d.ts.map