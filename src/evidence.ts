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

/** Lowercase alphanumeric tokens of a text, in order. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? []
}

/** One full-text passage: its exact original substring plus its corpus position. */
export interface EvidenceChunk {
  readonly text: string
  readonly index: number
}

/**
 * Cut a text into hard word-count chunks, preserving the original spans
 * (including interior whitespace) so passages stay verbatim.
 */
export function chunkText(text: string, maxWords: number): EvidenceChunk[] {
  const spans = [...text.matchAll(/\S+/g)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
  const chunks: EvidenceChunk[] = []
  for (let start = 0; start < spans.length; start += maxWords) {
    const group = spans.slice(start, start + maxWords)
    const first = group[0]!
    const last = group[group.length - 1]!
    chunks.push({ text: text.slice(first.start, last.end), index: chunks.length })
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
  const averageLength = documents.length === 0
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
      score += idf * (tf * (BM25_K1 + 1)) / denominator
    }
    return { text: chunk.text, index: chunk.index, score }
  })
  return ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })
}
