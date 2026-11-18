/**
 * Normalization and identity-based deduplication for scholarly papers.
 *
 * A fused entry absorbs records that describe the same work. Strong
 * identifiers (published DOI, PMID, PMCID, arXiv ID) establish identity;
 * title evidence supplies the candidate gate. Records with distinct metadata,
 * such as a preprint and its published version, retain their record-level
 * metadata in `versions`.
 * @module dsh-zotero/scholarly/normalize
 */

import { extractArxivId } from './sources/arxiv.js'
import { cleanDoi, parseYear } from './sources/helpers.js'
import type { PaperVersion, ScholarlyPaper } from './types.js'

export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export const SCHOLARLY_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'in',
  'on',
  'and',
  'or',
  'to',
  'with',
  'is',
  'are',
  'via',
  'using',
  'by',
  'from',
  'at',
  'as',
])

export function titleTokens(title: string): Set<string> {
  const words = titleKey(title)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SCHOLARLY_STOPWORDS.has(w))
  return new Set(words)
}

/**
 * Order-insensitive title signature: the same token set regardless of word
 * order, punctuation, or stopwords. Titles with fewer than three tokens have
 * no signature.
 */
export function titleSignature(title: string): string | undefined {
  const tokens = titleTokens(title)
  if (tokens.size < 3) return undefined
  return [...tokens].sort().join(' ')
}

/** The fields every strong-identity check reads. */
export type IdentityFields = Pick<ScholarlyPaper, 'doi' | 'arxiv' | 'pmid' | 'pmcid'>

export interface PaperIdentity {
  publishedDois: ReadonlySet<string>
  arxivIds: ReadonlySet<string>
  pmids: ReadonlySet<string>
  pmcids: ReadonlySet<string>
}

/** arXiv's DOI prefix names the preprint, never a published version. */
export function isPreprintDoi(doi: string | undefined): boolean {
  return doi !== undefined && /^10\.48550\//i.test(doi)
}

/** The published DOI of a record, if it has one. */
export function publishedDoiOf(paper: IdentityFields): string | undefined {
  const doi = cleanDoi(paper.doi)
  return doi !== undefined && !isPreprintDoi(doi) ? doi : undefined
}

/**
 * Every strong identifier a record carries. The arXiv DOI is translated into
 * an arXiv ID instead of a published DOI, allowing a preprint and its
 * published version to share the arXiv identity.
 */
export function identityOf(paper: IdentityFields): PaperIdentity {
  const publishedDois = new Set<string>()
  const arxivIds = new Set<string>()
  const pmids = new Set<string>()
  const pmcids = new Set<string>()

  const doi = cleanDoi(paper.doi)
  if (doi !== undefined) {
    if (isPreprintDoi(doi)) {
      const arxiv = extractArxivId(doi)
      if (arxiv) arxivIds.add(arxiv.toLowerCase())
    } else {
      publishedDois.add(doi.toLowerCase())
    }
  }

  const arxiv = paper.arxiv?.trim().toLowerCase()
  if (arxiv) arxivIds.add((extractArxivId(arxiv) ?? arxiv).toLowerCase())

  const pmid = paper.pmid?.trim()
  if (pmid) pmids.add(pmid)

  const pmcid = paper.pmcid?.trim().toLowerCase()
  if (pmcid) pmcids.add(pmcid)

  return { publishedDois, arxivIds, pmids, pmcids }
}

/**
 * Identity keys for the fusion index. Titles provide candidate evidence; the
 * index uses strong identifiers to name records.
 */
export function identityKeysOf(paper: IdentityFields): string[] {
  const identity = identityOf(paper)
  return [
    ...[...identity.publishedDois].map((doi) => `doi:${doi}`),
    ...[...identity.arxivIds].map((id) => `arxiv:${id}`),
    ...[...identity.pmids].map((id) => `pmid:${id}`),
    ...[...identity.pmcids].map((id) => `pmcid:${id}`),
  ]
}

