/**
 * The retrieve projection: ranked evidence with provenance and source kinds,
 * fulltext passages without invented page locators, and the caps that keep a
 * card's rows bounded while its total stays exact.
 * @module tests/unit/presentation-meta-retrieve
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroEvidence, ZoteroEvidenceRetrieveResult } from '../../src/types.js'
import {
  MAX_PRESENTATION_EVIDENCE_CHARS,
  projectRetrieveMeta,
} from '../../src/presentation-meta.js'

/** One evidence passage as a test writes it: the match kind defaults to lexical. */
type EvidenceOverride = Omit<ZoteroEvidence, 'matchKind'> & {
  matchKind?: ZoteroEvidence['matchKind']
}

/** The retrieve-result overrides a test may set; evidence carries its own type. */
type RetrieveOverrides = Partial<Omit<ZoteroEvidenceRetrieveResult, 'evidence'>> & {
  evidence?: EvidenceOverride[]
}

/**
 * A full retrieve result with every required field; tests spread overrides.
 * A passage that names no match kind is lexical — that is what the core's own
 * ranker produces, and a projection test is not the place to re-assert it.
 */
function retrieveResult(overrides: RetrieveOverrides = {}): ZoteroEvidenceRetrieveResult {
  const { evidence = [], ...rest } = overrides
  return {
    mode: 'evidence',
    ref: 'zotero://user/0/item/ABCDEFGH',
    truncated: false,
    sourcesSkipped: [],
    ...rest,
    queryTerms: overrides.queryTerms ?? [],
    evidence: evidence.map((entry) => ({ matchKind: 'lexical' as const, ...entry })),
  }
}

/** Project an evidence result and narrow to its arm; these cases are all evidence. */
const projectEvidence = (
  value: ZoteroEvidenceRetrieveResult,
  requestedSources: Parameters<typeof projectRetrieveMeta>[1] = [],
) =>
  projectRetrieveMeta(value, requestedSources) as Extract<
    ReturnType<typeof projectRetrieveMeta>,
    { mode: 'evidence' }
  >

