/**
 * DBLP adapter querying dblp.org Computer Science Bibliography API.
 * @module dsh-zotero/scholarly/sources/dblp
 */

import type { ScholarlyHttp } from '../transport/http.js'
import { SCHOLARLY_SOURCE_NAMES, type ScholarlyPaper, type ScholarlyQuery } from '../types.js'
import { extractArxivId } from './arxiv.js'
import { cleanDoi, encodeQueryParams, parseYear, plain, stripEmptyFields } from './helpers.js'

interface DblpHit {
  info?: {
    title?: string
    authors?: {
      author?: Array<{ text?: string }> | { text?: string }
    }
    venue?: string | string[]
    year?: string
    doi?: string
    ee?: string | string[]
    type?: string
    url?: string
  }
}

export function cleanDblpAuthor(name: string): string {
  // DBLP appends 4-digit numbers to disambiguate namesakes, e.g. "Wei Wang 0001"
  return name.replace(/\s+\d{4}$/, '').trim()
}

export function paperFromDblp(hit: DblpHit): ScholarlyPaper {
  const info = hit.info ?? {}
  const rawAuthors = info.authors?.author
  const authorsList = rawAuthors ? (Array.isArray(rawAuthors) ? rawAuthors : [rawAuthors]) : []

  const authors = authorsList.map((a) => cleanDblpAuthor(plain(a.text))).filter(Boolean)

  const eeLink = Array.isArray(info.ee) ? info.ee[0] : info.ee
  const doi = cleanDoi(info.doi)
  const arxiv = !doi && eeLink ? extractArxivId(eeLink) : undefined
  const venue = Array.isArray(info.venue) ? info.venue[0] : info.venue

  return stripEmptyFields({
    title: plain(info.title).replace(/\.$/, ''),
    authors,
    year: parseYear(info.year),
    venue: venue ? plain(venue) : undefined,
    type: info.type,
    doi,
    arxiv,
    url: !doi ? (eeLink ?? info.url) : undefined,
    sources: [SCHOLARLY_SOURCE_NAMES.dblp],
  })
}

export async function searchDblp(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const words = [
    query.query,
    query.yearFrom !== undefined && query.yearFrom === query.yearTo
      ? `year:${query.yearFrom}:`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  const url = `https://dblp.org/search/publ/api?${encodeQueryParams({
    q: words,
    format: 'json',
    h: Math.min(100, query.limit * 2),
  })}`

  const responseText = await http.text(url, { signal, timeoutMs: 25_000 })
  if (responseText.trimStart().startsWith('<')) {
    throw new Error('DBLP returned HTML challenge instead of JSON')
  }

  const body = JSON.parse(responseText) as {
    result?: { hits?: { hit?: DblpHit[] } }
  }

  const hits = body.result?.hits?.hit ?? []
  return hits
    .map(paperFromDblp)
    .filter(
      (p) =>
        p.title !== '' &&
        (query.yearFrom === undefined || (p.year ?? 0) >= query.yearFrom) &&
        (query.yearTo === undefined || (p.year ?? 9999) <= query.yearTo),
    )
    .slice(0, query.limit)
}
