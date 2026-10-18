/**
 * Shared string and metadata sanitizers for scholarly source adapters.
 * @module dsh-zotero/scholarly/sources/helpers
 */

import type { ScholarlyPaper } from '../types.js'

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

export function parseYear(value: unknown): number | undefined {
  const match = /\b(19|20)\d{2}\b/.exec(String(value ?? ''))
  const year = match ? Number(match[0]) : undefined
  return year && Number.isFinite(year) && year >= 1800 ? year : undefined
}

/**
 * Drop the fields an index did not supply.
 *
 * A record with `title: ''` is not a record with a title: adapters filter on
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
