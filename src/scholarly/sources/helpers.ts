/**
 * Shared string and metadata sanitizers for scholarly source adapters.
 * @module dsh-zotero/scholarly/sources/helpers
 */

import type { ScholarlyPaper } from '../types.js'
import { httpStatusOf } from '../transport/http.js'

/**
 * Await a promise and convert HTTP 404 Not Found into `undefined`.
 * Any other HTTP status or network failure is rethrown.
 */
export async function ignoreNotFound<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if (httpStatusOf(error) === 404) return undefined
    throw error
  }
}

/**
 * Papers that carry a non-empty title. Every adapter drops the rest from its
 * result lists; the one spelling keeps the drop rule from drifting between
 * them.
 * @param papers - the mapped results of one source response.
 * @returns the papers with a non-empty title.
 */
export function titled(papers: ScholarlyPaper[]): ScholarlyPaper[] {
  return papers.filter((p) => (p.title ?? '') !== '')
}

/**
 * Combine a base search query with additional filter clauses.
 * When multiple clauses exist, parenthesizes the base query and joins with AND.
 */
export function combineSearchClauses(baseQuery: string, additionalClauses: string[]): string {
  const clauses = [baseQuery, ...additionalClauses]
  return clauses.length === 1
    ? clauses[0]!
    : clauses.map((c, idx) => (idx === 0 ? `(${c})` : c)).join(' AND ')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  times: '×',
  minus: '−',
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all)
}

export function cleanDoi(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const doi = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '')
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : undefined
}

export function plain(value: unknown): string {
  if (typeof value !== 'string') return ''
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull the text out of a parsed XML node: either the string itself, or the
 * `#text` member when the parser split it into attributes.
 * @param value - the parsed node or primitive value.
 * @returns cleaned plain string.
 */
export function xmlTextVal(value: unknown): string {
  if (typeof value === 'string') return plain(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null) {
    return plain(String((value as { '#text'?: unknown })['#text'] ?? ''))
  }
  return ''
}

export function parseYear(value: unknown): number | undefined {
  const match = /\b(19|20)\d{2}\b/.exec(String(value ?? ''))
  const year = match ? Number(match[0]) : undefined
  return year && Number.isFinite(year) && year >= 1800 ? year : undefined
}

/**
 * Drop the fields an index did not supply.
 *
 * A record with `title: ''` is not a record with a title. Adapters filter on
 * `(title ?? '') !== ''`, so an empty string must leave the field absent rather
 * than present-and-empty. `Object.entries` erases the per-key type, so the
 * result is rebuilt through a typed accumulator instead of a blanket cast.
 * @param raw - the candidate record.
 * @returns the same record without absent or empty fields.
 */
export function stripEmptyFields(raw: Partial<ScholarlyPaper>): ScholarlyPaper {
  const out: Partial<ScholarlyPaper> = {}
  for (const key of Object.keys(raw) as Array<keyof ScholarlyPaper>) {
    const value = raw[key]
    if (value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    // One assignment per declared key; the index signature keeps it typed.
    ;(out as Record<string, unknown>)[key] = value
  }
  // Every remaining field came from a `Partial<ScholarlyPaper>` key.
  return out as ScholarlyPaper
}

export function encodeQueryParams(
  params: Record<string, string | number | boolean | undefined>,
): string {
  return Object.entries(params)
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined && entry[1] !== '',
    )
    .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`)
    .join('&')
}
