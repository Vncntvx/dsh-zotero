/**
 * The session source reducer's retrieval-evidence rules: the facts one
 * retrieve folds into its item — the merged retrieval facts, the run summary,
 * and the deduplicated evidence passages — and what an unusable retrieve
 * projection degrades to. The item-assembly half of the same reducer lives in
 * `reducer.spec.ts`; the export artifacts and operation counters live in
 * `reducer-outputs.spec.ts`.
 * @module tests/client/sources/reducer-evidence
 */

import { describe, expect, it } from 'vitest'
import { buildSourceWorkspace } from '../../../src/client/sources/reducer.ts'
import { GET_META, REF, block } from './reducer-fixtures.ts'

const RETRIEVE_META = {
  count: 1,
  sources: ['annotation'],
  truncated: false,
  sourcesSkipped: [],
  items: [
    {
      source: 'annotation',
      sourceRef: 'zotero://user/0/annotation/ANN1',
      preview: 'the claim',
      previewTruncated: false,
      pageLabel: '7',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
    },
  ],
  attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
  coverage: { indexedPages: 5, totalPages: 10, complete: false },
  sourceAvailability: { annotation: { requested: true, returnedPassages: 1, unavailable: false } },
}

describe('buildSourceWorkspace', () => {
  describe('retrieve facts and evidence merge', () => {
    it('produces evidence facts from retrieve and never export facts', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      ])
      expect(workspace.sources[0]!.facts).toMatchObject({ evidenceCount: 1, exportCount: 0 })
      expect(workspace.exports).toEqual([])
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
        indexedPages: 5,
        totalPages: 10,
        complete: false,
      })
      expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
        'zotero://user/0/attachment/WXYZ6789',
      )
      expect(workspace.sources[0]!.evidence[0]!.attachmentRef).toBe(
        'zotero://user/0/attachment/WXYZ6789',
      )
    })

    it('summarizes retrieves with a run count, the latest event time, and the budget', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META, time: 1000 }),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              ...RETRIEVE_META,
              count: 2,
              items: [
                ...RETRIEVE_META.items,
                {
                  source: 'annotation',
                  sourceRef: 'zotero://user/0/annotation/ANN2',
                  preview: 'another claim',
                  previewTruncated: false,
                },
              ],
              truncated: true,
            },
            time: 2000,
          },
        ),
      ])
      const summary = workspace.sources[0]!.retrievalSummary
      expect(summary).toEqual({
        runCount: 2,
        latestRetrievedAt: 2000,
        truncated: true,
      })
      // The kept/reported counters live on facts alone — one storage path.
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(2)
      expect(workspace.sources[0]!.facts.reportedEvidenceCount).toBe(3)
    })

    it('counts a repeated retrieve call id as one run', () => {
      // The same call id replayed (a duplicated block in the slice) must not
      // inflate the run count; the evidence merge still refreshes counters.
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
        block('r1', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      ])
      expect(workspace.sources[0]!.retrievalSummary?.runCount).toBe(1)
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(1)
    })

    it('counts each successful retrieve once even when its meta arrives late', () => {
      const workspace = buildSourceWorkspace([
        block(
          'r1',
          1,
          'zotero_retrieve',
          { ref: REF('A1') },
          { meta: { count: 1, items: null, truncated: false } },
        ),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          { meta: { count: 1, items: null, truncated: false } },
        ),
      ])
      expect(workspace.sources[0]!.retrievalSummary?.runCount).toBe(2)
    })

    it('keeps retrievalSummary off an item with no successful retrieve', () => {
      const workspace = buildSourceWorkspace([
        block('g1', 1, 'zotero_get', { ref: REF('A1') }, { meta: GET_META }),
      ])
      expect(workspace.sources[0]!.retrievalSummary).toBeUndefined()
    })

    it('deduplicates verbatim evidence and keeps every call id', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
        block('r2', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      ])
      expect(workspace.sources).toHaveLength(1)
      expect(workspace.sources[0]!.evidence).toHaveLength(1)
      expect(workspace.sources[0]!.evidence[0]!.callIds).toEqual(['r1', 'r2'])
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(1)
    })

    it('decodes meta without the availability facts', () => {
      const workspace = buildSourceWorkspace([
        block(
          's1',
          1,
          'zotero_search',
          { query: 'attention' },
          {
            meta: {
              returned: 1,
              total: 1,
              nextOffset: null,
              displayed: 1,
              omitted: 0,
              noteMatches: null,
              items: [
                {
                  ref: REF('A1'),
                  title: 'Paper A1',
                  creatorSummary: 'Creator',
                  year: 2020,
                  itemType: 'journalArticle',
                },
              ],
            },
          },
        ),
        block(
          'r1',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 2,
              sources: ['annotation', 'fulltext'],
              truncated: false,
              sourcesSkipped: ['note'],
              items: [
                {
                  source: 'annotation',
                  sourceRef: 'zotero://user/0/annotation/ANN1',
                  preview: 'a',
                  previewTruncated: false,
                },
                {
                  source: 'fulltext',
                  sourceRef: REF('A1'),
                  preview: 'b',
                  previewTruncated: false,
                },
              ],
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(2)
      expect(workspace.sources[0]!.retrievalFacts?.sourceAvailability).toEqual({})
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toBeUndefined()
    })

    it('ignores a retrieve whose items are malformed', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: { items: 'x' } }),
      ])
      expect(workspace.sources[0]!.retrievalFacts).toBeUndefined()
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(0)
    })

    it('lets the latest retrieve facts win', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 0,
              sources: [],
              truncated: true,
              sourcesSkipped: ['fulltext'],
              items: [],
              sourceAvailability: {
                fulltext: { requested: true, returnedPassages: 0, unavailable: true },
              },
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.retrievalFacts?.truncated).toBe(true)
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
        indexedPages: 5,
        totalPages: 10,
        complete: false,
      })
    })

    it('keeps the attachment content type paired with the ref it described', () => {
      const withType = { ...RETRIEVE_META, attachmentContentType: 'application/pdf' }
      const firstMeet = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
      ])
      expect(firstMeet.sources[0]!.retrievalFacts?.attachmentContentType).toBe('application/pdf')

      const replaced = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          { meta: { ...withType, attachmentContentType: 'text/plain' } },
        ),
      ])
      expect(replaced.sources[0]!.retrievalFacts?.attachmentContentType).toBe('text/plain')

      // A ref-less follow-up preserves the pair it already carries.
      const preserved = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 0,
              sources: [],
              truncated: false,
              sourcesSkipped: [],
              items: [],
              sourceAvailability: {},
            },
          },
        ),
      ])
      expect(preserved.sources[0]!.retrievalFacts?.attachmentContentType).toBe('application/pdf')

      // A new ref without a type drops the stale pair: the deep link and its
      // type always describe the same retrieve.
      const dropped = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: withType }),
        block('r2', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      ])
      expect(dropped.sources[0]!.retrievalFacts?.attachmentContentType).toBeUndefined()
    })

    it('preserves previous coverage and attachmentRef when the next retrieve carries none', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 0,
              sources: [],
              truncated: false,
              sourcesSkipped: [],
              items: [],
              sourceAvailability: {},
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
        indexedPages: 5,
        totalPages: 10,
        complete: false,
      })
      expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
        'zotero://user/0/attachment/WXYZ6789',
      )
    })

    it('adopts later attachmentRef and coverage when earlier retrieve had none', () => {
      const workspace = buildSourceWorkspace([
        block(
          'r1',
          1,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 0,
              sources: [],
              truncated: false,
              sourcesSkipped: [],
              items: [],
              sourceAvailability: {},
            },
          },
        ),
        block('r2', 2, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
      ])
      expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
        'zotero://user/0/attachment/WXYZ6789',
      )
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
        indexedPages: 5,
        totalPages: 10,
        complete: false,
      })
    })

    it('treats retrieve count as optional and does not invent reportedEvidenceCount when absent', () => {
      const workspace = buildSourceWorkspace([
        block(
          'r1',
          1,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              sources: ['fulltext'],
              truncated: false,
              sourcesSkipped: [],
              items: [
                {
                  source: 'fulltext',
                  sourceRef: REF('A1'),
                  preview: 'body',
                  previewTruncated: false,
                },
              ],
              sourceAvailability: {},
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.facts.reportedEvidenceCount).toBe(0)
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(1)
    })

    it('leaves attachmentRef and coverage unset when no retrieve provides them', () => {
      const workspace = buildSourceWorkspace([
        block(
          'r1',
          1,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 0,
              sources: [],
              truncated: false,
              sourcesSkipped: [],
              items: [],
              sourceAvailability: {},
            },
          },
        ),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 0,
              sources: [],
              truncated: false,
              sourcesSkipped: [],
              items: [],
              sourceAvailability: {},
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBeUndefined()
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toBeUndefined()
    })

    it('records retrieval facts when the byte budget dropped the items preview', () => {
      const workspace = buildSourceWorkspace([
        block(
          'r1',
          1,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 25,
              sources: ['fulltext'],
              truncated: true,
              sourcesSkipped: [],
              detailOmitted: true,
              attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
              sourceAvailability: {
                fulltext: { requested: true, returnedPassages: 25, unavailable: false },
              },
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.retrievalFacts).toBeDefined()
      expect(workspace.sources[0]!.retrievalFacts?.truncated).toBe(true)
      expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
        'zotero://user/0/attachment/WXYZ6789',
      )
      expect(workspace.sources[0]!.facts.reportedEvidenceCount).toBe(25)
      expect(workspace.sources[0]!.facts.evidenceCount).toBe(0)
    })

    it('adopts the latest attachmentRef and pairs it with the latest coverage', () => {
      const workspace = buildSourceWorkspace([
        block('r1', 1, 'zotero_retrieve', { ref: REF('A1') }, { meta: RETRIEVE_META }),
        block(
          'r2',
          2,
          'zotero_retrieve',
          { ref: REF('A1') },
          {
            meta: {
              count: 1,
              sources: ['fulltext'],
              truncated: false,
              sourcesSkipped: [],
              items: [],
              attachmentRef: 'zotero://user/0/attachment/OTHER99',
              coverage: { indexedPages: 9, totalPages: 9, complete: true },
              sourceAvailability: {},
            },
          },
        ),
      ])
      expect(workspace.sources[0]!.retrievalFacts?.attachmentRef).toBe(
        'zotero://user/0/attachment/OTHER99',
      )
      expect(workspace.sources[0]!.retrievalFacts?.coverage).toEqual({
        indexedPages: 9,
        totalPages: 9,
        complete: true,
      })
    })
  })
})
