/**
 * PubMed adapter querying NCBI E-Utilities (esearch.fcgi and efetch.fcgi).
 * @module dsh-zotero/scholarly/sources/pubmed
 */

import { XMLParser } from 'fast-xml-parser'
import type { ScholarlyHttp } from '../transport/http.js'
import type { ScholarlyKeys, ScholarlyPaper, ScholarlyQuery } from '../types.js'
import { cleanDoi, encodeQueryParams, parseYear, plain, stripEmptyFields } from './helpers.js'

const pubmedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  stopNodes: ['*.ArticleTitle', '*.AbstractText'],
  isArray: (name) => ['PubmedArticle', 'Author', 'AbstractText', 'ArticleId'].includes(name),
})

const textVal = (value: unknown): string => {
  if (typeof value === 'object' && value !== null) {
    return plain(String((value as { '#text'?: unknown })['#text'] ?? ''))
  }
  return plain(String(value ?? ''))
}

export function parsePubmedXml(xml: string): ScholarlyPaper[] {
  const parsed = pubmedParser.parse(xml) as {
    PubmedArticleSet?: { PubmedArticle?: Array<Record<string, any>> }
  }
  const articles = parsed.PubmedArticleSet?.PubmedArticle ?? []

  return articles
    .map((entry) => {
      const citation = entry.MedlineCitation ?? {}
      const article = citation.Article ?? {}
      const idList = (entry.PubmedData?.ArticleIdList?.ArticleId ?? []) as Array<{
        '@IdType'?: string
        '#text'?: unknown
      }>

      const getId = (type: string): string | undefined => {
        const found = idList.find((id) => id['@IdType'] === type)?.['#text']
        return found !== undefined ? String(found) : undefined
      }

      const abstractParts = ((article.Abstract?.AbstractText ?? []) as unknown[]).map((part) => {
        const label =
          typeof part === 'object' && part !== null
            ? (part as { '@Label'?: string })['@Label']
            : undefined
        return `${label ? `${label}: ` : ''}${textVal(part)}`
      })
      const abstract = abstractParts.filter(Boolean).join(' ')

      const pubDate = article.Journal?.JournalIssue?.PubDate ?? {}
      const rawYear = pubDate.Year ?? pubDate.MedlineDate

      const authors = (
        (article.AuthorList?.Author ?? []) as Array<{
          LastName?: string
          ForeName?: string
          CollectiveName?: string
        }>
      )
        .map((a) =>
          a.CollectiveName ? a.CollectiveName : [a.ForeName, a.LastName].filter(Boolean).join(' '),
        )
        .filter(Boolean)

      return stripEmptyFields({
        title: textVal(article.ArticleTitle).replace(/\.$/, ''),
        authors,
        year: parseYear(rawYear),
        venue: typeof article.Journal?.Title === 'string' ? article.Journal.Title : undefined,
        abstract: abstract || undefined,
        doi: cleanDoi(getId('doi')),
        pmid: textVal(citation.PMID) || getId('pubmed'),
        pmcid: getId('pmc'),
        sources: ['PubMed'],
      })
    })
    .filter((p) => (p.title ?? '') !== '')
}

export async function searchPubMed(
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
): Promise<ScholarlyPaper[]> {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
  const common = {
    tool: 'dsh-zotero-scholarly',
    email: keys?.email,
    api_key: keys?.ncbiKey,
  }

  const clauses = [query.query]
  if (query.yearFrom !== undefined || query.yearTo !== undefined) {
    const from = query.yearFrom ?? 1800
    const to = query.yearTo ?? 3000
    clauses.push(`${from}:${to}[dp]`)
  }
  if (query.openAccess) {
    clauses.push('free full text[sb]')
  }

  const term = clauses
    .map((c, idx, arr) => (arr.length > 1 && idx === 0 ? `(${c})` : c))
    .join(' AND ')

  const searchUrl = `${base}/esearch.fcgi?${encodeQueryParams({
    db: 'pubmed',
    term,
    retmax: query.limit,
    retmode: 'json',
    sort: query.sort === 'date' ? 'pub_date' : 'relevance',
    ...common,
  })}`

  const found = await http.json<{ esearchresult?: { idlist?: string[] } }>(searchUrl, {
    signal,
    timeoutMs: 25_000,
  })
  const ids = found.esearchresult?.idlist ?? []
  if (ids.length === 0) return []

  const fetchUrl = `${base}/efetch.fcgi?${encodeQueryParams({
    db: 'pubmed',
    id: ids.join(','),
    retmode: 'xml',
    ...common,
  })}`

  const xml = await http.text(fetchUrl, { signal, timeoutMs: 30_000 })
  const papers = parsePubmedXml(xml)

  // Reorder according to the esearch ranking order
  return ids
    .map((id) => papers.find((p) => p.pmid === id))
    .filter((p): p is ScholarlyPaper => p !== undefined)
}
