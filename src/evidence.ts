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

import { normalizeForSearch } from './search-text.js'

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

const BM25_K1 = 1.2
const BM25_B = 0.75

/**
 * Function words removed from the *query scoring side* only. BM25 here takes
 * its idf from the passage corpus of one item, not from a library-wide
 * collection: in a natural-language question, words such as `the`, `of`, `and`
 * (or 的 / 和 / 在) still draw a positive idf and can outrank a passage that
 * actually answers the question. Dropping them at scoring time removes that
 * pseudo-evidence without touching `normalizeForSearch`, `tokenize`, or the
 * returned text.
 *
 * No document-frequency cap is applied on top of this list. A term that occurs
 * in every passage of a homogeneous text (for example `attention` in a paper
 * entirely about attention) is still the user's term: zeroing its idf would
 * make a legitimate single-term query return no evidence at all.
 */
const QUERY_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // English determiners, conjunctions, prepositions, auxiliaries, pronouns,
  // question words and common connectives.
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'another',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'down',
  'during',
  'each',
  'either',
  'every',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'here',
  'how',
  'however',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'less',
  'may',
  'me',
  'might',
  'more',
  'most',
  'must',
  'my',
  'neither',
  'no',
  'nor',
  'not',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'per',
  'same',
  'shall',
  'she',
  'should',
  'since',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'therefore',
  'these',
  'they',
  'this',
  'those',
  'though',
  'through',
  'thus',
  'to',
  'under',
  'until',
  'up',
  'upon',
  'very',
  'via',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'while',
  'who',
  'whom',
  'whose',
  'why',
  'will',
  'with',
  'within',
  'without',
  'would',
  'you',
  'your',
  // Chinese function words and question connectives.
  '的',
  '地',
  '得',
  '了',
  '着',
  '过',
  '和',
  '与',
  '或',
  '及',
  '并',
  '而',
  '且',
  '但',
  '则',
  '在',
  '于',
  '是',
  '有',
  '为',
  '被',
  '把',
  '让',
  '使',
  '从',
  '对',
  '向',
  '以',
  '之',
  '其',
  '这',
  '那',
  '些',
  '个',
  '们',
  '我',
  '你',
  '他',
  '她',
  '它',
  '什么',
  '怎么',
  '怎样',
  '如何',
  '为何',
  '为什么',
  '哪些',
  '哪个',
  '是否',
  '可以',
  '能够',
  '需要',
  '应该',
  '关于',
  '通过',
  '根据',
  '由于',
  '对于',
  '以及',
  '并且',
  '但是',
  '因为',
  '所以',
  '如果',
  '虽然',
  '然而',
  '其中',
  '之间',
  '一个',
  '一种',
  '一些',
  '这些',
  '那些',
  '这里',
  '那里',
  '同时',
  '另外',
  '此外',
  '例如',
  '比如',
])

/**
 * The distinct query terms BM25 will score, in first-occurrence order.
 * Function words are dropped and repeated terms are counted once, so a query
 * like `trust trust trust` cannot multiply its own weight. This is the public
 * seam used by the evidence contract to report which lexical terms were used;
 * it never rewrites the folded index or the passage text.
 */
export function queryTermsOf(query: string): string[] {
  const terms: string[] = []
  for (const term of new Set(tokenize(query))) {
    if (QUERY_FUNCTION_WORDS.has(term)) continue
    terms.push(term)
  }
  return terms
}

/** Shared word-granularity segmenter; constructed once (engine floor guarantees it).
 * Cached by constructor so test-time `Intl.Segmenter` stubs re-resolve instead
 * of reading a stale instance; the live engine never swaps the constructor, so
 * the cache stays a singleton in production with no leak or race (single
 * thread, stateless segmenter). */
let sharedWordSegmenter: Intl.Segmenter | undefined
let cachedSegmenterCtor: unknown
function wordSegmenter(): Intl.Segmenter | undefined {
  if (typeof Intl.Segmenter !== 'function') return undefined
  if (sharedWordSegmenter !== undefined && cachedSegmenterCtor === Intl.Segmenter) {
    return sharedWordSegmenter
  }
  sharedWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  cachedSegmenterCtor = Intl.Segmenter
  return sharedWordSegmenter
}

/**
 * Lowercase word tokens of a text, in order, folded the way Zotero folds its
 * own search index ({@link normalizeForSearch}) so a query the server matched
 * can also match passage text here. Word-aware segmentation keeps scripts
 * without spaces (CJK, Thai) queryable; a `\S+` tokenizer would treat a
 * whole unspaced run as one token and never match a single word.
 */
