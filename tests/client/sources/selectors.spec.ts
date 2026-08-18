/**
 * Pure selectors over the source workspace: filters, the per-filter counts,
 * the issues predicate, and the exports view model.
 * @module tests/client/sources/selectors
 */

import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../../../src/client/sources/model.ts'
import {
  evidencePassageTotalOf,
  exportedRefCountOf,
  exportSectionsOf,
  filterCountsOf,
  filterSources,
  hasIssue,
} from '../../../src/client/sources/selectors.ts'
import { artifactOf, passageOf, sourceOf } from '../helpers/source-fixtures.ts'

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

  it('excludes a type-less ref from the pdf filter like the badge does', () => {
    const historical = sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/WXYZ6789' } })
    expect(filterSources([historical], 'pdf')).toHaveLength(0)
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

describe('exportSectionsOf', () => {
  const REF = 'zotero://user/0/item/QRST3456'
  const BIBTEX_TEXT = '@article{a,\n  title = {A},\n}'
  const RIS_TEXT = 'TY  - JOUR\nTI  - A\nID  - QRST3456\nER  -\n'
  const RIS_END = RIS_TEXT.length
  const BIBTEX_ITEMS = [{ ref: REF, key: 'a', title: 'A', start: 0, end: BIBTEX_TEXT.length }]

  it('groups documents into first-seen format sections', () => {
    const bibtex = artifactOf({
      callId: 'e1',
      format: 'bibtex',
      refs: [REF],
      text: BIBTEX_TEXT,
      items: BIBTEX_ITEMS,
    })
    const ris = artifactOf({
      callId: 'e2',
      format: 'ris',
      refs: [REF],
      text: RIS_TEXT,
      items: [{ ref: REF, title: 'A', start: 0, end: RIS_END }],
    })
    const sections = exportSectionsOf([bibtex, ris])
    expect(sections.map((section) => section.format)).toEqual(['bibtex', 'ris'])
    expect(sections[0]!.unresolved).toEqual([])
    expect(sections[0]!.unresolvedItems).toEqual([])
    expect(sections[0]!.documents[0]).toEqual({
      ref: REF,
      format: 'bibtex',
      key: 'a',
      title: 'A',
      text: BIBTEX_TEXT,
      callIds: ['e1'],
      latestExportedAt: undefined,
    })
    // RIS records carry no citation key; the document keeps only the title.
    expect(sections[1]!.documents[0]).toEqual({
      ref: REF,
      format: 'ris',
      title: 'A',
      text: 'TY  - JOUR\nTI  - A\nID  - QRST3456\nER  -',
      callIds: ['e2'],
      latestExportedAt: undefined,
    })
  })

  it('collapses repeated exports of one document into the latest result', () => {
    const updated = '@article{a,\n  title = {A updated},\n}'
    const first = artifactOf({
      callId: 'e1',
      format: 'bibtex',
      refs: [REF],
      settledAt: 1000,
      text: BIBTEX_TEXT,
      items: BIBTEX_ITEMS,
    })
    const second = artifactOf({
      callId: 'e2',
      format: 'bibtex',
      refs: [REF],
      settledAt: 2000,
      text: updated,
      items: [{ ref: REF, key: 'a', title: 'A updated', start: 0, end: updated.length }],
    })
    const sections = exportSectionsOf([first, second])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.documents).toHaveLength(1)
    expect(sections[0]!.documents[0]).toEqual({
      ref: REF,
      format: 'bibtex',
      key: 'a',
      title: 'A updated',
      text: updated,
      callIds: ['e1', 'e2'],
      latestExportedAt: 2000,
    })
  })

  it('keeps the other documents when one item cannot be located', () => {
    const text = '@article{a,\n  title = {A},\n}\n\n@article{b,\n  title = {B},\n}'
    const artifact = artifactOf({
      callId: 'e1',
      refs: [REF, 'zotero://user/0/item/BBBBBBBB'],
      text,
      items: [
        { ref: REF, key: 'a', title: 'A', start: 0, end: text.indexOf('@article{b,') },
        // The provider could not locate this item in the body.
        { ref: 'zotero://user/0/item/BBBBBBBB', key: 'b', title: 'B' },
      ],
    })
    const sections = exportSectionsOf([artifact])
    expect(sections[0]!.documents).toHaveLength(1)
    expect(sections[0]!.documents[0]).toMatchObject({ ref: REF, key: 'a' })
    expect(sections[0]!.unresolved).toEqual([])
    expect(sections[0]!.unresolvedItems).toEqual([{ artifact, count: 1 }])
  })

  it('falls back citation, bibliography, and legacy artifacts to whole-text rows', () => {
    const citation = artifactOf({
      callId: 'e1',
      format: 'citation',
      refs: [REF],
      text: '<span>A</span>',
    })
    const bibliography = artifactOf({
      callId: 'e2',
      format: 'bibliography',
      refs: [REF],
      text: '<div class="csl-entry">A</div>',
    })
    const legacy = artifactOf({ callId: 'e3', refs: [REF], items: undefined })
    const sections = exportSectionsOf([citation, bibliography, legacy])
    expect(sections.map((section) => section.format)).toEqual([
      'citation',
      'bibliography',
      'bibtex',
    ])
    expect(sections.every((section) => section.documents.length === 0)).toBe(true)
    expect(sections.every((section) => section.unresolvedItems.length === 0)).toBe(true)
    expect(sections[0]!.unresolved).toEqual([citation])
    expect(sections[1]!.unresolved).toEqual([bibliography])
    expect(sections[2]!.unresolved).toEqual([legacy])
  })

  it('falls back an empty itemization to a whole-text row and reports unlocatable items', () => {
    const empty = artifactOf({ callId: 'e1', refs: [REF], items: [] })
    const ris = artifactOf({
      callId: 'e2',
      format: 'ris',
      refs: [REF],
      text: RIS_TEXT,
      items: [{ ref: REF, title: 'A' }],
    })
    const sections = exportSectionsOf([empty, ris])
    expect(sections[0]!.unresolved).toEqual([empty])
    expect(sections[1]!.documents).toEqual([])
    expect(sections[1]!.unresolved).toEqual([])
    expect(sections[1]!.unresolvedItems).toEqual([{ artifact: ris, count: 1 }])
  })

  it('resolves CSL JSON documents through their id and array index', () => {
    const csljson = artifactOf({
      callId: 'e4',
      format: 'csljson',
      refs: [REF],
      text: JSON.stringify([{ id: 'wang2023', title: 'Carbon trading' }]),
      items: [{ ref: REF, key: 'wang2023', title: 'Carbon trading', entryIndex: 0 }],
    })
    const sections = exportSectionsOf([csljson])
    expect(sections[0]!.documents).toEqual([
      {
        ref: REF,
        format: 'csljson',
        key: 'wang2023',
        title: 'Carbon trading',
        text: '{"id":"wang2023","title":"Carbon trading"}',
        callIds: ['e4'],
      },
    ])
  })

  it('leaves CSL JSON items unlocated when the body or index is unusable', () => {
    const malformed = artifactOf({
      callId: 'e7',
      format: 'csljson',
      refs: [REF],
      text: 'not json',
      items: [{ ref: REF, key: 'wang2023', entryIndex: 0 }],
    })
    const noIndex = artifactOf({
      callId: 'e8',
      format: 'csljson',
      refs: [REF],
      text: JSON.stringify([{ id: 'wang2023' }]),
      items: [{ ref: REF, key: 'wang2023' }],
    })
    const notAnArray = artifactOf({
      callId: 'e9',
      format: 'csljson',
      refs: [REF],
      text: '{}',
      items: [{ ref: REF, key: 'wang2023', entryIndex: 0 }],
    })
    const notAnObject = artifactOf({
      callId: 'e10',
      format: 'csljson',
      refs: [REF],
      text: JSON.stringify(['junk', null]),
      items: [
        { ref: REF, key: 'wang2023', entryIndex: 0 },
        { ref: 'zotero://user/0/item/DDDDDDDD', key: 'x', entryIndex: 1 },
      ],
    })
    const sections = exportSectionsOf([malformed, noIndex, notAnArray, notAnObject])
    expect(sections.every((section) => section.documents.length === 0)).toBe(true)
    expect(sections[0]!.unresolvedItems).toEqual([
      { artifact: malformed, count: 1 },
      { artifact: noIndex, count: 1 },
      { artifact: notAnArray, count: 1 },
      { artifact: notAnObject, count: 2 },
    ])
  })

  it('omits the title when the entry carried none', () => {
    const artifact = artifactOf({
      callId: 'e6',
      items: [{ ref: REF, key: 'a', start: 0, end: BIBTEX_TEXT.length }],
    })
    const sections = exportSectionsOf([artifact])
    expect(sections[0]!.documents[0]).toMatchObject({
      ref: REF,
      key: 'a',
      text: BIBTEX_TEXT,
    })
    expect(sections[0]!.documents[0]!).not.toHaveProperty('title')
  })

  it('keeps the earlier title and time when a later export carries none', () => {
    const first = artifactOf({
      callId: 'e1',
      format: 'ris',
      refs: [REF],
      settledAt: 1000,
      text: RIS_TEXT,
      items: [{ ref: REF, title: 'A', start: 0, end: RIS_END }],
    })
    const second = artifactOf({
      callId: 'e2',
      format: 'ris',
      refs: [REF],
      text: 'TY  - JOUR\nTI  - A revised\nID  - QRST3456\nER  -\n',
      items: [
        {
          ref: REF,
          start: 0,
          end: 'TY  - JOUR\nTI  - A revised\nID  - QRST3456\nER  -\n'.length,
        },
      ],
    })
    const sections = exportSectionsOf([first, second])
    expect(sections[0]!.documents).toHaveLength(1)
    expect(sections[0]!.documents[0]).toEqual({
      ref: REF,
      format: 'ris',
      title: 'A',
      text: 'TY  - JOUR\nTI  - A revised\nID  - QRST3456\nER  -',
      callIds: ['e1', 'e2'],
      latestExportedAt: 1000,
    })
  })

  it('is empty for no exports', () => {
    expect(exportSectionsOf([])).toEqual([])
  })
})

describe('exportedRefCountOf', () => {
  it('counts distinct exported documents, deduplicated across formats', () => {
    const REF = 'zotero://user/0/item/QRST3456'
    const exports = [
      artifactOf({ callId: 'e1', format: 'bibtex', refs: [REF] }),
      artifactOf({ callId: 'e2', format: 'ris', refs: [REF] }),
      artifactOf({ callId: 'e3', format: 'bibtex', refs: ['zotero://user/0/item/AAAA1111'] }),
    ]
    expect(exportedRefCountOf(exports)).toBe(2)
  })

  it('deduplicates refs that differ only by server provenance', () => {
    const exports = [
      artifactOf({ callId: 'e1', refs: ['zotero://user/0/item/QRST3456'] }),
      artifactOf({ callId: 'e2', refs: ['zotero://user/0/item/QRST3456?server=S1'] }),
    ]
    expect(exportedRefCountOf(exports)).toBe(1)
  })

  it('is zero for no exports', () => {
    expect(exportedRefCountOf([])).toBe(0)
  })
})
