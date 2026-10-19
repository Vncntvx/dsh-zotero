/**
 * Crossref adapter querying api.crossref.org for official publisher metadata and retractions.
 * @module dsh-zotero/scholarly/sources/crossref
 */

import { httpStatusOf, type ScholarlyHttp } from '../transport/http.js'
import {
  SCHOLARLY_SOURCE_NAMES,
  type ScholarlyKeys,
  type ScholarlyPaper,
  type ScholarlyQuery,
} from '../types.js'
import { cleanDoi, encodeQueryParams, parseYear, plain, stripEmptyFields } from './helpers.js'

export interface CrossrefWork {
  DOI?: string
  title?: string[]
  author?: Array<{ given?: string; family?: string; name?: string }>
  issued?: { 'date-parts'?: Array<Array<number | null>> }
  'published-print'?: { 'date-parts'?: Array<Array<number | null>> }
  'published-online'?: { 'date-parts'?: Array<Array<number | null>> }
  'container-title'?: string[]
  abstract?: string
  type?: string
  'is-referenced-by-count'?: number
  URL?: string
  'update-to'?: Array<{ type?: string; DOI?: string }>
}

export function paperFromCrossref(work: CrossrefWork): ScholarlyPaper {
  const datePartsObj =
    work.issued?.['date-parts']?.[0] ??
    work['published-print']?.['date-parts']?.[0] ??
    work['published-online']?.['date-parts']?.[0]
  const parts: number[] =
    datePartsObj?.filter((p: number | null): p is number => typeof p === 'number') ?? []
  const doi = cleanDoi(work.DOI)

  const isRetracted = (work['update-to'] ?? []).some((update) =>
    /retract|withdraw/i.test(update.type ?? ''),
  )

  const authors = (work.author ?? [])
    .map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(' '))
    .filter(Boolean)

  const dateStr =
    parts.length > 1
      ? parts.map((part, idx) => String(part).padStart(idx === 0 ? 4 : 2, '0')).join('-')
      : undefined

  return stripEmptyFields({
    title: plain(work.title?.[0] ?? ''),
    authors,
    year: parts[0] ? parseYear(parts[0]) : undefined,
    date: dateStr,
    venue: plain(work['container-title']?.[0] ?? '') || undefined,
    abstract: plain(work.abstract ?? '') || undefined,
    type: work.type,
    doi,
    url: doi ? `https://doi.org/${doi}` : work.URL,
    citations: work['is-referenced-by-count'],
    retracted: isRetracted ? true : undefined,
    sources: [SCHOLARLY_SOURCE_NAMES.crossref],
  })
}

function crossrefHeaders(keys?: ScholarlyKeys): Record<string, string> {
  return keys?.email ? { 'user-agent': `dsh-zotero/scholarly (mailto:${keys.email})` } : {}
}

export async function searchCrossref(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const filters: string[] = []
  if (query.yearFrom !== undefined) filters.push(`from-pub-date:${query.yearFrom}`)
  if (query.yearTo !== undefined) filters.push(`until-pub-date:${query.yearTo}`)

  const params: Record<string, string | number | undefined> = {
    'query.bibliographic': query.query,
    rows: query.limit,
    filter: filters.length > 0 ? filters.join(',') : undefined,
    select:
      'DOI,title,author,issued,container-title,abstract,type,is-referenced-by-count,update-to',
    mailto: keys?.email,
  }

  if (query.sort === 'date') params.sort = 'published'
  else if (query.sort === 'citations') params.sort = 'is-referenced-by-count'

  const url = `https://api.crossref.org/works?${encodeQueryParams(params)}`
  const body = await http.json<{ message?: { items?: CrossrefWork[] } }>(url, {
    signal,
    headers: crossrefHeaders(keys),
    timeoutMs: 30_000,
  })

  return (body.message?.items ?? []).map(paperFromCrossref).filter((p) => (p.title ?? '') !== '')
}

export async function lookupCrossref(
  doi: string,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper | undefined> {
  const clean = cleanDoi(doi) ?? doi.trim()
  const url = `https://api.crossref.org/works/${encodeURIComponent(clean)}${
    keys?.email ? `?mailto=${encodeURIComponent(keys.email)}` : ''
  }`

  try {
    const body = await http.json<{ message?: CrossrefWork }>(url, {
      signal,
      headers: crossrefHeaders(keys),
      timeoutMs: 25_000,
    })
    return body.message ? paperFromCrossref(body.message) : undefined
  } catch (error) {
    if (httpStatusOf(error) === 404) return undefined
    throw error
  }
}

export async function crossrefMatchReference(
  referenceText: string,
  rows: number,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<CrossrefWork[]> {
  const url = `https://api.crossref.org/works?${encodeQueryParams({
    'query.bibliographic': referenceText.slice(0, 600),
    rows,
    select: 'DOI,title,author,issued,container-title,type,update-to',
    mailto: keys?.email,
  })}`

  const body = await http.json<{ message?: { items?: CrossrefWork[] } }>(url, {
    signal,
    headers: crossrefHeaders(keys),
    timeoutMs: 30_000,
  })

  return body.message?.items ?? []
}