export type IdentityRelation = 'same' | 'version' | 'distinct'

export interface IdentityVerdict {
  relation: IdentityRelation
  /** Some strong identifier kind exists on both sides with different values. */
  conflicting: boolean
}

function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true
  }
  return false
}

function conflicts(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size > 0 && b.size > 0 && !overlaps(a, b)
}

/**
 * Decide what two records are to each other.
 *
 * - `same`: one record seen twice. A shared published DOI decides this on its
 *   own; otherwise every shared strong identifier must agree. A conflicting
 *   secondary identifier next to a shared DOI is a registry data defect, not
 *   evidence of a second work.
 * - `version`: a verifiable version relationship, such as a shared PMID or
 *   arXiv ID with different published DOIs.
 * - `distinct`: no shared identity, with at least one conflicting identifier
 *   kind. These records remain separate.
 */
export function identityRelationOf(a: IdentityFields, b: IdentityFields): IdentityVerdict {
  const left = identityOf(a)
  const right = identityOf(b)

  const sharedPublished = overlaps(left.publishedDois, right.publishedDois)
  const sharedArxiv = overlaps(left.arxivIds, right.arxivIds)
  const sharedPmid = overlaps(left.pmids, right.pmids)
  const sharedPmcid = overlaps(left.pmcids, right.pmcids)

  const conflicting =
    conflicts(left.publishedDois, right.publishedDois) ||
    conflicts(left.arxivIds, right.arxivIds) ||
    conflicts(left.pmids, right.pmids) ||
    conflicts(left.pmcids, right.pmcids)

  if (sharedPublished) return { relation: 'same', conflicting }
  if (!sharedArxiv && !sharedPmid && !sharedPmcid) return { relation: 'distinct', conflicting }
  return { relation: conflicting ? 'version' : 'same', conflicting }
}

/** A name reduced to its comparable letters and digits. */
function normalizedName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

interface ParsedAuthorName {
  surname: string
  /** First given-name token, when the display form carries one. */
  givenFirst?: string
}

function firstTokenOf(value: string | undefined): string | undefined {
  const token = value?.trim().split(/\s+/)[0]
  if (!token) return undefined
  return normalizedName(token) || undefined
}

/**
 * Split a display name into a comparable surname and given-name initial.
 * A comma-delimited entry states the surname first; a CJK name without spaces
 * is its own surname; otherwise the final word is the surname.
 */
function parseFirstAuthor(authors: readonly string[]): ParsedAuthorName | undefined {
  const first = authors[0]?.normalize('NFKC').trim()
  if (!first) return undefined
  const hanOnly = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]+$/u.test(first)
  if (first.includes(',')) {
    const [surnamePart, givenPart] = first.split(',')
    const surname = normalizedName(surnamePart ?? '')
    if (!surname) return undefined
    return { surname, givenFirst: firstTokenOf(givenPart) }
  }
  const words = first.split(/\s+/).filter(Boolean)
  if (hanOnly) {
    return { surname: normalizedName(words[0]!) }
  }
  if (words.length === 1) {
    return { surname: normalizedName(words[0]!) }
  }
  return {
    surname: normalizedName(words.at(-1)!),
    givenFirst: normalizedName(words[0]!),
  }
}

/** A shortened given name ("A." for "Ashish") is compatible; a different one is not. */
function givenCompatible(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return true
  return a[0] === b[0] || a.startsWith(b) || b.startsWith(a)
}

/**
 * Whether two records name the same first author. Surname equality alone would
 * treat "Alice Example" and "Bob Example" as one person; the given-name initial
 * keeps them apart while still accepting "A. Vaswani" for "Ashish Vaswani".
 */
