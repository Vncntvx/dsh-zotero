/**
 * Passage tokenization and BM25 ranking for `zotero_retrieve`.
 *
 * Evidence from every source (annotations, notes, the abstract, and full-text
 * chunks) is ranked uniformly as a small single-document corpus:
 * document frequencies are passage-level, so a term scores higher when it
 * is rare across the item's own passages. Ties keep the caller's passage
 * order, which makes the result deterministic. Terms are folded with
 * Zotero's own search normalization, so the plugin's ranking and the
 * server's search agree on what matches; the passage text returned is the
 * original, unfolded string.
 *
 * Query terms are normalized on the **scoring side only**: function words are
 * dropped and duplicate terms are counted once. Folding is never replaced or
 * rewritten, so `src/search-text.ts` stays the single mirror of Zotero's own
 * index and passage text stays verbatim.
 * @module dsh-zotero/evidence
 */
/**
 * The distinct query terms BM25 will score, in first-occurrence order.
 * Function words are dropped and repeated terms are counted once, so a query
 * like `trust trust trust` cannot multiply its own weight. This is the public
 * seam used by the evidence contract to report which lexical terms were used;
 * it never rewrites the folded index or the passage text.
 */
export declare function queryTermsOf(query: string): string[];
/**
 * Lowercase word tokens of a text, in order, folded the way Zotero folds its
 * own search index ({@link normalizeForSearch}) so a query the server matched
 * can also match passage text here. Word-aware segmentation keeps scripts
 * without spaces (CJK, Thai) queryable; a `\S+` tokenizer would treat a
 * whole unspaced run as one token and never match a single word.
 */
export declare function tokenize(text: string): string[];
/** One full-text passage: its exact original substring plus its corpus position. */
export interface EvidenceChunk {
    readonly text: string;
    readonly index: number;
    readonly start?: number;
    readonly end?: number;
}
/**
 * Cut a text into word-count chunks, preserving the original spans (including
 * interior whitespace) so passages stay verbatim. A chunk also never exceeds
 * `maxCharsPerChunk` when given: the word group closes before the next word
 * would cross the character limit, and a single overlong word is cut in
 * place: bounds that keep every chunk acceptable to a character budget.
 * @param text - the source text to chunk.
 * @param maxWords - hard word-count ceiling per chunk.
 * @param maxCharsPerChunk - optional character ceiling per chunk; omitted keeps
 *   the pure word-count behavior.
 * @returns the bounded chunks in source order.
 */
export declare function chunkText(text: string, maxWords: number, maxCharsPerChunk?: number): EvidenceChunk[];
/** A ranked passage: the caller's original text, position, and BM25 score. */
interface RankedChunk {
    readonly text: string;
    readonly index: number;
    readonly score: number;
}
/**
 * A corpus prepared once for repeated scoring: the tokenized documents and
 * the statistics BM25 derives from them. Every query text over the same
 * passages reuses this, so N paraphrases cost N scoring passes and exactly
 * one tokenization of the corpus.
 */
export interface PreparedCorpus {
    /** The corpus's own texts, in caller order. */
    readonly texts: readonly string[];
    /**
     * The caller's own handles, in the same order as `texts`. Corpus positions
     * are an implementation detail: a caller may pass sparse, negative, or
     * reordered indices, and every ranked result must carry the original handle.
     */
    readonly indexes: readonly number[];
    readonly documents: readonly (readonly string[])[];
    readonly averageLength: number;
    /** Documents containing each term at least once. */
    documentFrequency(term: string): number;
    /** Term frequencies inside one document, by corpus position. */
    termFrequencies(position: number): ReadonlyMap<string, number>;
}
/**
 * Tokenize and index a chunk corpus once. `rankChunks` is the single-query
 * convenience over this; the evidence ranker calls this directly when it has
 * several query texts to score.
 * @param chunks - the corpus, in caller order.
 */
export declare function prepareCorpus(chunks: readonly EvidenceChunk[]): PreparedCorpus;
/**
 * Rank passages against a query with BM25 (k1=1.2, b=0.75) over the
 * passage corpus itself. Highest scores first; ties keep the original
 * index order. An empty query scores every passage zero. Query terms are
 * deduplicated and stripped of function words before scoring; the passage
 * side is tokenized unchanged.
 */
export declare function rankChunks(query: string, chunks: readonly EvidenceChunk[]): RankedChunk[];
/**
 * Score one query text against an already-prepared corpus. Same ordering and
 * tie rules as {@link rankChunks}; zero allocation on the passage side.
 * @param query - one query text.
 * @param corpus - the prepared corpus.
 */
export declare function rankPrepared(query: string, corpus: PreparedCorpus): RankedChunk[];
export {};
//# sourceMappingURL=evidence.d.ts.map