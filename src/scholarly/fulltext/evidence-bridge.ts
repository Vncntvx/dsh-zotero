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

import { chunkText } from '../../evidence.js'
import type {
  EvidenceMatchKind,
  EvidenceRanker,
  EvidenceRoute,
} from '../../local/evidence-ranker.js'

interface SectionNode {
  id: string
  level: number
  title: string
  start: number
  end: number
}

/** One ranked passage, carrying the character span it occupies in the source. */
export interface RankedPassage {
  /** First character index, inclusive. */
  start: number
  /** Last character index, exclusive. */
  end: number
  text: string
  /**
   * The fused ordering value in [0, 1]. It is derived from rank position, so it
   * orders the answer and is not a strength measure; `lexicalScore` /
   * `semanticScore` carry each route's own magnitude.
   */
  score: number
  /** Why the passage was returned: query words, meaning, or both. */
  matchKind: EvidenceMatchKind
  /** The lexical route's own BM25 value; absent when that route missed. */
  lexicalScore?: number
  /** The semantic route's own cosine value; absent when that route missed. */
  semanticScore?: number
}

/**
 * Extracts hierarchical section outline from structured full text (Markdown, ar5iv/HTML, JATS).
 */
export function extractOutline(text: string): SectionNode[] {
  const sections: SectionNode[] = []
  // Matches markdown headings e.g. "# 1. Introduction" or "## 2. Method"
  const mdHeadingRegex = /^(#{1,4})\s+(?:(\d+(?:\.\d+)*)\.?\s*)?([^\n]+)$/gm

  let match: RegExpExecArray | null
  const matches: Array<{ level: number; num?: string; title: string; index: number }> = []

  while ((match = mdHeadingRegex.exec(text)) !== null) {
    const level = match[1]!.length
    const num = match[2]
    const title = match[3]!.trim()
    matches.push({ level, num, title, index: match.index })
  }

  const usedIds = new Set<string>()
  const hasNumbered = matches.some((m) => m.num !== undefined)

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!
    const next = matches[i + 1]
    const start = current.index
    const end = next ? next.index : text.length
    let id = current.num ?? (hasNumbered ? `s${i + 1}` : String(i + 1))
    if (usedIds.has(id)) {
      id = `${id}-${i + 1}`
    }
    usedIds.add(id)

    sections.push({
      id,
      level: current.level,
      title: current.title,
      start,
      end,
    })
  }

  return sections
}

export function findSection(
  sections: readonly SectionNode[],
  query: string,
): SectionNode | undefined {
  const needle = query.trim().toLowerCase()
  if (!needle) return undefined

  // 1. Exact ID match (e.g. "3" or "3.1")
  const byId = sections.find((s) => s.id.toLowerCase() === needle)
  if (byId) return byId

  // 2. Exact Title match
  const byExactTitle = sections.find((s) => s.title.toLowerCase() === needle)
  if (byExactTitle) return byExactTitle

  // 3. Substring match
  return sections.find((s) => s.title.toLowerCase().includes(needle))
}

/** One ranking request over a source text. */
export interface RankPassagesOptions {
  /** The ranking strategy: the core's lexical ranker, or the hybrid one. */
  readonly ranker: EvidenceRanker
  /** The source text to cut into passages. */
  readonly text: string
  /** The reader's question. */
  readonly query: string
  /** How many passages to return; default 5. */
  readonly limit?: number
  /** Word ceiling per passage; must match `zotero_retrieve`'s chunking. */
  readonly maxWords?: number
  /** Character ceiling per passage. */
  readonly maxCharsPerChunk?: number
  /** Additional phrasings of the same question. */
  readonly queryVariants?: readonly string[]
  /** Caller cancellation, forwarded to the ranker. */
  readonly signal?: AbortSignal
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
export async function rankPassages(options: RankPassagesOptions): Promise<{
  passages: RankedPassage[]
  routes: readonly EvidenceRoute[]
}> {
  const limit = options.limit ?? 5
  const maxWords = options.maxWords ?? 180
  const maxCharsPerChunk = options.maxCharsPerChunk ?? 1_200
  if (options.query.trim() === '') return { passages: [], routes: [] }
  // Admit before chunking: the accepted request keeps its committed ranking
  // generation for the whole read, even if the component unmounts mid-passage.
  const scope = options.ranker.admit?.()
  try {
    const chunks = chunkText(options.text, maxWords, maxCharsPerChunk)
    if (chunks.length === 0) return { passages: [], routes: [] }
    const result = await options.ranker.rank({
      query: options.query,
      ...(options.queryVariants === undefined ? {} : { queryVariants: options.queryVariants }),
      chunks,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(scope === undefined ? {} : { scope: scope.handle }),
    })

    const passages: RankedPassage[] = []
    for (const entry of result.matches) {
      if (passages.length >= limit) break
      // A ranker contract violation (unknown index) is skipped rather than
      // rendered as an empty passage with fabricated offsets.
      const chunk = chunks[entry.index]
      if (chunk === undefined) continue
      passages.push({
        start: chunk.start ?? 0,
        end: chunk.end ?? 0,
        text: chunk.text,
        score: entry.score,
        matchKind: entry.matchKind,
        ...(entry.lexicalScore === undefined ? {} : { lexicalScore: entry.lexicalScore }),
        ...(entry.semanticScore === undefined ? {} : { semanticScore: entry.semanticScore }),
      })
    }
    return { passages, routes: result.routes }
  } finally {
    scope?.release()
  }
}
