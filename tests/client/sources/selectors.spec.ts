/**
 * Pure selectors over the source workspace: filters, the per-filter counts,
 * and the issues predicate.
 * @module tests/client/sources/selectors
 */

import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../../../src/client/sources/model.ts'
import {
  evidencePassageTotalOf,
  filterCountsOf,
  filterSources,
  hasIssue,
} from '../../../src/client/sources/selectors.ts'
import { passageOf, sourceOf } from '../helpers/source-fixtures.ts'

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
    bestAttachment: { ref: 'zotero://user/0/attachment/WXYZ6789', contentType: 'application/pdf' },
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

  it('keeps only items with PDFs, evidence, exports, retrievals, or issues', () => {
    expect(filterSources(SOURCES, 'pdf').map((item) => item.key)).toEqual(['c'])
    expect(filterSources(SOURCES, 'retrieved').map((item) => item.key)).toEqual([])
    expect(filterSources(SOURCES, 'evidence').map((item) => item.key)).toEqual(['b'])
    expect(filterSources(SOURCES, 'exported').map((item) => item.key)).toEqual(['c'])
    expect(filterSources(SOURCES, 'issues').map((item) => item.key)).toEqual(['d'])
  })

  it('keeps an inferred PDF ref under the pdf filter like the badge does', () => {
    const historical = sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/WXYZ6789' } })
    expect(filterSources([historical], 'pdf')).toHaveLength(1)
  })

  it('returns empty for a filter with no matches', () => {
    expect(filterSources([SOURCES[0]!], 'evidence')).toEqual([])
  })
})

describe('hasIssue', () => {
  it('flags failed, stopped, and mismatched sources', () => {
    expect(hasIssue(sourceOf({ operations: { running: 0, failed: 1, stopped: 0 } }))).toBe(true)
    expect(hasIssue(sourceOf({ operations: { running: 0, failed: 0, stopped: 1 } }))).toBe(true)
    expect(hasIssue(sourceOf({ provenance: 'mismatch' }))).toBe(true)
  })

  it('does not flag a bare source or one with a call in flight', () => {
    expect(hasIssue(sourceOf({}))).toBe(false)
    expect(hasIssue(sourceOf({ operations: { running: 1, failed: 0, stopped: 0 } }))).toBe(false)
  })
})

describe('filterCountsOf', () => {
  it('counts each filter in one pass', () => {
    expect(filterCountsOf(SOURCES)).toEqual({
      all: 4,
      pdf: 1,
      retrieved: 0,
      evidence: 1,
      exported: 1,
      issues: 1,
    })
  })

  it('is all zero for an empty list', () => {
    expect(filterCountsOf([])).toEqual({
      all: 0,
      pdf: 0,
      retrieved: 0,
      evidence: 0,
      exported: 0,
      issues: 0,
    })
  })
})

describe('evidencePassageTotalOf', () => {
  it('sums the kept passages, not the sources that carry them', () => {
    const sources = [
      sourceOf({
        facts: {
          inspected: false,
          evidenceCount: 3,
          reportedEvidenceCount: 3,
          attachmentResolved: false,
          exportCount: 0,
        },
        evidence: [passageOf(), passageOf(), passageOf()],
      }),
      sourceOf({
        facts: {
          inspected: false,
          evidenceCount: 1,
          reportedEvidenceCount: 1,
          attachmentResolved: false,
          exportCount: 0,
        },
        evidence: [passageOf()],
      }),
      sourceOf({}),
    ]
    expect(evidencePassageTotalOf(sources)).toBe(4)
    // The same three sources count as two evidence-bearing sources — the
    // filter pill count and the overview sum genuinely differ.
    expect(filterCountsOf(sources).evidence).toBe(2)
  })

  it('is zero when no source carries passages', () => {
    expect(evidencePassageTotalOf([sourceOf({}), sourceOf({})])).toBe(0)
  })

  it('is zero for an empty list', () => {
    expect(evidencePassageTotalOf([])).toBe(0)
  })
})
