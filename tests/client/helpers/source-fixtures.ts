/**
 * Shared source fixtures for the panel specs and the visual baseline: the
 * neutral `sourceOf`/`workspaceOf` builders (the spec convention, same as
 * blocks.ts) and the per-scenario passage, artifact, and search builders.
 * The named scene workspaces compose these — the single-item scenes live in
 * `source-fixtures-gallery.ts`, the multi-item collections in
 * `source-fixtures-collections.ts` — so visual iteration never needs a live
 * session or a real Zotero.
 * @module tests/client/helpers/source-fixtures
 */

import type { SourceItem, SourceWorkspace } from '../../../src/sources/model.js'
import { filterCountsOf } from '../../../src/sources/filters.js'
import { normalizeRefKey } from '../../../src/sources/evidence-match.js'

/** A neutral base source; override per-spec fields to build a scenario. */
export function sourceOf(overrides: Partial<SourceItem> = {}): SourceItem {
  const base = {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    serverIds: [] as string[],
    evidenceMatch: 'unknown' as SourceItem['evidenceMatch'],
    facts: { reportedEvidenceCount: 0 },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [] as SourceItem['searches'],
    evidence: [] as SourceItem['evidence'],
    exports: [] as SourceItem['exports'],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    ...overrides,
  }
  return {
    ...base,
    // The totals mirror the lists unless a scenario pins them itself, the
    // same invariant the workspace builder upholds.
    searchesTotal: base.searches.length,
    evidenceTotal: base.evidence.length,
    exportsTotal: base.exports.length,
    ...Object.fromEntries(
      (
        [
          ['searchesTotal', overrides.searchesTotal],
          ['evidenceTotal', overrides.evidenceTotal],
          ['exportsTotal', overrides.exportsTotal],
        ] as const
      ).filter(([, value]) => value !== undefined),
    ),
  } as SourceItem
}

/** A workspace over the given sources with neutral session facts. */
export function workspaceOf(
  sources: readonly SourceItem[],
  overrides: Partial<Omit<SourceWorkspace, 'sources'>> = {},
): SourceWorkspace {
  const exports = overrides.exports ?? []
  const exportedRefs = new Set<string>()
  for (const artifact of exports) {
    for (const ref of artifact.refs) exportedRefs.add(normalizeRefKey(ref))
  }
  return {
    sources,
    sourceTotal: overrides.sourceTotal ?? sources.length,
    exports,
    exportTotal: overrides.exportTotal ?? exports.length,
    exportOperations: overrides.exportOperations ?? { running: 0, failed: 0, stopped: 0 },
    omittedRows: overrides.omittedRows ?? 0,
    filterCounts: overrides.filterCounts ?? filterCountsOf(sources),
    evidencePassageTotal:
      overrides.evidencePassageTotal ??
      sources.reduce((total, item) => total + item.evidence.length, 0),
    exportedRefCount: overrides.exportedRefCount ?? exportedRefs.size,
  }
}

/** A neutral evidence passage; override per scenario. */
export function passageOf(
  overrides: Partial<SourceItem['evidence'][number]> = {},
): SourceItem['evidence'][number] {
  return {
    source: 'PDF',
    sourceRef: 'zotero://user/0/attachment/ABCD1234',
    text: 'The policy applies to all covered entities.',
    previewTruncated: false,
    callIds: ['call-1'],
    ...overrides,
  }
}

/** A neutral export artifact; override per scenario. */
export function artifactOf(
  overrides: Partial<SourceWorkspace['exports'][number]> = {},
): SourceWorkspace['exports'][number] {
  const text = '@article{a,\n  title = {A},\n}'
  return {
    callId: 'call-export-1',
    format: 'bibtex',
    refs: ['zotero://user/0/item/QRST3456'],
    refsOmitted: 0,
    // The default itemization must locate its entry in the default body,
    // or the artifact would fall back to a whole-text row everywhere.
    text,
    items: [
      {
        ref: 'zotero://user/0/item/QRST3456',
        exportKey: 'a',
        title: 'A',
        start: 0,
        end: text.length,
      },
    ],
    ...overrides,
  }
}

/** A neutral search occurrence record; override per scenario. */
export function searchOf(
  overrides: Partial<SourceItem['searches'][number]> = {},
): SourceItem['searches'][number] {
  return {
    callId: 'call-1',
    query: 'risk policy',
    mode: 'everything',
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    itemTypes: [],
    tags: [],
    excludeTags: [],
    includeTrashed: false,
    returned: 1,
    total: 1,
    ...overrides,
  }
}
