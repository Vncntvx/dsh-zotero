/**
 * Passage tokenization and BM25 ranking for `zotero_retrieve`.
 *
 * Evidence from every source — annotations, notes, the abstract, and
 * full-text chunks — is ranked uniformly as a small single-document corpus:
 * document frequencies are passage-level, so a term scores higher when it
 * is rare across the item's own passages. Ties keep the caller's passage
 * order, which makes the result deterministic. Terms are folded with
 * Zotero's own search normalization, so the plugin's ranking and the
 * server's search agree on what matches; the passage text returned is the
 * original, unfolded string.
 * @module dsh-zotero/evidence
 */
/**
 * Lowercase word tokens of a text, in order, folded the way Zotero folds its
 * own search index ({@link normalizeForSearch}) so a query the server matched
 * can also match passage text here. Word-aware segmentation keeps scripts
 * without spaces (CJK, Thai) queryable — a `\S+` tokenizer would treat a
 * whole unspaced run as one token and never match a single word.
 */
export declare function tokenize(text: string): string[];
/** One full-text passage: its exact original substring plus its corpus position. */
export interface EvidenceChunk {
    readonly text: string;
    readonly index: number;
}
/**
 * Cut a text into word-count chunks, preserving the original spans (including
 * interior whitespace) so passages stay verbatim. A chunk also never exceeds
 * `maxCharsPerChunk` when given: the word group closes before the next word
 * would cross the character limit, and a single overlong word is cut in
 * place — bounds that keep every chunk acceptable to a character budget.
 * @param text - the source text to chunk.
 * @param maxWords - hard word-count ceiling per chunk.
 * @param maxCharsPerChunk - optional character ceiling per chunk; omitted keeps
 *   the pure word-count behavior.
 * @returns the bounded chunks in source order.
 */
export declare function chunkText(text: string, maxWords: number, maxCharsPerChunk?: number): EvidenceChunk[];
/** A ranked passage: the caller's original text, position, and BM25 score. */
export interface RankedChunk {
    readonly text: string;
    readonly index: number;
    readonly score: number;
}
/**
 * Rank passages against a query with BM25 (k1=1.2, b=0.75) over the
 * passage corpus itself. Highest scores first; ties keep the original
 * index order. An empty query scores every passage zero.
 */
export declare function rankChunks(query: string, chunks: readonly EvidenceChunk[]): RankedChunk[];
//# sourceMappingURL=evidence.d.ts.map