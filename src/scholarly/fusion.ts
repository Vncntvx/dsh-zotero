/**
 * Weighted Reciprocal Rank Fusion (RRF) and post-ranking blending for scholarly literature.
 * @module dsh-zotero/scholarly/fusion
 */

import {
  canonicalKeysOf,
  isFuzzyTitleMatch,
  mergePaperInto,
  normalizePaper,
  titleKey,
} from './normalize.js'
import {
  SCHOLARLY_SOURCE_NAMES,
  type ScholarlyPaper,
  type ScholarlyQuery,
  type ScholarlySourceId,
} from './types.js'

export interface RankedSourceList {
  sourceId: string
  weight?: number
  papers: readonly ScholarlyPaper[]
}

interface MergedEntry {
  paper: ScholarlyPaper
  score: number
}

const RRF_K = 60

/**
 * Merges multiple ranked lists from heterogeneous scholarly indexes into a single deduplicated ranking.
 */
export function fuseRankedLists(
  lists: readonly RankedSourceList[],
  customK = RRF_K,
): ScholarlyPaper[] {
  const merged: MergedEntry[] = []
  const keyIndex = new Map<string, MergedEntry>()

  for (const list of lists) {
    const weight = list.weight ?? 1.0
    const sourceName = SCHOLARLY_SOURCE_NAMES[list.sourceId as ScholarlySourceId] ?? list.sourceId

    list.papers.forEach((raw, rank) => {
      const paper = normalizePaper(raw)
      if (sourceName && !paper.sources.includes(sourceName)) {
        paper.sources.push(sourceName)
      }
      const keys = canonicalKeysOf(paper)

      // L1: Check exact canonical keys
      let entry: MergedEntry | undefined
      for (const k of keys) {
        entry = keyIndex.get(k)
        if (entry) break
      }

      // L2: Check fuzzy title match across existing entries
      if (!entry) {
        for (const existing of merged) {
          if (isFuzzyTitleMatch(existing.paper, paper)) {
            entry = existing
            break
          }
        }
      }

      if (!entry) {
        entry = {
          paper: { ...paper, sources: [...paper.sources] },
          score: 0,
        }
        merged.push(entry)
      } else {
        mergePaperInto(entry.paper, paper)
      }

      // Reciprocal Rank Fusion contribution
      entry.score += weight / (customK + rank)

      // Register all canonical keys
      for (const k of [...keys, ...canonicalKeysOf(entry.paper)]) {
        if (!keyIndex.has(k)) keyIndex.set(k, entry)
      }
    })
  }

  return merged.sort((a, b) => b.score - a.score).map((e) => e.paper)
}

/**
 * Post-processes fused papers: title exact-match pinning, future-year sanitizing, date/citation sorting.
 */
export function postProcessRanked(
  papers: ScholarlyPaper[],
  query: ScholarlyQuery,
  currentYear = new Date().getFullYear(),
): ScholarlyPaper[] {
  let result = [...papers]
  const isSaneYear = (p: ScholarlyPaper): boolean =>
    p.year === undefined || p.year <= currentYear + 1

  // Future-dated placeholder entries are stripped or sanitized
  if (query.sort === 'date') {
    result = result.filter(isSaneYear)
  } else {
    result = result.map((p) => {
      if (isSaneYear(p)) return p
      const { year: _y, date: _d, ...rest } = p
      return rest
    })
  }

  // Exact query-title match boost: if user query directly matches paper title, pin to top
  const wanted = titleKey(query.query)
  if (query.sort === 'relevance' && wanted.length >= 10) {
    const exact = result.filter((p) => titleKey(p.title) === wanted)
    const rest = result.filter((p) => titleKey(p.title) !== wanted)
    result = [...exact, ...rest]
  }

  // Date sorting: order by real ISO date string descending
  if (query.sort === 'date') {
    const today = new Date().toISOString().slice(0, 10)
    const dateVal = (p: ScholarlyPaper): string => {
      const d = String(p.date ?? p.year ?? '')
      // Future dates in this year or early next year mapped to today's month
      return d.slice(0, 10) > today ? today : d
    }
    result.sort((a, b) => dateVal(b).localeCompare(dateVal(a)))
  }

  // Citation count sorting
  if (query.sort === 'citations') {
    result.sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1))
  }

  // Open-access filter
  if (query.openAccess) {
    result = result.filter((p) => p.pdfUrl !== undefined || p.openAccess === true)
  }

  return result.slice(0, query.limit)
}

