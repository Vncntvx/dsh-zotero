/**
 * Europe PMC adapter querying www.ebi.ac.uk for biomedical literature and PMC JATS XML.
 * @module dsh-zotero/scholarly/sources/pmc
 */

import { httpStatusOf, type ScholarlyHttp } from '../transport/http.js'
import {
  SCHOLARLY_SOURCE_NAMES,
  type ScholarlyKeys,
  type ScholarlyPaper,
  type ScholarlyQuery,
} from '../types.js'
import { cleanDoi, encodeQueryParams, parseYear, plain, stripEmptyFields } from './helpers.js'

export interface EpmcResult {
  id?: string
  source?: string
  pmid?: string
  pmcid?: string
  doi?: string
  title?: string
  authorString?: string
  pubYear?: string
  firstPublicationDate?: string
  abstractText?: string
  citedByCount?: number
  isOpenAccess?: string
  pubType?: string
  journalInfo?: { journal?: { title?: string } }
  bookOrReportDetails?: { publisher?: string }
  fullTextUrlList?: {
    fullTextUrl?: Array<{
      documentStyle?: string
      availabilityCode?: string
      url?: string
    }>
  }
}

export function paperFromEpmc(result: EpmcResult): ScholarlyPaper {
  const pdf = result.fullTextUrlList?.fullTextUrl?.find(
    (entry) =>
      entry.documentStyle === 'pdf' &&
      (entry.availabilityCode === 'OA' || entry.availabilityCode === 'F'),
  )?.url

  const venue =
    result.journalInfo?.journal?.title ??
    (result.source === 'PPR' ? result.bookOrReportDetails?.publisher : undefined)

  return stripEmptyFields({
    title: plain(result.title).replace(/\.$/, ''),
    authors: plain(result.authorString)
      .replace(/\.$/, '')
      .split(', ')
      .map((a) => a.trim())
      .filter(Boolean),
    year: parseYear(result.pubYear),
    date: result.firstPublicationDate,
    venue,
    abstract: plain(result.abstractText) || undefined,
    type: result.source === 'PPR' ? 'preprint' : undefined,
    doi: cleanDoi(result.doi),
    pmid: result.pmid,
    pmcid: result.pmcid,
    pdfUrl: pdf,
    openAccess: result.isOpenAccess === 'Y' ? true : undefined,
    citations: result.citedByCount,
    sources: [SCHOLARLY_SOURCE_NAMES.europepmc],
  })
}

export async function searchEuropePmc(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const clauses = [query.query]

  if (query.yearFrom !== undefined || query.yearTo !== undefined) {
    const from = query.yearFrom ?? 1800
    const to = query.yearTo ?? 2100
    clauses.push(`PUB_YEAR:[${from} TO ${to}]`)
  }

  if (query.openAccess) {
    clauses.push('OPEN_ACCESS:y')
  }

  const expression =
    clauses.length === 1
      ? clauses[0]!
      : clauses.map((c, idx) => (idx === 0 ? `(${c})` : c)).join(' AND ')

  const params: Record<string, string | number | undefined> = {
    query: expression,
    format: 'json',
    resultType: 'core',
    pageSize: query.limit,
    email: keys?.email,
  }

  if (query.sort === 'date') params.sort = 'P_PDATE_D desc'

  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${encodeQueryParams(params)}`
  const body = await http.json<{ resultList?: { result?: EpmcResult[] } }>(url, {
    signal,
    timeoutMs: 30_000,
  })

  return (body.resultList?.result ?? []).map(paperFromEpmc).filter((p) => (p.title ?? '') !== '')
}

export async function lookupEuropePmc(
  id: { doi?: string; pmid?: string; pmcid?: string },
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper | undefined> {
  const expr =
    id.pmcid !== undefined
      ? `PMCID:${id.pmcid}`
      : id.pmid !== undefined
        ? `EXT_ID:${id.pmid} AND SRC:MED`
        : id.doi !== undefined
          ? `DOI:"${id.doi}"`
          : undefined

  if (!expr) return undefined

  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${encodeQueryParams({
    query: expr,
    format: 'json',
    resultType: 'core',
    pageSize: 1,
    email: keys?.email,
  })}`

  const body = await http.json<{ resultList?: { result?: EpmcResult[] } }>(url, {
    signal,
    timeoutMs: 25_000,
  })

  const first = body.resultList?.result?.[0]
  return first ? paperFromEpmc(first) : undefined
}

export async function fetchPmcFullTextXml(
  pmcid: string,
  http: ScholarlyHttp,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const cleanPmcid = pmcid.toUpperCase().startsWith('PMC') ? pmcid : `PMC${pmcid}`
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(
      cleanPmcid,
    )}/fullTextXML`
    return await http.text(url, { signal, timeoutMs: 35_000 })
  } catch (error) {
    if (httpStatusOf(error) === 404) return undefined
    throw error
  }
}
