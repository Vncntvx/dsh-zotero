/** Local-only reference reconciliation for BibTeX-like inputs. */

import { deepEqualJson, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { mapWithConcurrency } from '../concurrency.js'
import { ZOTERO_LIST_PAGE_ROWS } from '../constants.js'
import {
  normalizeAuthorForAlignment,
  normalizeDoiForAlignment,
  normalizeTitleForAlignment,
  normalizeYearForAlignment,
} from '../export-mapping.js'
import { ZoteroError, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED } from '../errors.js'
import type {
  ZoteroMatchReferenceInput,
  ZoteroMatchReferenceCandidate,
  ZoteroMatchReferenceResult,
  ZoteroMatchReferencesRequest,
  ZoteroMatchReferencesResult,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroSearchItem,
} from '../types.js'

export const MATCH_REFERENCES_MAX = 50

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function titleOf(input: ZoteroMatchReferenceInput): string | undefined {
  return normalizeTitleForAlignment(clean(input.title))
}

function authorsOf(input: ZoteroMatchReferenceInput): string[] {
  return (input.authors ?? []).map((author) => author.trim()).filter(Boolean)
}

function candidateOf(
  detail: ZoteroSearchItem,
  method: string,
  confidence: 'high' | 'medium' | 'low',
): ZoteroMatchReferenceCandidate {
  return {
    ref: detail.ref,
    ...(detail.citationKey === undefined ? {} : { citationKey: detail.citationKey }),
    ...(detail.citationKeySource === undefined
      ? {}
      : { citationKeySource: detail.citationKeySource }),
    title: detail.title,
    ...(detail.authors === undefined ? {} : { authors: detail.authors }),
    ...(detail.year === undefined ? {} : { year: detail.year }),
    ...(detail.doi === undefined ? {} : { doi: detail.doi }),
    ...(detail.venue === undefined ? {} : { venue: detail.venue }),
    ...(detail.citationKeyConflict === undefined
      ? {}
      : { citationKeyConflict: detail.citationKeyConflict }),
    matchMethod: method,
    confidence,
  }
}

function fieldDiffOf(
  input: ZoteroMatchReferenceInput,
  candidate: ZoteroMatchReferenceCandidate,
): ZoteroMatchReferenceResult['fieldDiff'] {
  const diff: NonNullable<ZoteroMatchReferenceResult['fieldDiff']> = {}
  const add = (field: string, expected: unknown, actual: unknown): void => {
    if (expected === undefined || actual === undefined) return
    if (!deepEqualJson(expected as JsonValue, actual as JsonValue)) {
      diff[field] = { input: expected as never, zotero: actual as never }
    }
  }
  add('title', clean(input.title), candidate.title)
  add('doi', normalizeDoiForAlignment(clean(input.doi)), normalizeDoiForAlignment(candidate.doi))
  add('year', input.year, candidate.year)
  add('authors', input.authors ? authorsOf(input) : undefined, candidate.authors)
  add('venue', clean(input.venue), candidate.venue)
  return Object.keys(diff).length === 0 ? undefined : diff
}

/**
 * Zotero's quick-search modes do not index DOI fields. Read every top-level
 * metadata page once for this reconciliation call, then retain only exact DOI
 * hits. The total and cursor checks make an incomplete or shifting scan fail
 * closed instead of turning an unseen DOI into `notFound` or a false unique
 * match.
 */
async function candidatesByDoi(
  deps: {
    search: (request: ZoteroSearchRequest, signal?: AbortSignal) => Promise<ZoteroSearchResult>
  },
  dois: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<Map<string, ZoteroSearchItem[]>> {
  const matches = new Map([...dois].map((doi) => [doi, [] as ZoteroSearchItem[]]))
  if (matches.size === 0) return matches

  const fetchPage = (offset: number) =>
    deps.search(
      {
        query: '',
        mode: 'metadata',
        scope: { kind: 'library' },
        sort: 'dateModified',
        direction: 'desc',
        offset,
        limit: ZOTERO_LIST_PAGE_ROWS,
        itemLevel: 'top',
      },
      signal,
    )

  const firstPage = await fetchPage(0)
  if (firstPage.offset !== 0 || firstPage.returned !== firstPage.items.length) {
    throw new ZoteroError('DOI lookup received an inconsistent page.', ZOTERO_UNEXPECTED)
  }
  const total = firstPage.total
  if (firstPage.returned > total) {
    throw new ZoteroError('DOI lookup received an inconsistent page.', ZOTERO_UNEXPECTED)
  }

  const addItems = (items: ZoteroSearchItem[]) => {
    for (const item of items) {
      const doi = normalizeDoiForAlignment(item.doi)
      if (doi === undefined) continue
      const bucket = matches.get(doi)
      if (bucket !== undefined) bucket.push(item)
    }
  }

  addItems(firstPage.items)

  const next = firstPage.returned
  if (next >= total) {
    if (firstPage.nextOffset !== undefined) {
      throw new ZoteroError('DOI lookup returned a cursor beyond its total.', ZOTERO_UNEXPECTED)
    }
    return matches
  }

  if (firstPage.returned === 0 || firstPage.nextOffset !== next) {
    throw new ZoteroError('DOI lookup did not return every library page.', ZOTERO_UNEXPECTED)
  }

  const remainingOffsets: number[] = []
  for (let offset = next; offset < total; offset += ZOTERO_LIST_PAGE_ROWS) {
    remainingOffsets.push(offset)
  }

  const remainingPages = await mapWithConcurrency(remainingOffsets, 4, async (offset) => {
    const page = await fetchPage(offset)
    if (page.offset !== offset || page.returned !== page.items.length) {
      throw new ZoteroError('DOI lookup received an inconsistent page.', ZOTERO_UNEXPECTED)
    }
    if (page.total !== total) {
      throw new ZoteroError('The Zotero library changed during DOI lookup.', ZOTERO_UNEXPECTED)
    }
    if (offset > page.total || page.returned > page.total - offset) {
      throw new ZoteroError('DOI lookup received an inconsistent page.', ZOTERO_UNEXPECTED)
    }
    const pageNext = offset + page.returned
    if (pageNext >= total) {
      if (page.nextOffset !== undefined) {
        throw new ZoteroError('DOI lookup returned a cursor beyond its total.', ZOTERO_UNEXPECTED)
      }
    } else if (page.returned === 0 || page.nextOffset !== pageNext) {
      throw new ZoteroError('DOI lookup did not return every library page.', ZOTERO_UNEXPECTED)
    }
    return page
  })

  for (const page of remainingPages) {
    addItems(page.items)
  }

  return matches
}

export async function matchReferences(
  deps: {
    search: (request: ZoteroSearchRequest, signal?: AbortSignal) => Promise<ZoteroSearchResult>
  },
  request: ZoteroMatchReferencesRequest,
  signal?: AbortSignal,
): Promise<ZoteroMatchReferencesResult> {
  if (request.references.length === 0 || request.references.length > MATCH_REFERENCES_MAX) {
    throw new ZoteroError(
      `references must contain 1-${MATCH_REFERENCES_MAX} entries`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const ids = new Set<string>()
  for (const input of request.references) {
    if (input.inputId.trim() === '' || ids.has(input.inputId.trim())) {
      throw new ZoteroError(
        'references.inputId values must be non-empty and unique',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    ids.add(input.inputId.trim())
    if (clean(input.doi) === undefined && titleOf(input) === undefined) {
      throw new ZoteroError('each reference must provide a DOI or title', ZOTERO_INVALID_ARGUMENT)
    }
  }

  const doiValues = new Set(
    request.references
      .map((input) => normalizeDoiForAlignment(clean(input.doi)))
      .filter((doi): doi is string => doi !== undefined),
  )
  const doiMatches = await candidatesByDoi(deps, doiValues, signal)

  const values = await mapWithConcurrency(
    request.references,
    8,
    async (input) => {
      const searchBy = async (query: string) =>
        await deps.search(
          {
            query,
            mode: 'metadata',
            scope: { kind: 'library' },
            sort: 'dateModified',
            direction: 'desc',
            offset: 0,
            limit: 20,
            itemLevel: 'top',
          },
          signal,
        )
      let incompleteSearch = false
      const searchCandidates = async (query: string) => {
        const page = await searchBy(query)
        if (page.nextOffset !== undefined || page.total > page.returned) incompleteSearch = true
        return page
      }
      const doi = normalizeDoiForAlignment(clean(input.doi))
      const firstQuery = clean(input.doi) ?? clean(input.bibKey) ?? clean(input.title)!
      let candidates =
        doi === undefined
          ? (await searchCandidates(firstQuery)).items
          : [...(doiMatches.get(doi) ?? [])]
      const hasExactDoi =
        doi !== undefined && candidates.some((item) => normalizeDoiForAlignment(item.doi) === doi)
      if (!hasExactDoi && clean(input.title) !== undefined && clean(input.title) !== firstQuery) {
        const titleResults = await searchCandidates(clean(input.title)!)
        const byRef = new Map(candidates.map((item) => [item.ref, item]))
        for (const item of titleResults.items) byRef.set(item.ref, item)
        candidates = [...byRef.values()]
      }
      const title = titleOf(input)
      const inputAuthors = authorsOf(input)
        .map(normalizeAuthorForAlignment)
        .filter((value): value is string => value !== undefined)
      const scored = candidates
        .map((detail) => {
          const detailDoi = normalizeDoiForAlignment(detail.doi)
          const detailTitleClean = normalizeTitleForAlignment(detail.title)
          const doiMatch = doi !== undefined && detailDoi === doi
          const keyMatch =
            clean(input.bibKey) !== undefined &&
            clean(input.bibKey) === detail.citationKey &&
            (doi === undefined || detailDoi === undefined || doiMatch)
          const titleMatch = title !== undefined && detailTitleClean === title
          const yearMatch =
            input.year === undefined ||
            normalizeYearForAlignment(String(detail.year)) ===
              normalizeYearForAlignment(String(input.year))
          const detailAuthors = (detail.authors ?? [])
            .map(normalizeAuthorForAlignment)
            .filter((value): value is string => value !== undefined)
          const authorMatch =
            inputAuthors.length === 0 ||
            inputAuthors.every((author) => detailAuthors.includes(author))
          const venueMatch =
            clean(input.venue) === undefined ||
            normalizeTitleForAlignment(input.venue) === normalizeTitleForAlignment(detail.venue)
          const titleCanMatch =
            titleMatch && (doi === undefined || detailDoi === undefined || doiMatch)
          const score = doiMatch
            ? 1000
            : keyMatch
              ? 900
              : titleCanMatch
                ? 600 +
                  (yearMatch ? 60 : 0) +
                  (authorMatch && inputAuthors.length > 0 ? 40 : 0) +
                  (venueMatch && clean(input.venue) !== undefined ? 10 : 0)
                : 0
          const confidence =
            doiMatch || keyMatch
              ? ('high' as const)
              : titleCanMatch && yearMatch && authorMatch && inputAuthors.length > 0
                ? ('high' as const)
                : titleCanMatch && (yearMatch || (authorMatch && inputAuthors.length > 0))
                  ? ('medium' as const)
                  : ('low' as const)
          return {
            detail,
            score,
            method: doiMatch
              ? 'doi'
              : keyMatch
                ? 'citationKey'
                : titleCanMatch
                  ? 'titleFingerprint'
                  : 'none',
            confidence,
          }
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
      const first = scored[0]
      const base = {
        inputId: input.inputId.trim(),
        ...(input.bibKey ? { bibKey: input.bibKey } : {}),
      }
      const incompleteReason = 'The candidate search was truncated; no unique match was selected.'
      if (first === undefined) {
        return incompleteSearch
          ? { ...base, status: 'ambiguous' as const, reason: incompleteReason }
          : { ...base, status: 'notFound' as const }
      }
      const tied = scored.filter((entry) => entry.score === first.score)
      const candidatesOut = scored
        .slice(0, 5)
        .map((entry) => candidateOf(entry.detail, entry.method, entry.confidence))
      if (tied.length > 1) {
        return {
          ...base,
          status: 'ambiguous' as const,
          ...(incompleteSearch ? { reason: incompleteReason } : {}),
          candidates: candidatesOut,
        }
      }
      if (first.detail.citationKeyConflict !== undefined) {
        return {
          ...base,
          status: 'conflict' as const,
          ...(incompleteSearch ? { reason: incompleteReason } : {}),
          candidates: [candidateOf(first.detail, first.method, first.confidence)],
        }
      }
      if (incompleteSearch) {
        return {
          ...base,
          status: 'ambiguous' as const,
          reason: incompleteReason,
          candidates: candidatesOut,
        }
      }
      if (first.confidence === 'low' || first.confidence === 'medium') {
        return { ...base, status: 'ambiguous' as const, candidates: candidatesOut }
      }
      const selected = candidateOf(first.detail, first.method, first.confidence)
      const result: ZoteroMatchReferenceResult = { ...base, status: 'matched', selected }
      if (request.includeFieldDiff === true) {
        const fieldDiff = fieldDiffOf(input, selected)
        if (fieldDiff !== undefined) result.fieldDiff = fieldDiff
      }
      return result
    },
    { signal },
  )
  return { items: values }
}