export function bestIdentifierOf(paper: ScholarlyPaper): string {
  if (paper.arxiv) return `arXiv:${paper.arxiv}`
  if (paper.doi) return paper.doi
  if (paper.pmid) return `PMID:${paper.pmid}`
  if (paper.pmcid) return paper.pmcid
  return paper.openalex ?? paper.s2 ?? paper.url ?? paper.title
}

export function formatAuthorSummary(authors: readonly string[], max = 4): string {
  if (authors.length === 0) return ''
  if (authors.length <= max) return authors.join(', ')
  return `${authors.slice(0, max - 1).join(', ')}, … ${authors.at(-1)!} (${authors.length} authors)`
}

export function formatPaperItem(paper: ScholarlyPaper, index: number, abstractChars = 300): string {
  const facts = [
    formatAuthorSummary(paper.authors),
    paper.year ? String(paper.year) : '',
    paper.venue || '',
  ]
    .filter(Boolean)
    .join(' · ')

  const id = bestIdentifierOf(paper)
  const marks = [
    id !== paper.url ? `id: ${id}` : '',
    paper.citations !== undefined ? `cited ${paper.citations}` : '',
    paper.pdfUrl || paper.openAccess ? 'open access' : '',
    paper.retracted ? 'RETRACTED' : '',
    paper.inLibrary ? `[In Zotero: ${paper.inLibrary.collections.join('/') || 'Root'}]` : '',
    `via ${paper.sources.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const abstract =
    paper.tldr && abstractChars > 0 && abstractChars < 400 ? paper.tldr : (paper.abstract ?? '')

  return [
    `[${index}] ${paper.title}`,
    facts ? `    ${facts}` : '',
    marks ? `    ${marks}` : '',
    paper.url ? `    ${paper.url}` : '',
    abstractChars > 0 && abstract
      ? `    ${abstract.length > abstractChars ? `${abstract.slice(0, abstractChars).trimEnd()}…` : abstract}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatPaperDetail(paper: ScholarlyPaper): string {
  return [
    paper.title,
    paper.retracted ? 'RETRACTED: this paper has been retracted.' : '',
    paper.authors.length > 0 ? `authors: ${paper.authors.join(', ')}` : '',
    (paper.date ?? paper.year) ? `date: ${paper.date ?? String(paper.year)}` : '',
    paper.venue ? `venue: ${paper.venue}` : '',
    paper.type ? `type: ${paper.type}` : '',
    paper.doi ? `DOI: ${paper.doi}` : '',
    paper.arxiv ? `arXiv: ${paper.arxiv}` : '',
    paper.pmid ? `PMID: ${paper.pmid}` : '',
    paper.pmcid ? `PMCID: ${paper.pmcid}` : '',
    paper.citations !== undefined ? `cited by: ${paper.citations}` : '',
    paper.inLibrary
      ? `in Zotero: yes (itemKey: ${paper.inLibrary.itemKey}, collections: ${paper.inLibrary.collections.join(', ') || 'root'})`
      : 'in Zotero: no',
    paper.url ? `url: ${paper.url}` : '',
    paper.pdfUrl ? `open-access PDF: ${paper.pdfUrl}` : paper.openAccess ? 'open access: yes' : '',
    `sources: ${paper.sources.join(', ')}`,
    paper.tldr ? `\nsummary (Semantic Scholar): ${paper.tldr}` : '',
    paper.abstract ? `\nabstract:\n${paper.abstract}` : '\n(no abstract in the queried indexes)',
  ]
    .filter(Boolean)
    .join('\n')
}
