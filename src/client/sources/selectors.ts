/**
 * Pure selectors over the source workspace: filters and the per-filter
 * counts. Filters narrow the stable union — they never replace it, so
 * clearing a filter restores every source. The "with PDF" filter shares its
 * single source of truth with the PDF badge and the open-PDF action
 * (`hasPdf`), and "issues" spans every non-running irregularity, so what
 * the bar names is what it shows.
 * @module dsh-zotero/client/sources/selectors
 */

import type { SourceItem } from './model.ts'
import { hasPdf } from './source-capabilities.ts'

/** The sources filters; every filter is a subset of the stable union. */
export type SourceFilter = 'all' | 'pdf' | 'retrieved' | 'evidence' | 'exported' | 'issues'

/**
 * Whether one source carries an issue: a failed or stopped call, or a
 * provenance mismatch. A running call is in flight, not an issue.
 * @param item - the source to probe.
 * @returns true when the source belongs in the issues filter.
 */
export function hasIssue(item: SourceItem): boolean {
  return item.operations.failed > 0 || item.operations.stopped > 0 || item.provenance === 'mismatch'
}

export function filterSources(
  sources: readonly SourceItem[],
  filter: SourceFilter,
): readonly SourceItem[] {
  switch (filter) {
    case 'pdf':
      return sources.filter((item) => hasPdf(item))
    case 'retrieved':
      return sources.filter((item) => item.retrievalFacts !== undefined)
    case 'evidence':
      return sources.filter((item) => item.facts.evidenceCount > 0)
    case 'exported':
      return sources.filter((item) => item.facts.exportCount > 0)
    case 'issues':
      return sources.filter((item) => hasIssue(item))
    default:
      return sources
  }
}

/** The per-filter item counts the filter bar displays; a zero count disables its filter. */
export interface SourceFilterCounts {
  readonly all: number
  readonly pdf: number
  readonly retrieved: number
  readonly evidence: number
  readonly exported: number
  readonly issues: number
}

/**
 * Total passage count across the session: the actual kept passages, not the
 * number of sources that carry them. The sidebar's aggregate entry shows this
 * sum, while the "has passages" filter pill keeps the source count — the two
 * numbers mean different things and should not be conflated.
 */
export function evidencePassageTotalOf(sources: readonly SourceItem[]): number {
  return sources.reduce((total, item) => total + item.evidence.length, 0)
}

/** Count the sources matching each filter in one pass. */
export function filterCountsOf(sources: readonly SourceItem[]): SourceFilterCounts {
  let pdf = 0
  let retrieved = 0
  let evidence = 0
  let exported = 0
  let issues = 0
  for (const item of sources) {
    if (hasPdf(item)) pdf += 1
    if (item.retrievalFacts !== undefined) retrieved += 1
    if (item.facts.evidenceCount > 0) evidence += 1
    if (item.facts.exportCount > 0) exported += 1
    if (hasIssue(item)) issues += 1
  }
  return { all: sources.length, pdf, retrieved, evidence, exported, issues }
}