export function tokenize(text: string): string[] {
  const segmenter = wordSegmenter()
  const folded = normalizeForSearch(text)
  if (segmenter === undefined) return folded.match(TOKEN_PATTERN) ?? []
  const tokens: string[] = []
  for (const segment of segmenter.segment(folded)) {
    if (segment.isWordLike) tokens.push(segment.segment)
  }
  return tokens
}

/** One full-text passage: its exact original substring plus its corpus position. */
export interface EvidenceChunk {
  readonly text: string
  readonly index: number
  readonly start?: number
  readonly end?: number
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
 * place: bounds that keep every chunk acceptable to a character budget.
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
        chunks.push({
          text: text.slice(pos, stop),
          index: chunks.length,
          start: pos,
          end: stop,
        })
        pos = stop
      }
      start += 1
    } else {
      const first = spans[start]!
      const last = spans[end - 1]!
      chunks.push({
        text: text.slice(first.start, last.end),
        index: chunks.length,
        start: first.start,
        end: last.end,
      })
      start = end
    }
  }
  return chunks
}

/** A ranked passage: the caller's original text, position, and BM25 score. */
interface RankedChunk {
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
 * A corpus prepared once for repeated scoring: the tokenized documents and
 * the statistics BM25 derives from them. Every query text over the same
 * passages reuses this, so N paraphrases cost N scoring passes and exactly
 * one tokenization of the corpus.
 */
export interface PreparedCorpus {
  /** The corpus's own texts, in caller order. */
  readonly texts: readonly string[]
  readonly documents: readonly (readonly string[])[]
  readonly averageLength: number
  /** Documents containing each term at least once. */
  documentFrequency(term: string): number
  /** Term frequencies inside one document, by corpus position. */
  termFrequencies(position: number): ReadonlyMap<string, number>
}

/**
 * Tokenize and index a chunk corpus once. `rankChunks` is the single-query
 * convenience over this; the evidence ranker calls this directly when it has
 * several query texts to score.
 * @param chunks - the corpus, in caller order.
 */
export function prepareCorpus(chunks: readonly EvidenceChunk[]): PreparedCorpus {
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
  const frequencyCache = new Map<number, ReadonlyMap<string, number>>()
  return {
    texts: chunks.map((chunk) => chunk.text),
    documents,
    averageLength,
    documentFrequency: (term) => documentFrequency.get(term) ?? 0,
    termFrequencies: (position) => {
      const cached = frequencyCache.get(position)
      if (cached !== undefined) return cached
      const computed = termFrequency(documents[position] ?? [])
      frequencyCache.set(position, computed)
      return computed
    },
  }
}

/**
 * Rank passages against a query with BM25 (k1=1.2, b=0.75) over the
 * passage corpus itself. Highest scores first; ties keep the original
 * index order. An empty query scores every passage zero. Query terms are
 * deduplicated and stripped of function words before scoring; the passage
 * side is tokenized unchanged.
 */
export function rankChunks(query: string, chunks: readonly EvidenceChunk[]): RankedChunk[] {
  return rankPrepared(query, prepareCorpus(chunks))
}

/**
 * Score one query text against an already-prepared corpus. Same ordering and
 * tie rules as {@link rankChunks}; zero allocation on the passage side.
 * @param query - one query text.
 * @param corpus - the prepared corpus.
 */
export function rankPrepared(query: string, corpus: PreparedCorpus): RankedChunk[] {
  const queryTokens = queryTermsOf(query)
  const documents = corpus.documents
  const idfMap = new Map<string, number>()
  for (const term of queryTokens) {
    const df = corpus.documentFrequency(term)
    if (df > 0) {
      idfMap.set(term, Math.log(1 + (documents.length - df + 0.5) / (df + 0.5)))
    }
  }
  const ranked = documents.map((tokens, position) => {
    const frequencies = corpus.termFrequencies(position)
    let score = 0
    for (const term of queryTokens) {
      const tf = frequencies.get(term)
      if (tf === undefined) continue
      const idf = idfMap.get(term) ?? 0
      const denominator =
        tf + BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / corpus.averageLength))
      score += (idf * (tf * (BM25_K1 + 1))) / denominator
    }
    return { text: corpus.texts[position] ?? '', index: position, score }
  })
  return ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })
}
