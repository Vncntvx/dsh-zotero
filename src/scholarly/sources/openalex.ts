/**
 * OpenAlex adapter querying api.openalex.org for global scholarly graph metadata.
 * @module dsh-zotero/scholarly/sources/openalex
 */

import type { ScholarlyHttp } from '../transport/http.js'
import {
  SCHOLARLY_SOURCE_NAMES,
  type ScholarlyKeys,
  type ScholarlyPaper,
  type ScholarlyQuery,
} from '../types.js'
import { extractArxivId } from './arxiv.js'
import { cleanDoi, encodeQueryParams, ignoreNotFound, plain, stripEmptyFields } from './helpers.js'

interface OpenAlexWork {
  id?: string
  doi?: string | null
  display_name?: string | null
  publication_year?: number
  publication_date?: string
  type?: string
  authorships?: Array<{ author?: { display_name?: string } }>
  primary_location?: {
    source?: { display_name?: string } | null
    landing_page_url?: string | null
  } | null
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null
  open_access?: { is_oa?: boolean; oa_url?: string | null }
  cited_by_count?: number
  is_retracted?: boolean
  abstract_inverted_index?: Record<string, number[]> | null
  ids?: { pmid?: string; pmcid?: string }
}

const SELECT_FIELDS =
  'id,doi,display_name,publication_year,publication_date,type,authorships,primary_location,best_oa_location,open_access,cited_by_count,is_retracted,abstract_inverted_index,ids'

export function reconstructInvertedAbstract(
  index: Record<string, number[]> | null | undefined,
): string | undefined {
  if (!index) return undefined
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) {
      words[pos] = word
    }
  }
  const text = words
    .filter((w) => w !== undefined)
    .join(' ')
    .trim()
  return text === '' ? undefined : text
}

export function paperFromOpenAlex(work: OpenAlexWork): ScholarlyPaper {
  const doi = cleanDoi(work.doi)
  const arxiv = doi ? undefined : extractArxivId(work.primary_location?.landing_page_url ?? '')

  return stripEmptyFields({
    title: plain(work.display_name),
    authors: (work.authorships ?? [])
      .map((entry) => plain(entry.author?.display_name))
      .filter(Boolean),
    year: work.publication_year,
    date: work.publication_date,
    venue: work.primary_location?.source?.display_name ?? undefined,
    type: work.type,
    abstract: reconstructInvertedAbstract(work.abstract_inverted_index),
    doi,
    arxiv,
    pmid: work.ids?.pmid?.replace(/^.*\//, ''),
    pmcid: work.ids?.pmcid?.replace(/^.*\//, ''),
    openalex: work.id?.replace(/^.*\//, ''),
    url: doi ? `https://doi.org/${doi}` : (work.primary_location?.landing_page_url ?? undefined),
    pdfUrl: work.best_oa_location?.pdf_url ?? undefined,
    openAccess: work.open_access?.is_oa,
    citations: work.cited_by_count,
    retracted: work.is_retracted === true ? true : undefined,
    sources: [SCHOLARLY_SOURCE_NAMES.openalex],
  })
}

function buildOpenAlexUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  keys?: ScholarlyKeys,
): string {
  const query = encodeQueryParams({
    ...params,
    select: SELECT_FIELDS,
    mailto: keys?.email,
  })
  return `https://api.openalex.org/${path}?${query}`
}

/**
 * OpenAlex accepts its key as a bearer credential, so the key never enters a
 * URL. That matters because URLs reach error objects and logged messages,
 * while a `role('secret')` config field must not.
 * @param keys - the resolved scholarly keys.
 * @returns the request headers this call needs.
 */
function openAlexHeaders(keys?: ScholarlyKeys): Record<string, string> {
  return keys?.openalexKey === undefined ? {} : { authorization: `Bearer ${keys.openalexKey}` }
}

export async function searchOpenAlex(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const filters: string[] = []
  if (query.yearFrom !== undefined || query.yearTo !== undefined) {
    const from = query.yearFrom ?? ''
    const to = query.yearTo ?? ''
    filters.push(`publication_year:${from}-${to}`)
  }
  if (query.openAccess) {
    filters.push('open_access.is_oa:true')
  }

  const sortParam =
    query.sort === 'date'
      ? 'publication_date:desc'
      : query.sort === 'citations'
        ? 'cited_by_count:desc'
        : undefined

  const url = buildOpenAlexUrl(
    'works',
    {
      search: query.query,
      filter: filters.length > 0 ? filters.join(',') : undefined,
      'per-page': query.limit,
      sort: sortParam,
    },
    keys,
  )

  const body = await http.json<{ results?: OpenAlexWork[] }>(url, {
    signal,
    timeoutMs: 30_000,
    headers: openAlexHeaders(keys),
  })
  return (body.results ?? []).map(paperFromOpenAlex).filter((p) => (p.title ?? '') !== '')
}

export async function lookupOpenAlex(
  id: string,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper | undefined> {
  const url = buildOpenAlexUrl(`works/${encodeURIComponent(id)}`, {}, keys)
  const work = await ignoreNotFound(
    http.json<OpenAlexWork>(url, {
      signal,
      timeoutMs: 25_000,
      headers: openAlexHeaders(keys),
    }),
  )
  return work ? paperFromOpenAlex(work) : undefined
}

export async function openalexLinkedWorks(
  openalexId: string,
  relation: 'cites' | 'cited_by' | 'related_to',
  limit: number,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<{ papers: ScholarlyPaper[]; total?: number }> {
  const url = buildOpenAlexUrl(
    'works',
    {
      filter: `${relation}:${openalexId}`,
      'per-page': limit,
      sort: relation === 'related_to' ? undefined : 'cited_by_count:desc',
    },
    keys,
  )

  const body = await http.json<{ results?: OpenAlexWork[]; meta?: { count?: number } }>(url, {
    signal,
    timeoutMs: 30_000,
    headers: openAlexHeaders(keys),
  })

  return {
    papers: (body.results ?? []).map(paperFromOpenAlex).filter((p) => (p.title ?? '') !== ''),
    ...(body.meta?.count !== undefined ? { total: body.meta.count } : {}),
  }
}
