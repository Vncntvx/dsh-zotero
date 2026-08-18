/**
 * Shared source fixtures for the panel specs: one base SourceItem with
 * neutral defaults plus a workspace builder. Specs spread per-scenario
 * overrides over the base (the same convention as blocks.ts for tool
 * blocks).
 * @module tests/client/helpers/source-fixtures
 */

import type { SourceItem, SourceWorkspace } from '../../../src/client/sources/model.ts'

/** A neutral base source; override per-spec fields to build a scenario. */
export function sourceOf(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    provenance: 'unknown',
    facts: {
      inspected: false,
      evidenceCount: 0,
      reportedEvidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [],
    evidence: [],
    exports: [],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    ...overrides,
  }
}

/** A workspace over the given sources with neutral session facts. */
export function workspaceOf(
  sources: readonly SourceItem[],
  overrides: Partial<Omit<SourceWorkspace, 'sources'>> = {},
): SourceWorkspace {
  return {
    sources,
    exports: [],
    exportOperations: { running: 0, failed: 0, stopped: 0 },
    omittedRows: 0,
    ...overrides,
  }
}