export function firstAuthorCompatible(left: readonly string[], right: readonly string[]): boolean {
  const a = parseFirstAuthor(left)
  const b = parseFirstAuthor(right)
  if (!a || !b) return false
  const surnameMatch =
    a.surname === b.surname ||
    (/^\p{Script=Han}+$/u.test(a.surname) &&
      /^\p{Script=Han}+$/u.test(b.surname) &&
      (a.surname.startsWith(b.surname) || b.surname.startsWith(a.surname)))
  return surnameMatch && givenCompatible(a.givenFirst, b.givenFirst)
}

/**
 * The narrow title-based merge gate. Compatible candidates must share the
 * same title token set (at least three tokens), first author, and publication
 * years within one. These checks distinguish similar titles, authors, and
 * publication years.
 */
export function titleVersionMatch(a: ScholarlyPaper, b: ScholarlyPaper): boolean {
  if (a.year === undefined || b.year === undefined) return false
  if (Math.abs(a.year - b.year) > 1) return false
  const left = titleTokens(a.title)
  const right = titleTokens(b.title)
  if (left.size < 3 || left.size !== right.size) return false
  for (const token of left) {
    if (!right.has(token)) return false
  }
  return firstAuthorCompatible(a.authors, b.authors)
}

/**
 * Fills in default URLs and aligns DOI/arXiv identities.
 */
export function normalizePaper(paper: ScholarlyPaper): ScholarlyPaper {
  const out = {
    ...paper,
    authors: [...(paper.authors ?? [])],
    sources: [...(paper.sources ?? [])],
    ...(paper.versions === undefined
      ? {}
      : {
          versions: paper.versions.map((version) => ({
            ...version,
            authors: [...version.authors],
            sources: [...version.sources],
          })),
        }),
  }

  // Align arXiv DOI and arXiv ID
  if (!out.arxiv && out.doi) {
    const arxiv = extractArxivId(out.doi)
    if (arxiv) {
      out.arxiv = arxiv
    }
  }

  if (!out.doi && out.arxiv) {
    out.doi = `10.48550/arXiv.${out.arxiv}`
  }

  if (!out.pdfUrl && out.arxiv) {
    out.pdfUrl = `https://arxiv.org/pdf/${out.arxiv}`
  }

  if (!out.url) {
    if (out.arxiv && /^10\.48550\//i.test(out.doi ?? '')) {
      out.url = `https://arxiv.org/abs/${out.arxiv}`
    } else if (out.doi) {
      out.url = `https://doi.org/${out.doi}`
    } else if (out.pmid) {
      out.url = `https://pubmed.ncbi.nlm.nih.gov/${out.pmid}/`
    }
  }

  if (out.year === undefined && out.date) {
    out.year = parseYear(out.date)
  }

  return out
}

function versionKindOf(paper: IdentityFields): PaperVersion['kind'] {
  if (publishedDoiOf(paper) !== undefined) return 'published'
  if (paper.arxiv !== undefined || isPreprintDoi(cleanDoi(paper.doi))) return 'preprint'
  return 'other'
}

/** Project one record into its version entry. */
export function versionOf(paper: ScholarlyPaper): PaperVersion {
  return {
    kind: versionKindOf(paper),
    title: paper.title,
    authors: [...paper.authors],
    year: paper.year,
    date: paper.date,
    venue: paper.venue,
    type: paper.type,
    doi: paper.doi,
    arxiv: paper.arxiv,
    pmid: paper.pmid,
    pmcid: paper.pmcid,
    abstract: paper.abstract,
    retracted: paper.retracted,
    url: paper.url,
    pdfUrl: paper.pdfUrl,
    sources: [...paper.sources],
  }
}

function versionIdentityKey(version: PaperVersion): string {
  const keys = identityKeysOf(version)
  if (keys.length > 0) return keys.sort().join('|')
  return `title:${titleKey(version.title)}|${version.year ?? ''}|${version.venue ?? ''}`
}

/**
 * Record a version on a fused paper, merging new sources and missing fields
 * into an existing version with the same identity.
 */
