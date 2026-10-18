/**
 * Normalization and Match Lattice entity deduplication for scholarly papers.
 * @module dsh-zotero/scholarly/normalize
 */

import { extractArxivId } from './sources/arxiv.js'
import { parseYear } from './sources/helpers.js'
import type { ScholarlyPaper } from './types.js'

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

export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0
  if (setA.size === 0 || setB.size === 0) return 0.0

  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function isFuzzyTitleMatch(paperA: ScholarlyPaper, paperB: ScholarlyPaper): boolean {
  const tkA = titleKey(paperA.title)
  const tkB = titleKey(paperB.title)
  if (tkA === tkB && tkA.length >= 10) return true

  // Year check: if both have years, they must not diverge by more than 1
  if (
    paperA.year !== undefined &&
    paperB.year !== undefined &&
    Math.abs(paperA.year - paperB.year) > 1
  ) {
    return false
  }

  // Prefix containment check (e.g. "Title: Subtitle" vs "Title")
  if ((tkA.startsWith(tkB) || tkB.startsWith(tkA)) && Math.min(tkA.length, tkB.length) >= 20) {
    return true
  }

  const tokensA = titleTokens(paperA.title)
  const tokensB = titleTokens(paperB.title)
  return jaccardSimilarity(tokensA, tokensB) >= 0.7
}

/**
 * Derives canonical identifier keys for exact index mapping.
 */
export function canonicalKeysOf(paper: ScholarlyPaper): string[] {
  const keys: string[] = []
  if (paper.arxiv) keys.push(`arxiv:${paper.arxiv.toLowerCase()}`)
  if (paper.doi) keys.push(`doi:${paper.doi.toLowerCase()}`)
  if (paper.pmid) keys.push(`pmid:${paper.pmid}`)
  const tk = titleKey(paper.title)
  if (tk.length >= 20) keys.push(`title:${tk}`)
  return keys
}

/**
 * Fills in default URLs and aligns DOI/arXiv identities.
 */
export function normalizePaper(paper: ScholarlyPaper): ScholarlyPaper {
  const out = {
    ...paper,
    authors: [...(paper.authors ?? [])],
    sources: [...(paper.sources ?? [])],
  }

  // Align arXiv DOI and arXiv ID
  if (!out.arxiv && out.doi) {
    const matched = /^10\.48550\/arxiv\.(.+)$/i.exec(out.doi)?.[1]
    if (matched) {
      out.arxiv = extractArxivId(matched) ?? matched
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

/**
 * Merges metadata from `source` into `target` using field inheritance rules.
 */
export function mergePaperInto(target: ScholarlyPaper, source: ScholarlyPaper): void {
  const fillIfMissing = <K extends keyof ScholarlyPaper>(key: K): void => {
    if (target[key] === undefined && source[key] !== undefined) {
      target[key] = source[key]
    }
  }

  // Basic fields
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
    'url',
    'pdfUrl',
  ] as const) {
    fillIfMissing(k)
  }

  // Published DOI takes precedence over preprint arXiv DOI
  if (
    source.doi !== undefined &&
    (target.doi === undefined ||
      (/^10\.48550\//i.test(target.doi) && !/^10\.48550\//i.test(source.doi)))
  ) {
    target.doi = source.doi
  }

  // Abstract: take the longer and richer text
  if (source.abstract && (!target.abstract || source.abstract.length > target.abstract.length)) {
    target.abstract = source.abstract
  }

  // Authors: take the more complete list
  if (source.authors.length > target.authors.length) {
    target.authors = source.authors
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

  // Retraction: infectious (any retracted source marks paper as retracted)
  if (source.retracted === true) {
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
}
