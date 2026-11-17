/**
 * Weighted Reciprocal Rank Fusion (RRF) and post-ranking blending for scholarly literature.
 * @module dsh-zotero/scholarly/fusion
 */

import { ZOTERO_RRF_K as RRF_K } from '../constants.js'
import {
  identityKeysOf,
  identityRelationOf,
  mergePaperInto,
  normalizePaper,
  publishedDoiOf,
  titleKey,
  titleSignature,
  titleVersionMatch,
  type IdentityRelation,
  type MergeRelation,
} from './normalize.js'
import {
  SCHOLARLY_SOURCE_NAMES,
  type PaperVersion,
  type ScholarlyPaper,
  type ScholarlyQuery,
  type ScholarlySourceId,
} from './types.js'

export interface RankedSourceList {
  sourceId: ScholarlySourceId | string
  weight?: number
  papers: readonly ScholarlyPaper[]
}

interface MergedEntry {
  paper: ScholarlyPaper
  score: number
}

/**
 * How metadata from two records is merged, given their identity verdict.
 *
 * A shared published DOI identifies one record seen twice. A preprint and its
 * published version merge as versions, while records sharing a preprint
 * identity without a published DOI remain one record.
 */
function metadataRelationOf(
  existing: ScholarlyPaper,
  incoming: ScholarlyPaper,
  verdict: IdentityRelation,
): MergeRelation {
  if (verdict === 'version') return 'version'
  const left = publishedDoiOf(existing)
  const right = publishedDoiOf(incoming)
  if (left !== undefined && right !== undefined) {
    return left.toLowerCase() === right.toLowerCase() ? 'same' : 'version'
  }
  if ((left === undefined) !== (right === undefined)) return 'version'
  return verdict === 'same' ? 'same' : 'version'
}

/**
 * A published version carries the better title, venue, and DOI. When the
 * existing entry is a preprint-only record and the incoming record is
 * published, the incoming record becomes the primary and the old primary is
 * retained as a version.
 */
function absorbEntry(entry: MergedEntry, paper: ScholarlyPaper, relation: MergeRelation): void {
  if (publishedDoiOf(paper) !== undefined && publishedDoiOf(entry.paper) === undefined) {
    const previous = entry.paper
    const promoted: ScholarlyPaper = {
      ...paper,
      sources: [...paper.sources],
      versions: [...(paper.versions ?? [])],
    }
    entry.paper = promoted
    mergePaperInto(promoted, previous, 'version')
    return
  }
  mergePaperInto(entry.paper, paper, relation)
}

function indexEntry(
  entry: MergedEntry,
  identityIndex: Map<string, MergedEntry>,
  titleIndex: Map<string, MergedEntry[]>,
): void {
  for (const key of identityKeysOf(entry.paper)) identityIndex.set(key, entry)
  for (const version of entry.paper.versions ?? []) {
    for (const key of identityKeysOf(version)) identityIndex.set(key, entry)
  }
  // Only the primary title is a candidate signature: the merge gate compares
  // the incoming record against the primary's own authors and year.
  const signature = titleSignature(entry.paper.title)
  if (signature === undefined) return
  const bucket = titleIndex.get(signature)
  if (!bucket) {
    titleIndex.set(signature, [entry])
  } else if (!bucket.includes(entry)) {
    bucket.push(entry)
  }
}

/**
 * Merges multiple ranked lists from heterogeneous scholarly indexes into a single deduplicated ranking.
 *
 * Identity decides merges; titles only find candidates. A title candidate must
 * share its token set, first author, and a year within one with the candidate
 * entry, with compatible strong identifiers.
 */
