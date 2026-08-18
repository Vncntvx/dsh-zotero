/**
 * Pure selectors over the source workspace: filters and the neutral count
 * strip. Filters narrow the stable union — they never replace it, so
 * clearing a filter restores every source.
 * @module dsh-zotero/client/sources/selectors
 */

import type { SourceItem, SourceWorkspace } from './model.ts'

/** The sources filters; every filter is a subset of the stable union. */
export type SourceFilter = 'all' | 'evidence' | 'exported' | 'attachment' | 'failed' | 'retrieved'

export function filterSources(
  sources: readonly SourceItem[],
  filter: SourceFilter,
): readonly SourceItem[] {
  switch (filter) {
    case 'evidence':
      return sources.filter((item) => item.facts.evidenceCount > 0)
    case 'exported':
      return sources.filter((item) => item.facts.exportCount > 0)
    case 'attachment':
      return sources.filter((item) => item.facts.attachmentResolved)
    case 'failed':
      return sources.filter((item) => item.operations.failed > 0)
    case 'retrieved':
      return sources.filter((item) => item.retrievalFacts !== undefined)
    default:
      return sources
  }
}

/** The neutral count strip: item counts per provable stage (no funnel). */
export interface SourceCounts {
  readonly candidates: number
  readonly inspected: number
  readonly evidence: number
  readonly exported: number
}

export function countsOf(workspace: SourceWorkspace): SourceCounts {
  let inspected = 0
  let evidence = 0
  let exported = 0
  for (const source of workspace.sources) {
    if (source.facts.inspected) inspected += 1
    if (source.facts.evidenceCount > 0) evidence += 1
    if (source.facts.exportCount > 0) exported += 1
  }
  return { candidates: workspace.sources.length, inspected, evidence, exported }
}
