/**
 * Pure selectors over the source workspace: filters, sorts, and counts.
 * @module tests/client/sources/selectors
 */

import { describe, expect, it } from 'vitest'
import type { SourceItem, SourceWorkspace } from '../../../src/client/sources/model.ts'
import { countsOf, filterSources, sortSources } from '../../../src/client/sources/selectors.ts'

function itemOf(overrides: Partial<SourceItem>): SourceItem {
  return {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    provenance: 'unknown',
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [],
    evidence: [],
    exports: [],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    callRefs: { successful: [], failed: [], running: [] },
    ...overrides,
  }
}

const SOURCES: readonly SourceItem[] = [
  itemOf({ key: 'a', ref: 'zotero://user/0/item/A', firstSeenAt: 3, lastTouchedAt: 3 }),
  itemOf({
    key: 'b',
    ref: 'zotero://user/0/item/B',
    title: 'Alpha',
    firstSeenAt: 1,
    lastTouchedAt: 9,
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 2,
      attachmentResolved: false,
      exportCount: 0,
    },
  }),
  itemOf({
    key: 'c',
    ref: 'zotero://user/0/item/C',
    title: 'Beta',
    firstSeenAt: 2,
    lastTouchedAt: 2,
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 0,
      attachmentResolved: true,
      exportCount: 1,
    },
  }),
  itemOf({
    key: 'd',
    ref: 'zotero://user/0/item/D',
    firstSeenAt: 4,
    lastTouchedAt: 4,
    operations: { running: 0, failed: 1, stopped: 0 },
  }),
]

function workspaceOf(sources: readonly SourceItem[]): SourceWorkspace {
  return {
    sources,
    exports: [],
    operations: { running: 0, failed: 0, stopped: 0 },
    exportOperations: { running: 0, failed: 0, stopped: 0 },
    unattributed: 0,
    omittedRows: 0,
  }
}

describe('filterSources', () => {
  it('passes everything through the all filter', () => {
    expect(filterSources(SOURCES, 'all')).toHaveLength(4)
  })

  it('keeps only items with evidence, exports, attachments, or failures', () => {
    expect(filterSources(SOURCES, 'evidence').map((item) => item.key)).toEqual(['b'])
    expect(filterSources(SOURCES, 'exported').map((item) => item.key)).toEqual(['c'])
    expect(filterSources(SOURCES, 'attachment').map((item) => item.key)).toEqual(['c'])
    expect(filterSources(SOURCES, 'failed').map((item) => item.key)).toEqual(['d'])
  })

  it('returns empty for a filter with no matches', () => {
    expect(filterSources([SOURCES[0]!], 'evidence')).toEqual([])
  })
})

describe('sortSources', () => {
  it('sorts by first seen by default', () => {
    expect(sortSources(SOURCES, 'firstSeen').map((item) => item.key)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('sorts by last touched, newest first', () => {
    expect(sortSources(SOURCES, 'lastTouched').map((item) => item.key)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
  })

  it('sorts by title with the ref as fallback', () => {
    expect(sortSources(SOURCES, 'title').map((item) => item.key)).toEqual(['b', 'c', 'a', 'd'])
  })
})

describe('countsOf', () => {
  it('counts the neutral strip per provable stage', () => {
    const workspace = workspaceOf([
      itemOf({}),
      itemOf({
        facts: {
          discovered: true,
          inspected: true,
          evidenceCount: 0,
          attachmentResolved: false,
          exportCount: 0,
        },
      }),
      itemOf({
        facts: {
          discovered: true,
          inspected: false,
          evidenceCount: 3,
          attachmentResolved: false,
          exportCount: 0,
        },
      }),
      itemOf({
        facts: {
          discovered: true,
          inspected: false,
          evidenceCount: 0,
          attachmentResolved: false,
          exportCount: 2,
        },
      }),
    ])
    expect(countsOf(workspace)).toEqual({ candidates: 4, inspected: 1, evidence: 1, exported: 1 })
  })

  it('is all zero for an empty workspace', () => {
    expect(countsOf(workspaceOf([]))).toEqual({
      candidates: 0,
      inspected: 0,
      evidence: 0,
      exported: 0,
    })
  })
})
