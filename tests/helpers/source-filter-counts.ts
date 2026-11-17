/** Derive fixture totals from the public source-filter predicates. */
import { filterSources, type SourceFilterCounts } from '../../src/sources/filters.js'
import type { SourceItem } from '../../src/sources/model.js'

export function filterCountsOf(sources: readonly SourceItem[]): SourceFilterCounts {
  return {
    all: sources.length,
    pdf: filterSources(sources, 'pdf').length,
    retrieved: filterSources(sources, 'retrieved').length,
    evidence: filterSources(sources, 'evidence').length,
    exported: filterSources(sources, 'exported').length,
    issues: filterSources(sources, 'issues').length,
  }
}
