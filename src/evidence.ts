/**
 * Passage tokenization and BM25 ranking for `zotero_retrieve`.
 *
 * Evidence from every source — annotations, notes, the abstract, and
 * full-text chunks — is ranked uniformly as a small single-document corpus:
 * document frequencies are passage-level, so a term scores higher when it
 * is rare across the item's own passages. Ties keep the caller's passage
 * order, which makes the result deterministic.
 * @module dsh-zotero/evidence
 */

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

const BM25_K1 = 1.2
const BM25_B = 0.75

/** A word-granularity segmenter when the runtime provides one; the engine floor guarantees it, the check is defensive. */
function wordSegmenter(): Intl.Segmenter | undefined {
  return typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : undefined
}

/**
 * Lowercase word tokens of a text, in order. Word-aware segmentation keeps
 * scripts without spaces (CJK, Thai) queryable — a `\S+` tokenizer would
 * treat a whole unspaced run as one token and never match a single word.
 */
export function tokenize(text: string): string[] {
  const segmenter = wordSegmenter()
  if (segmenter === undefined) return text.toLowerCase().match(TOKEN_PATTERN) ?? []
  const tokens: string[] = []
  for (const segment of segmenter.segment(text.toLowerCase())) {
    if (segment.isWordLike) tokens.push(segment.segment)
  }
  return tokens
}

/** One full-text passage: its exact original substring plus its corpus position. */
export interface EvidenceChunk {
  readonly text: string
  readonly index: number
}

/** A word span in the source text: `[start, end)` character offsets. */
interface WordSpan {
  readonly start: number
  readonly end: number
}

/**
 * The word boundaries of a text. Word granularity uses ICU segmentation, so
 * scripts without spaces (CJK, Thai) still split into words instead of one
 * run-on span; whitespace splitting remains the fallback when the runtime
 * lacks `Intl.Segmenter` (the engine floor guarantees it, the check is
 * defensive).
 */
function wordSpansOf(text: string): WordSpan[] {
  const segmenter = wordSegmenter()
  if (segmenter === undefined) {
    return [...text.matchAll(/\S+/g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }))
  }
  const spans: WordSpan[] = []
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue
    spans.push({ start: segment.index, end: segment.index + segment.segment.length })
  }
  return spans
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
export function chunkText(
  text: string,
  maxWords: number,
  maxCharsPerChunk?: number,
): EvidenceChunk[] {
  const spans = wordSpansOf(text)
  if (spans.length === 0) return []
  const characterLimit =
    maxCharsPerChunk === undefined ? Number.POSITIVE_INFINITY : maxCharsPerChunk
  const chunks: EvidenceChunk[] = []
  let start = 0
  while (start < spans.length) {
    let end = start
    while (end < spans.length && end - start < maxWords) {
      const span = spans[end]!
      // The group's full text (interior whitespace included) must stay within
      // the character limit; `first.start` anchors the group's length.
      if (span.end - spans[start]!.start > characterLimit) break
      end += 1
    }
    if (end === start) {
      // A single span longer than the character limit is cut in place; leaving
      // it whole would make the chunk undigestible for the evidence budget.
      const span = spans[start]!
      let pos = span.start
      while (pos < span.end) {
        const stop = Math.min(pos + characterLimit, span.end)
        chunks.push({ text: text.slice(pos, stop), index: chunks.length })
        pos = stop
      }
      start += 1
    } else {
      const first = spans[start]!
      const last = spans[end - 1]!
      chunks.push({ text: text.slice(first.start, last.end), index: chunks.length })
      start = end
    }
  }
  return chunks
}

/** A ranked passage: the caller's original text, position, and BM25 score. */
export interface RankedChunk {
  readonly text: string
  readonly index: number
  readonly score: number
}

function termFrequency(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/**
 * Rank passages against a query with BM25 (k1=1.2, b=0.75) over the
 * passage corpus itself. Highest scores first; ties keep the original
 * index order. An empty query scores every passage zero.
 */
export function rankChunks(query: string, chunks: readonly EvidenceChunk[]): RankedChunk[] {
  const queryTokens = tokenize(query)
  const documents = chunks.map((chunk) => tokenize(chunk.text))
  const documentFrequency = new Map<string, number>()
  for (const tokens of documents) {
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }
  const averageLength =
    documents.length === 0
      ? 0
      : documents.reduce((sum, tokens) => sum + tokens.length, 0) / documents.length
  const ranked = chunks.map((chunk, i) => {
    const tokens = documents[i]!
    const frequencies = termFrequency(tokens)
    let score = 0
    for (const term of queryTokens) {
      const tf = frequencies.get(term)
      if (tf === undefined) continue
      // A term present in this document was counted into the df map above.
      const df = documentFrequency.get(term)!
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5))
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / averageLength))
      score += (idf * (tf * (BM25_K1 + 1))) / denominator
    }
    return { text: chunk.text, index: chunk.index, score }
  })
  return ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })
}