export function addVersionRecord(target: ScholarlyPaper, source: PaperVersion): void {
  const versions = (target.versions ??= [])
  const key = versionIdentityKey(source)
  const existing = versions.find(
    (version) =>
      versionIdentityKey(version) === key ||
      (version.kind === source.kind && identityRelationOf(version, source).relation === 'same'),
  )
  if (!existing) {
    versions.push(source)
    return
  }
  for (const src of source.sources) {
    if (!existing.sources.includes(src)) existing.sources.push(src)
  }
  const fill = <K extends keyof PaperVersion>(field: K): void => {
    if (existing[field] === undefined && source[field] !== undefined) {
      existing[field] = source[field]
    }
  }
  for (const field of [
    'year',
    'date',
    'venue',
    'type',
    'doi',
    'arxiv',
    'pmid',
    'pmcid',
    'abstract',
    'url',
    'pdfUrl',
  ] as const) {
    fill(field)
  }
  if (existing.retracted !== true && source.retracted === true) {
    existing.retracted = true
  }
}

export type MergeRelation = 'same' | 'version'

/**
 * Merge metadata from `source` into `target`.
 *
 * `same` is the one-record-twice case: every field may improve, and a
 * retraction travels with the record. `version` is a preprint/published pair or
 * another verified version relationship: the primary record keeps its own
 * title, abstract, authors, and retraction state, and the incoming record is
 * preserved separately in `versions`.
 */
export function mergePaperInto(
  target: ScholarlyPaper,
  source: ScholarlyPaper,
  relation: MergeRelation,
): void {
  const fillIfMissing = <K extends keyof ScholarlyPaper>(key: K): void => {
    if (target[key] === undefined && source[key] !== undefined) {
      target[key] = source[key]
    }
  }

  // Basic descriptive fields. Identifiers other than the DOI may be filled from
  // a version: they are cross-references to the same work, not a second work's
  // metadata. The DOI itself follows the published-over-preprint rule below.
  for (const k of [
    'year',
    'date',
    'venue',
    'tldr',
    'type',
    'arxiv',
    'pmid',
    'pmcid',
    'openalex',
    's2',
    'pdfUrl',
  ] as const) {
    fillIfMissing(k)
  }
  if (relation === 'same') {
    fillIfMissing('url')
  }

  // Published DOI takes precedence over preprint arXiv DOI
  if (
    source.doi !== undefined &&
    (target.doi === undefined ||
      (/^10\.48550\//i.test(target.doi) && !/^10\.48550\//i.test(source.doi)))
  ) {
    target.doi = source.doi
  }

  if (relation === 'same') {
    // Abstract: take the longer and richer text
    if (source.abstract && (!target.abstract || source.abstract.length > target.abstract.length)) {
      target.abstract = source.abstract
    }

    // Authors: take the more complete list
    if (source.authors.length > target.authors.length) {
      target.authors = source.authors
    }
  } else {
    // A version preserves the primary record's own text and authors.
    if (target.abstract === undefined && source.abstract !== undefined) {
      target.abstract = source.abstract
    }
    if (target.authors.length === 0 && source.authors.length > 0) {
      target.authors = [...source.authors]
    }
  }

  // Citations: maximum of all sources
  if (source.citations !== undefined) {
    target.citations = Math.max(target.citations ?? 0, source.citations)
  }

  // Open Access: truthy wins
  if (
    source.openAccess === true ||
    (target.openAccess === undefined && source.openAccess !== undefined)
  ) {
    target.openAccess = source.openAccess
  }

  // Retraction belongs to the record that carries it and follows sightings of
  // that same record.
  if (relation === 'same' && source.retracted === true) {
    target.retracted = true
  }

  // Sources union
  for (const src of source.sources) {
    if (!target.sources.includes(src)) {
      target.sources.push(src)
    }
  }

  // In-library link if provided
  if (!target.inLibrary && source.inLibrary) {
    target.inLibrary = source.inLibrary
  }

  if (relation === 'version') {
    addVersionRecord(target, versionOf(source))
  }
}
