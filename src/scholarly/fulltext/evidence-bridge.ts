/**
 * Fulltext outline extraction and BM25 passage ranking for `scholarly_read`.
 *
 * Segmentation and ranking are **the host's**: `chunkText` and `rankChunks`
 * from `src/evidence.ts`. This module used to carry its own 1200-character
 * splitter, which put a `scholarly_read query=` hit and a `zotero_retrieve` hit
 * over the same paper on different boundaries — two answers to "what is a
 * passage" for one library. It adds section addressing on top, nothing else.
 *
 * The offsets reported here are character spans of the source text, labelled
 * as such: `zotero_retrieve` reports ranked chunks, and a bare `offset` would
 * read as the same unit.
 *
 * @module dsh-zotero/scholarly/fulltext/evidence-bridge
 */

import { chunkText, rankChunks } from '../../evidence.js'

export interface SectionNode {
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
  score: number
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
export function rankPassagesWithBM25(
  text: string,
  query: string,
  limit = 5,
  maxWords = 180,
  maxCharsPerChunk = 1_200,
): RankedPassage[] {
  if (query.trim() === '') return []
  const chunks = chunkText(text, maxWords, maxCharsPerChunk)
  if (chunks.length === 0) return []

  const ranked = rankChunks(query, chunks)
  const spans = chunkSpansOf(chunks, text)

  return ranked
    .filter((entry) => entry.score > 0)
    .slice(0, limit)
    .map((entry) => {
      const span = spans[entry.index]
      return {
        start: span?.start ?? 0,
        end: span?.end ?? 0,
        text: entry.text,
        score: entry.score,
      }
    })
}

/**
 * The character span each chunk occupies in the source text.
 *
 * `chunkText` returns only text, so the span is recovered by walking the
 * chunks in order and locating each one after the previous match. A chunk that
 * cannot be located keeps the previous position rather than inventing one.
 * @param chunks - the ordered chunks.
 * @param text - the source text they came from.
 * @returns one span per chunk, in the same order.
 */
function chunkSpansOf(
  chunks: ReturnType<typeof chunkText>,
  text: string,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const chunk of chunks) {
    const found = text.indexOf(chunk.text, cursor)
    const start = found >= 0 ? found : cursor
    const end = start + chunk.text.length
    spans.push({ start, end })
    cursor = end
  }
  return spans
}