describe('projectRetrieveMeta', () => {
  it('projects ranked evidence with provenance and source kinds', () => {
    const meta = projectEvidence(
      retrieveResult({
        evidence: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN000001',
            text: 'highlighted claim',
            pageLabel: '7',
            attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
            position: {
              pageIndex: 6,
              rects: [{ x: 10, y: 20, width: 20, height: 20 }],
            },
          },
          { source: 'note', sourceRef: 'zotero://user/0/item/NOTE0001', text: 'my note' },
          {
            source: 'fulltext',
            sourceRef: 'zotero://user/0/item/ABCDEFGH',
            text: 'the paper body',
          },
        ],
        truncated: true,
        sourcesSkipped: ['abstract'],
      }),
      ['annotation', 'note', 'abstract', 'fulltext'],
    )
    expect(meta.count).toBe(3)
    expect(meta.sources).toEqual(['annotation', 'note', 'fulltext'])
    expect(meta.truncated).toBe(true)
    expect(meta.sourcesSkipped).toEqual(['abstract'])
    expect(meta.items).toHaveLength(3)
    expect(meta.items[0]).toEqual({
      source: 'annotation',
      sourceRef: 'zotero://user/0/annotation/ANN000001',
      preview: 'highlighted claim',
      previewTruncated: false,
      matchKind: 'lexical',
      pageLabel: '7',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      position: {
        pageIndex: 6,
        rects: [{ x: 10, y: 20, width: 20, height: 20 }],
      },
    })
    // Fulltext passages never gain an invented page locator.
    expect(meta.items[2]!.pageLabel).toBeUndefined()
  })

  it("carries which of an annotation's two fields carried the query", () => {
    const meta = projectEvidence(
      retrieveResult({
        evidence: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN000001',
            text: 'the annotator disagrees',
            comment: 'this is only in the margin',
            matchedFields: ['comment'],
          },
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN000002',
            text: 'the paper says it',
            matchedFields: ['text'],
          },
          // A single-field source never reports matchedFields, and the
          // projection must not invent an empty list for it.
          { source: 'note', sourceRef: 'zotero://user/0/item/NOTE0001', text: 'my note' },
        ],
        truncated: false,
        sourcesSkipped: [],
      }),
      ['annotation', 'note'],
    )
    expect(meta.items[0]!.matchedFields).toEqual(['comment'])
    expect(meta.items[1]!.matchedFields).toEqual(['text'])
    expect(meta.items[2]!.matchedFields).toBeUndefined()
  })

  it('records per-source availability from the requested list', () => {
    const meta = projectEvidence(
      retrieveResult({
        evidence: [
          { source: 'annotation', sourceRef: 'zotero://user/0/annotation/ANN1', text: 'a' },
          { source: 'fulltext', sourceRef: 'zotero://user/0/item/ABCDEFGH', text: 'b' },
        ],
        truncated: false,
        sourcesSkipped: ['note'],
      }),
      ['annotation', 'note'],
    )
    expect(meta.sourceAvailability).toEqual({
      annotation: { requested: true, returnedPassages: 1, unavailable: false },
      note: { requested: true, returnedPassages: 0, unavailable: true },
    })
  })

  it('passes the attachment ref and coverage through when the result carries them', () => {
    const meta = projectEvidence(
      retrieveResult({
        evidence: [],
        truncated: false,
        sourcesSkipped: [],
        attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
        coverage: { indexedPages: 5, totalPages: 10, complete: false },
      }),
      ['fulltext'],
    )
    expect(meta.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(meta.coverage).toEqual({ indexedPages: 5, totalPages: 10, complete: false })
  })

  it('caps passages and previews, marking preview truncation', () => {
    const meta = projectEvidence(
      retrieveResult({
        evidence: Array.from({ length: 6 }, (_, index) => ({
          source: 'fulltext',
          sourceRef: 'zotero://user/0/item/ABCDEFGH',
          text: `chunk ${index} ${'x'.repeat(MAX_PRESENTATION_EVIDENCE_CHARS + 10)}`,
        })),
        truncated: false,
        sourcesSkipped: [],
      }),
      ['fulltext'],
    )
    expect(meta.items).toHaveLength(4)
    expect(meta.items[0]!.preview).toHaveLength(MAX_PRESENTATION_EVIDENCE_CHARS)
    expect(meta.items[0]!.previewTruncated).toBe(true)
    // `count` stays the call's own total, not the cap: the Chat card states it
    // in the collapsed line and derives the omitted number from it, so a `count`
    // that tracked the cap would make the card claim it had found everything.
    expect(meta.count).toBe(6)
  })

  it('filters out unrecognized evidence sources and dedupes valid ones in first-seen order', () => {
    const meta = projectEvidence(
      retrieveResult({
        evidence: [
          { source: 'annotation', sourceRef: 'zotero://user/0/annotation/ANN1', text: 'a' },
          { source: 'unknown' as never, sourceRef: 'zotero://user/0/item/U1', text: 'u' },
          { source: 'annotation', sourceRef: 'zotero://user/0/annotation/ANN2', text: 'b' },
          { source: 'note', sourceRef: 'zotero://user/0/item/NOTE1', text: 'n' },
          { source: 'invalid_source' as never, sourceRef: 'zotero://user/0/item/U2', text: 'u2' },
          { source: 'fulltext', sourceRef: 'zotero://user/0/item/ABCDEFGH', text: 'f' },
        ],
        truncated: false,
        sourcesSkipped: [],
      }),
      ['annotation', 'note', 'fulltext'],
    )
    expect(meta.sources).toEqual(['annotation', 'note', 'fulltext'])
    expect(meta.sources).not.toContain('unknown')
    expect(meta.sources).not.toContain('invalid_source')
    expect(meta.count).toBe(6)
  })
})
