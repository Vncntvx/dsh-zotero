/**
 * Semantic Scholar adapter querying api.semanticscholar.org Graph API.
 * Provides TLDRs, citation counts, and open-access PDF links.
 * @module dsh-zotero/scholarly/sources/semanticscholar
 */

import type { ScholarlyHttp } from '../transport/http.js'
import type { ScholarlyKeys, ScholarlyPaper, ScholarlyQuery } from '../types.js'
import { cleanDoi, encodeQueryParams, parseYear, plain, stripEmptyFields } from './helpers.js'

interface S2Paper {
  paperId?: string
  title?: string
  year?: number
  venue?: string
  abstract?: string | null
  publicationDate?: string | null
  authors?: Array<{ name?: string }>
  citationCount?: number
  externalIds?: {
    DOI?: string
    ArXiv?: string
    PubMed?: string
    PubMedCentral?: string
  } | null
  openAccessPdf?: { url?: string } | null
  tldr?: { text?: string } | null
}

const S2_FIELDS =
  'title,year,venue,abstract,publicationDate,authors,citationCount,externalIds,openAccessPdf,tldr'

export function paperFromS2(paper: S2Paper): ScholarlyPaper {
  const doi = cleanDoi(paper.externalIds?.DOI)
  const arxiv = paper.externalIds?.ArXiv
  const pmid = paper.externalIds?.PubMed
  const pmcid = paper.externalIds?.PubMedCentral
    ? `PMC${paper.externalIds.PubMedCentral}`
    : undefined

  return stripEmptyFields({
    title: plain(paper.title),
    authors: (paper.authors ?? []).map((a) => plain(a.name)).filter(Boolean),
    year: paper.year ? parseYear(paper.year) : undefined,
    date: paper.publicationDate ?? undefined,
    venue: paper.venue || undefined,
    abstract: paper.abstract ?? undefined,
    tldr: paper.tldr?.text ?? undefined,
    doi,
    arxiv,
    pmid,
    pmcid,
    s2: paper.paperId,
    url: doi
      ? `https://doi.org/${doi}`
      : arxiv
        ? `https://arxiv.org/abs/${arxiv}`
        : paper.paperId
          ? `https://www.semanticscholar.org/paper/${paper.paperId}`
          : undefined,
    pdfUrl: paper.openAccessPdf?.url || undefined,
    citations: paper.citationCount,
    sources: ['Semantic Scholar'],
  })
}

function s2Headers(keys?: ScholarlyKeys): Record<string, string> {
  return keys?.s2Key ? { 'x-api-key': keys.s2Key } : {}
}

export async function searchSemanticScholar(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const yearParam =
    query.yearFrom !== undefined || query.yearTo !== undefined
      ? `${query.yearFrom ?? ''}-${query.yearTo ?? ''}`
      : undefined

  const params: Record<string, string | number | boolean | undefined> = {
    query: query.query,
    limit: query.limit,
    fields: S2_FIELDS,
    year: yearParam,
  }

  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${encodeQueryParams(params)}${
    query.openAccess ? '&openAccessPdf' : ''
  }`

  try {
    const body = await http.json<{ data?: S2Paper[] }>(url, {
      signal,
      headers: s2Headers(keys),
      timeoutMs: 25_000,
      retries: keys?.s2Key ? 2 : 0,
    })
    return (body.data ?? []).map(paperFromS2).filter((p) => (p.title ?? '') !== '')
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 429 || status === 404 || status === 400) return []
    throw error
  }
}

export async function lookupSemanticScholar(
  id: string,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper | undefined> {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(
      id,
    )}?fields=${S2_FIELDS}`
    const body = await http.json<S2Paper>(url, {
      signal,
      headers: s2Headers(keys),
      timeoutMs: 25_000,
      retries: keys?.s2Key ? 2 : 0,
    })
    return paperFromS2(body)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404 || status === 429 || status === 400) return undefined
    throw error
  }
}