export function fuseRankedLists(lists: readonly RankedSourceList[]): ScholarlyPaper[] {
  const merged: MergedEntry[] = []
  const identityIndex = new Map<string, MergedEntry>()
  const titleIndex = new Map<string, MergedEntry[]>()

  for (const list of lists) {
    const weight = list.weight ?? 1.0
    const sourceName =
      (SCHOLARLY_SOURCE_NAMES as Record<string, string | undefined>)[list.sourceId] ?? list.sourceId

    list.papers.forEach((raw, rank) => {
      const paper = normalizePaper(raw)
      if (sourceName && !paper.sources.includes(sourceName)) {
        paper.sources.push(sourceName)
      }

      let entry: MergedEntry | undefined
      let relation: MergeRelation = 'same'

      // Identity keys name records. A match here is a shared identity, and the
      // verdict distinguishes one record from a verified version relationship.
      for (const key of identityKeysOf(paper)) {
        const candidate = identityIndex.get(key)
        if (!candidate) continue
        const verdict = identityRelationOf(candidate.paper, paper)
        entry = candidate
        relation = metadataRelationOf(candidate.paper, paper, verdict.relation)
        break
      }

      // A title signature proposes candidates; the gate checks the title token
      // set, first author, year window, and strong-identifier compatibility.
      if (!entry) {
        const signature = titleSignature(paper.title)
        for (const candidate of signature ? (titleIndex.get(signature) ?? []) : []) {
          const verdict = identityRelationOf(candidate.paper, paper)
          if (verdict.relation !== 'distinct' || verdict.conflicting) continue
          if (!titleVersionMatch(candidate.paper, paper)) continue
          entry = candidate
          relation = 'version'
          break
        }
      }

      if (!entry) {
        entry = {
          paper: { ...paper, sources: [...paper.sources] },
          score: 0,
        }
        merged.push(entry)
      } else {
        absorbEntry(entry, paper, relation)
      }

      // Reciprocal Rank Fusion contribution
      entry.score += weight / (RRF_K + rank)

      // Register every identity this entry now answers to, including the
      // versions it absorbed.
      indexEntry(entry, identityIndex, titleIndex)
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
    const exact: ScholarlyPaper[] = []
    const rest: ScholarlyPaper[] = []
    for (const p of result) {
      if (titleKey(p.title) === wanted) exact.push(p)
      else rest.push(p)
    }
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

interface IdentifierFields {
  arxiv?: string
  doi?: string
  pmid?: string
  pmcid?: string
  openalex?: string
  s2?: string
  url?: string
  title: string
}

export function bestIdentifierOf(paper: IdentifierFields): string {
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

function formatVersionLine(version: PaperVersion): string {
  const facts = [
    version.kind,
    version.year !== undefined ? String(version.year) : '',
    version.venue ?? '',
    version.doi ? `DOI: ${version.doi}` : version.arxiv ? `arXiv: ${version.arxiv}` : '',
    version.retracted ? 'RETRACTED' : '',
    `via ${version.sources.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return `  - ${version.title}\n    ${facts}`
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
  const versions = paper.versions ?? []
  const retractedVersion =
    paper.retracted === true ? undefined : versions.find((version) => version.retracted === true)
  const marks = [
    id !== paper.url ? `id: ${id}` : '',
    paper.citations !== undefined ? `cited ${paper.citations}` : '',
    paper.pdfUrl || paper.openAccess ? 'open access' : '',
    paper.retracted ? 'RETRACTED' : '',
    retractedVersion ? `retracted version: ${bestIdentifierOf(retractedVersion)}` : '',
    versions.length > 0
      ? `also: ${versions
          .slice(0, 2)
          .map((version) => `${version.kind} ${bestIdentifierOf(version)}`)
          .join('; ')}`
      : '',
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
    paper.versions && paper.versions.length > 0
      ? `versions:\n${paper.versions.map(formatVersionLine).join('\n')}`
      : '',
    `sources: ${paper.sources.join(', ')}`,
    paper.tldr ? `\nsummary (Semantic Scholar): ${paper.tldr}` : '',
    paper.abstract ? `\nabstract:\n${paper.abstract}` : '\n(no abstract in the queried indexes)',
  ]
    .filter(Boolean)
    .join('\n')
}
