/**
 * Pure selectors over the source workspace: filters and counts.
 * @module tests/client/sources/selectors
 */

import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../../../src/client/sources/model.ts'
import { countsOf, filterSources } from '../../../src/client/sources/selectors.ts'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'

const SOURCES: readonly SourceItem[] = [
  sourceOf({ key: 'a', ref: 'zotero://user/0/item/A', firstSeenAt: 3, lastTouchedAt: 3 }),
  sourceOf({
    key: 'b',
    ref: 'zotero://user/0/item/B',
    title: 'Alpha',
    firstSeenAt: 1,
    lastTouchedAt: 9,
    facts: {
      inspected: false,
      evidenceCount: 2,
      reportedEvidenceCount: 2,
      attachmentResolved: false,
      exportCount: 0,
    },
  }),
  sourceOf({
    key: 'c',
    ref: 'zotero://user/0/item/C',
    title: 'Beta',
    firstSeenAt: 2,
    lastTouchedAt: 2,
    facts: {
      inspected: false,
      evidenceCount: 0,
      reportedEvidenceCount: 0,
      attachmentResolved: true,
      exportCount: 1,
    },
  }),
  sourceOf({
    key: 'd',
    ref: 'zotero://user/0/item/D',
    firstSeenAt: 4,
    lastTouchedAt: 4,
    operations: { running: 0, failed: 1, stopped: 0 },
  }),
]

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

describe('countsOf', () => {
  it('counts the neutral strip per provable stage', () => {
    const workspace = workspaceOf([
      sourceOf({}),
      sourceOf({
        facts: {
          inspected: true,
          evidenceCount: 0,
          reportedEvidenceCount: 0,
          attachmentResolved: false,
          exportCount: 0,
        },
      }),
      sourceOf({
        facts: {
          inspected: false,
          evidenceCount: 3,
          reportedEvidenceCount: 3,
          attachmentResolved: false,
          exportCount: 0,
        },
      }),
      sourceOf({
        facts: {
          inspected: false,
          evidenceCount: 0,
          reportedEvidenceCount: 0,
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
