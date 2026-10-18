/**
 * arXiv adapter querying the Atom API at export.arxiv.org/api/query.
 * @module dsh-zotero/scholarly/sources/arxiv
 */

import { XMLParser } from 'fast-xml-parser'
import type { ScholarlyHttp } from '../transport/http.js'
import type { ScholarlyPaper, ScholarlyQuery } from '../types.js'
import { cleanDoi, encodeQueryParams, parseYear, plain, stripEmptyFields } from './helpers.js'
import { SCHOLARLY_STOPWORDS } from '../normalize.js'

const NEW_ARXIV_ID = /(\d{4}\.\d{4,5})(v\d+)?/
const OLD_ARXIV_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/

export function extractArxivId(input: string): string | undefined {
  const text = input.trim()
  const scoped =
    /arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+)/i.exec(text)?.[1] ??
    /^(?:arxiv:|10\.48550\/arxiv\.)(.+)$/i.exec(text)?.[1] ??
    text
  const match =
    new RegExp(`^${NEW_ARXIV_ID.source}(?:\\.pdf)?$`).exec(scoped) ??
    new RegExp(`^${OLD_ARXIV_ID.source}(?:\\.pdf)?$`).exec(scoped)
  return match?.[1]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  isArray: (name) =>
    name === 'entry' || name === 'author' || name === 'category' || name === 'link',
})

const textVal = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null) {
    return String((value as { '#text'?: unknown })['#text'] ?? '')
  }
  return ''
}

export interface ArxivAtomEntry {
  id: string
  title: string
  authors: string[]
  abstract: string
  published: string
  doi?: string
  journalRef?: string
  categories: string[]
}

export function parseArxivAtom(xml: string): ArxivAtomEntry[] {
  const feed = (parser.parse(xml) as { feed?: { entry?: Array<Record<string, unknown>> } }).feed
  const entries: ArxivAtomEntry[] = []

  for (const entry of feed?.entry ?? []) {
    const rawId = /abs\/(.+)$/.exec(textVal(entry.id))?.[1] ?? ''
    const id = rawId.replace(/v\d+$/, '')
    const title = plain(textVal(entry.title))
    if (!id || !title || title === 'Error') continue

    const doi = cleanDoi(textVal(entry['arxiv:doi']))
    const journalRef = textVal(entry['arxiv:journal_ref'])
    const published = textVal(entry.published)

    entries.push({
      id,
      title,
      authors: ((entry.author as Array<{ name?: unknown }> | undefined) ?? [])
        .map((a) => plain(textVal(a.name)))
        .filter(Boolean),
      abstract: plain(textVal(entry.summary)),
      published,
      ...(doi ? { doi } : {}),
      ...(journalRef ? { journalRef } : {}),
      categories: ((entry.category as Array<{ '@term'?: string }> | undefined) ?? [])
        .map((c) => c['@term'] ?? '')
        .filter(Boolean),
    })
  }
  return entries
}

export function paperFromArxiv(entry: ArxivAtomEntry): ScholarlyPaper {
  return stripEmptyFields({
    title: entry.title,
    authors: entry.authors,
    year: parseYear(entry.published),
    date: entry.published.slice(0, 10),
    venue: entry.journalRef || 'arXiv',
    type: 'preprint',
    abstract: entry.abstract,
    arxiv: entry.id,
    doi: entry.doi ?? `10.48550/arXiv.${entry.id}`,
    url: `https://arxiv.org/abs/${entry.id}`,
    pdfUrl: `https://arxiv.org/pdf/${entry.id}`,
    openAccess: true,
    sources: ['arXiv'],
  })
}

export function buildArxivSearchQuery(query: ScholarlyQuery, anyWord = false): string {
  const text = query.query.trim()
  const isFielded = /\b(ti|au|abs|cat|co|jr|rn|all|id):/.test(text)
  const terms = (text.match(/"[^"]+"|[^\s"]+/g) ?? []).filter(
    (term) => !SCHOLARLY_STOPWORDS.has(term.toLowerCase()),
  )
  const words = (anyWord ? [] : terms).map((term) => `(ti:${term} OR abs:${term})`).join(' AND ')
  const parts = [
    isFielded ? `(${text})` : words !== '' ? `(${words})` : `(ti:(${text}) OR abs:(${text}))`,
  ]

  if (query.categories && query.categories.length > 0) {
    parts.push(`(${query.categories.map((c) => `cat:${c}`).join(' OR ')})`)
  }

  if (query.yearFrom !== undefined || query.yearTo !== undefined) {
    const from = String(query.yearFrom ?? 1991).padStart(4, '0')
    const to = String(query.yearTo ?? 2100).padStart(4, '0')
    parts.push(`submittedDate:[${from}01010000 TO ${to}12312359]`)
  }

  return parts.join(' AND ')
}

export async function searchArxiv(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const execute = async (anyWord: boolean): Promise<ScholarlyPaper[]> => {
    const searchQuery = buildArxivSearchQuery(query, anyWord)
    const url = `https://export.arxiv.org/api/query?${encodeQueryParams({
      search_query: searchQuery,
      start: 0,
      max_results: query.limit,
      sortBy: query.sort === 'date' ? 'submittedDate' : 'relevance',
      sortOrder: 'descending',
    })}`

    const xml = await http.text(url, { signal, timeoutMs: 30_000, retries: 1 })
    return parseArxivAtom(xml).map(paperFromArxiv)
  }

  const strictHits = await execute(false)
  if (strictHits.length > 0 || query.sort === 'date') return strictHits
  return execute(true)
}

export async function lookupArxiv(
  arxivId: string,
  http: ScholarlyHttp,
  signal?: AbortSignal,
): Promise<ScholarlyPaper | undefined> {
  const cleanId = extractArxivId(arxivId) ?? arxivId.trim()
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(cleanId)}&max_results=1`
  const xml = await http.text(url, { signal, timeoutMs: 30_000, retries: 1 })
  const entries = parseArxivAtom(xml)
  return entries[0] ? paperFromArxiv(entries[0]) : undefined
}
