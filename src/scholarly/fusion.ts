/**
 * Weighted Reciprocal Rank Fusion (RRF) and post-ranking blending for scholarly literature.
 * @module dsh-zotero/scholarly/fusion
 */

import { ZOTERO_RRF_K as RRF_K } from '../constants.js'
import {
  addVersionRecord,
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
  keys: Set<string>
  primaryOrder: number
  order: number
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
function absorbEntry(entry: MergedEntry, incoming: MergedEntry, titleMatch: boolean): void {
  const preferred =
    Number(publishedDoiOf(incoming.paper) !== undefined) -
    Number(publishedDoiOf(entry.paper) !== undefined)
  const promote = preferred > 0 || (preferred === 0 && incoming.primaryOrder < entry.primaryOrder)
  const primary = promote ? incoming.paper : entry.paper
  const other = promote ? entry.paper : incoming.paper
  const relation = titleMatch
    ? 'version'
    : metadataRelationOf(primary, other, identityRelationOf(primary, other).relation)
  mergePaperInto(primary, other, relation)
  for (const version of other.versions ?? []) addVersionRecord(primary, version)
  entry.paper = primary
  entry.primaryOrder = promote ? incoming.primaryOrder : entry.primaryOrder
  entry.order = Math.min(entry.order, incoming.order)
  entry.score += incoming.score
  for (const key of incoming.keys) entry.keys.add(key)
}

/**
 * Merges multiple ranked lists from heterogeneous scholarly indexes into a single deduplicated ranking.
 *
 * Identity decides merges; titles only find candidates. A title candidate must
 * share its token set, first author, and a year within one with the candidate
 * entry, with compatible strong identifiers.
 */
export function fuseRankedLists(lists: readonly RankedSourceList[]): ScholarlyPaper[] {
  const merged = new Set<MergedEntry>()
  const identityIndex = new Map<string, MergedEntry>()
  const titleIndex = new Map<string, Set<MergedEntry>>()
  let order = 0

  const removeTitle = (entry: MergedEntry): void => {
    const signature = titleSignature(entry.paper.title)
    const bucket = signature === undefined ? undefined : titleIndex.get(signature)
    if (bucket === undefined) return
    bucket.delete(entry)
    if (bucket.size === 0) titleIndex.delete(signature!)
  }

  for (const list of lists) {
    const weight = list.weight ?? 1.0
    const sourceName =
      (SCHOLARLY_SOURCE_NAMES as Record<string, string | undefined>)[list.sourceId] ?? list.sourceId

    list.papers.forEach((raw, rank) => {
      const paper = normalizePaper(raw)
      if (sourceName && !paper.sources.includes(sourceName)) {
        paper.sources.push(sourceName)
      }

      const keys = new Set([paper, ...(paper.versions ?? [])].flatMap(identityKeysOf))
      const candidates = new Set<MergedEntry>()
      for (const key of keys) {
        const hit = identityIndex.get(key)
        if (hit !== undefined) candidates.add(hit)
      }
      let titleMatch = false

      // A title signature proposes candidates; the gate checks the title token
      // set, first author, year window, and strong-identifier compatibility.
      if (candidates.size === 0) {
        const signature = titleSignature(paper.title)
        for (const candidate of signature ? (titleIndex.get(signature) ?? []) : []) {
          const verdict = identityRelationOf(candidate.paper, paper)
          if (verdict.relation !== 'distinct' || verdict.conflicting) continue
          if (!titleVersionMatch(candidate.paper, paper)) continue
          candidates.add(candidate)
          titleMatch = true
          break
        }
      }

      const [first, ...rest] = [...candidates].sort((left, right) => left.order - right.order)
      const incoming = { paper, score: weight / (RRF_K + rank), keys, order, primaryOrder: order }
      order += 1
      const entry = first ?? incoming
      if (first !== undefined) {
        removeTitle(first)
        for (const absorbed of rest) {
          removeTitle(absorbed)
          absorbEntry(entry, absorbed, false)
          merged.delete(absorbed)
        }
        absorbEntry(entry, incoming, titleMatch)
      }
      merged.add(entry)
      for (const key of entry.keys) identityIndex.set(key, entry)
      const signature = titleSignature(entry.paper.title)
      if (signature !== undefined) {
        const bucket = titleIndex.get(signature) ?? new Set<MergedEntry>()
        bucket.add(entry)
        titleIndex.set(signature, bucket)
      }
    })
  }

  return [...merged]
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.paper)
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
  const published = publishedDoiOf(paper)
  if (published !== undefined) return published
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
