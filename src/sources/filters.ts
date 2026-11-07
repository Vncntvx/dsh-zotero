/**
 * The source filters, the per-filter counts, and the predicates behind both.
 * Filters narrow the stable union; they never replace it, so clearing a
 * filter restores every source. The table lives under `src/sources/` so the
 * host's workspace aggregates count sources with exactly the predicates the
 * browser's filter bar renders by — a second copy in the client would let
 * the pill count and the listing disagree. The "with PDF" filter shares its
 * single source of truth with the PDF badge and the open-PDF action
 * (`hasPdf`), and "issues" spans every non-running irregularity, so what the
 * bar names is what it shows.
 * @module dsh-zotero/sources/filters
 */

import type { SourceItem } from './model.js'
import { hasPdf } from './source-capabilities.js'

/** The sources filters; every filter is a subset of the stable union. */
export type SourceFilter = 'all' | 'pdf' | 'retrieved' | 'evidence' | 'exported' | 'issues'

/**
 * Whether one source carries an issue: a failed or stopped call, or an
 * instance mismatch. A running call is in flight, not an issue.
 * @param item - the source to probe.
 * @returns true when the source belongs in the issues filter.
 */
export function hasIssue(item: SourceItem): boolean {
  return (
    item.operations.failed > 0 || item.operations.stopped > 0 || item.evidenceMatch === 'mismatch'
  )
}

/**
 * One predicate per filter id. Both the filter bar's counts and the filtered
 * listing read this table, so a new filter is added once or the pill count
 * and the listing disagree.
 */
const SOURCE_FILTER_PREDICATES = {
  pdf: (item: SourceItem) => hasPdf(item),
  retrieved: (item: SourceItem) => item.retrievalFacts !== undefined,
  evidence: (item: SourceItem) => item.evidence.length > 0,
  exported: (item: SourceItem) => item.exports.length > 0,
  issues: (item: SourceItem) => hasIssue(item),
} as const satisfies Record<Exclude<SourceFilter, 'all'>, (item: SourceItem) => boolean>

/** The filter ids in their bar order, derived from the predicate table. */
const FILTER_IDS = Object.keys(SOURCE_FILTER_PREDICATES) as Array<
  keyof typeof SOURCE_FILTER_PREDICATES
>

/**
 * Narrow the sources to one filter. Callers pass whatever list they render —
 * the full union or the workspace's windowed view; the counts the filter bar
 * shows come from the workspace's aggregates, computed before the window.
 * @param sources - the sources to filter.
 * @param filter - the filter id.
 * @returns the matching sources, in the input order.
 */
export function filterSources(
  sources: readonly SourceItem[],
  filter: SourceFilter,
): readonly SourceItem[] {
  if (filter === 'all') return sources
  const predicate = SOURCE_FILTER_PREDICATES[filter]
  return predicate !== undefined ? sources.filter(predicate) : sources
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

/** Count the sources matching each filter in one pass. */
export function filterCountsOf(sources: readonly SourceItem[]): SourceFilterCounts {
  const counts = { all: sources.length, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 }
  for (const item of sources) {
    for (const id of FILTER_IDS) {
      if (SOURCE_FILTER_PREDICATES[id](item)) counts[id] += 1
    }
  }
  return counts
}
