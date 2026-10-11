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
 * @module dsh-zotero/evidence
 */
import { normalizeForSearch } from './search-text.js';
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** Shared word-granularity segmenter; constructed once (engine floor guarantees it).
 * Cached by constructor so test-time `Intl.Segmenter` stubs re-resolve instead
 * of reading a stale instance; the live engine never swaps the constructor, so
 * the cache stays a singleton in production with no leak or race (single
 * thread, stateless segmenter). */
let sharedWordSegmenter;
let cachedSegmenterCtor;
function wordSegmenter() {
    if (typeof Intl.Segmenter !== 'function')
        return undefined;
    if (sharedWordSegmenter !== undefined && cachedSegmenterCtor === Intl.Segmenter) {
        return sharedWordSegmenter;
    }
    sharedWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    cachedSegmenterCtor = Intl.Segmenter;
    return sharedWordSegmenter;
}
/**
 * Lowercase word tokens of a text, in order, folded the way Zotero folds its
 * own search index ({@link normalizeForSearch}) so a query the server matched
 * can also match passage text here. Word-aware segmentation keeps scripts
 * without spaces (CJK, Thai) queryable; a `\S+` tokenizer would treat a
 * whole unspaced run as one token and never match a single word.
 */
export function tokenize(text) {
    const segmenter = wordSegmenter();
    const folded = normalizeForSearch(text);
    if (segmenter === undefined)
        return folded.match(TOKEN_PATTERN) ?? [];
    const tokens = [];
    for (const segment of segmenter.segment(folded)) {
        if (segment.isWordLike)
            tokens.push(segment.segment);
    }
    return tokens;
}
/**
 * The word boundaries of a text. Word granularity uses ICU segmentation, so
 * scripts without spaces (CJK, Thai) still split into words instead of one
 * run-on span; whitespace splitting remains the fallback when the runtime
 * lacks `Intl.Segmenter` (the engine floor guarantees it, the check is
 * defensive).
 */
function wordSpansOf(text) {
    const segmenter = wordSegmenter();
    if (segmenter === undefined) {
        return [...text.matchAll(/\S+/g)].map((match) => ({
            start: match.index,
            end: match.index + match[0].length,
        }));
    }
    const spans = [];
    for (const segment of segmenter.segment(text)) {
        if (!segment.isWordLike)
            continue;
        spans.push({ start: segment.index, end: segment.index + segment.segment.length });
    }
    return spans;
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
export function chunkText(text, maxWords, maxCharsPerChunk) {
    const spans = wordSpansOf(text);
    if (spans.length === 0)
        return [];
    const characterLimit = maxCharsPerChunk === undefined ? Number.POSITIVE_INFINITY : maxCharsPerChunk;
    const chunks = [];
    let start = 0;
    while (start < spans.length) {
        let end = start;
        while (end < spans.length && end - start < maxWords) {
            const span = spans[end];
            // The group's full text (interior whitespace included) must stay within
            // the character limit; `first.start` anchors the group's length.
            if (span.end - spans[start].start > characterLimit)
                break;
            end += 1;
        }
        if (end === start) {
            // A single span longer than the character limit is cut in place; leaving
            // it whole would make the chunk undigestible for the evidence budget.
            const span = spans[start];
            let pos = span.start;
            while (pos < span.end) {
                const stop = Math.min(pos + characterLimit, span.end);
                chunks.push({ text: text.slice(pos, stop), index: chunks.length });
                pos = stop;
            }
            start += 1;
        }
        else {
            const first = spans[start];
            const last = spans[end - 1];
            chunks.push({ text: text.slice(first.start, last.end), index: chunks.length });
            start = end;
        }
    }
    return chunks;
}
function termFrequency(tokens) {
    const counts = new Map();
    for (const token of tokens)
        counts.set(token, (counts.get(token) ?? 0) + 1);
    return counts;
}
/**
 * Rank passages against a query with BM25 (k1=1.2, b=0.75) over the
 * passage corpus itself. Highest scores first; ties keep the original
 * index order. An empty query scores every passage zero.
 */
export function rankChunks(query, chunks) {
    const queryTokens = tokenize(query);
    const documents = chunks.map((chunk) => tokenize(chunk.text));
    const documentFrequency = new Map();
    for (const tokens of documents) {
        for (const term of new Set(tokens)) {
            documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
        }
    }
    const averageLength = documents.length === 0
        ? 0
        : documents.reduce((sum, tokens) => sum + tokens.length, 0) / documents.length;
    const idfMap = new Map();
    for (const term of new Set(queryTokens)) {
        const df = documentFrequency.get(term);
        if (df !== undefined) {
            idfMap.set(term, Math.log(1 + (documents.length - df + 0.5) / (df + 0.5)));
        }
    }
    const ranked = chunks.map((chunk, i) => {
        const tokens = documents[i];
        const frequencies = termFrequency(tokens);
        let score = 0;
        for (const term of queryTokens) {
            const tf = frequencies.get(term);
            if (tf === undefined)
                continue;
            const idf = idfMap.get(term) ?? 0;
            const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / averageLength));
            score += (idf * (tf * (BM25_K1 + 1))) / denominator;
        }
        return { text: chunk.text, index: chunk.index, score };
    });
    return ranked.sort((a, b) => {
        if (a.score !== b.score)
            return b.score - a.score;
        return a.index - b.index;
    });
}
//# sourceMappingURL=evidence.js.map