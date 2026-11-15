/**
 * Card-sized presentation projections: logical caps per tool and provenance
 * honesty (fulltext never gains a page locator). The shared UTF-8 byte budget
 * they all pass through has its own spec
 * (`tests/unit/presentation-budget.spec.ts`).
 * @module tests/presentation-meta
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroItemDetail } from '../../src/types.js'
import type { SearchProjectionInput } from '../../src/presentation-meta.js'
import {
  MAX_PRESENTATION_GET_VENUE_CHARS,
  MAX_PRESENTATION_SEARCH_ROWS,
  MAX_PRESENTATION_SEARCH_ROWS_BYTES,
  projectExportMeta,
  projectGetBatchMeta,
  projectMatchReferencesMeta,
  projectGetMeta,
  projectSearchMeta,
} from '../../src/presentation-meta.js'
import type { ZoteroGetBatchResult, ZoteroMatchReferencesResult } from '../../src/types.js'

function searchResult(rows: number): SearchProjectionInput {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items: Array.from({ length: rows }, (_, index) => ({
      ref: `zotero://user/0/item/ABCDEFG${index % 10}`,
      title: `Paper ${index}`,
      creatorSummary: `Creator ${index}`,
      year: 2020 + index,
      itemType: 'journalArticle',
    })),
    total: 42,
    offset: 0,
    returned: rows,
  }
}

/** A full item detail with every required field; tests spread overrides. */
function getDetail(overrides: Partial<ZoteroItemDetail> = {}): ZoteroItemDetail {
  return {
    ref: 'zotero://user/0/item/ABCDEFGH',
    itemType: 'journalArticle',
    title: 'T',
    creators: [],
    abstractTruncated: false,
    tags: [],
    collections: [],
    children: { total: 0 },
    ...overrides,
  }
}

describe('projectSearchMeta', () => {
  it('projects a normal page whole and reports honest omission counts', () => {
    const meta = projectSearchMeta(searchResult(10))
    expect(meta.items).toHaveLength(10)
    expect(meta.displayed).toBe(10)
    expect(meta.omitted).toBe(0)
    expect(meta.returned).toBe(10)
    expect(meta.total).toBe(42)
    expect(meta.items[0]).toEqual({
      ref: 'zotero://user/0/item/ABCDEFG0',
      title: 'Paper 0',
      creatorSummary: 'Creator 0',
      year: 2020,
      itemType: 'journalArticle',
    })
    expect(meta.library).toEqual({ type: 'user', id: 0 })
  })

  it('omits the library badge instead of mislabeling an unresolvable scope', () => {
    const base = searchResult(1)
    const unsupported = projectSearchMeta({
      ...base,
      scope: {
        kind: 'collection',
        ref: 'zotero://user/5/collection/COLL0001',
        name: 'Nowhere',
      },
    })
    expect(unsupported.library).toBeUndefined()
    const unparseable = projectSearchMeta({
      ...base,
      scope: { kind: 'collection', ref: 'not a ref', name: 'Nowhere' },
    })
    expect(unparseable.library).toBeUndefined()
    const group = projectSearchMeta({
      ...base,
      scope: {
        kind: 'collection',
        ref: 'zotero://group/42/collection/COLL0001',
        name: 'Group',
      },
    })
    expect(group.library).toEqual({ type: 'group', id: 42 })
  })

  it('caps the projected rows at the logical limit for huge pages', () => {
    const meta = projectSearchMeta(searchResult(30))
    expect(meta.items).toHaveLength(MAX_PRESENTATION_SEARCH_ROWS)
    expect(meta.displayed).toBe(MAX_PRESENTATION_SEARCH_ROWS)
    expect(meta.omitted).toBe(10)
  })

  it('bounds heavy rows by the byte allowance without dropping the page', () => {
    const heavy = Array.from({ length: 30 }, (_, index) => ({
      ref: `zotero://user/0/item/ABCDEFG${index}`,
      title: '题'.repeat(120),
      creatorSummary: '作'.repeat(60),
      year: 2020 + index,
      itemType: 'journalArticle',
    }))
    const meta = projectSearchMeta({ ...searchResult(0), items: heavy, returned: 30 })
    expect(meta.items.length).toBeGreaterThan(0)
    expect(meta.items.length).toBeLessThan(30)
    expect(meta.omitted).toBe(30 - meta.items.length)
    const bytes = meta.items.reduce(
      (sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'),
      0,
    )
    expect(bytes).toBeLessThanOrEqual(MAX_PRESENTATION_SEARCH_ROWS_BYTES)
  })

  it('keeps the copyable ref on every row and normalizes the page marker', () => {
    const meta = projectSearchMeta({ ...searchResult(2), nextOffset: 20 })
    expect(meta.nextOffset).toBe(20)
    expect(meta.items.map((item) => item.ref)).toEqual([
      'zotero://user/0/item/ABCDEFG0',
      'zotero://user/0/item/ABCDEFG1',
    ])
    expect(projectSearchMeta(searchResult(0)).nextOffset).toBeNull()
  })

  it('appends supplemental note rows to the bounded list and reports their count', () => {
    const noteRow = {
      ref: 'zotero://user/0/item/NOTE1111',
      title: 'note',
      creatorSummary: '',
      itemType: 'note',
    }
    const meta = projectSearchMeta({
      ...searchResult(1),
      supplemental: {
        kind: 'noteBody',
        items: [noteRow, noteRow],
        scanned: 2,
        truncated: false,
      },
    })
    expect(meta.noteMatches).toBe(2)
    expect(meta.items).toHaveLength(3)
    expect(meta.omitted).toBe(0)
    expect(projectSearchMeta(searchResult(0)).noteMatches).toBeNull()
  })

  it('truncates long titles and creator summaries', () => {
    const meta = projectSearchMeta({
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      items: [
        {
          ref: 'zotero://user/0/item/ABCDEFGH',
          title: 't'.repeat(500),
          creatorSummary: 'c'.repeat(500),
          year: 2020,
          itemType: 'journalArticle',
        },
      ],
      total: 1,
      offset: 0,
      returned: 1,
    })
    expect(meta.items[0]!.title).toHaveLength(120)
    expect(meta.items[0]!.creatorSummary).toHaveLength(60)
  })

  it('carries the attachment selection on rows that have one', () => {
    const meta = projectSearchMeta({
      ...searchResult(2),
      items: [
        {
          ref: 'zotero://user/0/item/ABCDEFG0',
          title: 'Paper 0',
          creatorSummary: 'Creator 0',
          year: 2020,
          itemType: 'journalArticle',
          bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
        },
        {
          ref: 'zotero://user/0/item/ABCDEFG1',
          title: 'Paper 1',
          creatorSummary: 'Creator 1',
          year: 2021,
          itemType: 'journalArticle',
        },
      ],
    })
    expect(meta.items[0]!.bestAttachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(meta.items[1]!.bestAttachmentRef).toBeUndefined()
  })
})

describe('batch and match projections', () => {
  it('keeps every batch outcome in compact metadata while bounding detail rows', () => {
    const serverId = 'S'.repeat(64)
    const value: ZoteroGetBatchResult = {
      items: Array.from({ length: 50 }, (_, index) => ({
        ref: `zotero://user/0/item/${String(index).padStart(8, '0')}?server=${serverId}`,
        status: 'ok' as const,
        item: getDetail({
          title: `Paper ${index}`.padEnd(200, 'x'),
          citationKey: 'k'.repeat(500),
        }),
      })),
      counts: { requested: 50, succeeded: 50, failed: 0 },
    }
    const meta = projectGetBatchMeta(value) as Record<string, unknown>
    expect(meta['statuses']).toEqual(Array.from({ length: 50 }, () => 'ok'))
    expect(meta['items']).toBeUndefined()
    expect(meta['detailOmitted']).toBe(true)
    expect(meta['omitted']).toBe(30)
  })

  it('keeps the complete matched count when match rows are bounded', () => {
    const value: ZoteroMatchReferencesResult = {
      items: Array.from({ length: 25 }, (_, index) => ({
        inputId: `ref-${index}`,
        status: index < 23 ? ('matched' as const) : ('notFound' as const),
      })),
    }
    const meta = projectMatchReferencesMeta(value) as Record<string, unknown>
    expect(meta['requested']).toBe(25)
    expect(meta['matched']).toBe(23)
    expect(meta['items']).toHaveLength(20)
  })
})

describe('projectGetMeta', () => {
  it('projects the header line, counts, and bounded child previews', () => {
    const meta = projectGetMeta(
      getDetail({
        ref: 'zotero://user/0/item/ABCDEFGH',
        itemType: 'journalArticle',
        title: 'FlashAttention-2',
        creators: [
          { creatorType: 'author', lastName: 'Dao', firstName: 'Tri' },
          { creatorType: 'author', lastName: 'Smith', firstName: 'Jane' },
        ],
        date: '2023-07-28',
        year: 2023,
        venue: 'ICLR',
        abstract: undefined,
        abstractTruncated: false,
        tags: [],
        collections: [],
        children: { total: 20 },
        bestAttachment: {
          ref: 'zotero://user/0/attachment/WXYZ6789',
          title: 'a.pdf',
          contentType: 'application/pdf',
        },
        attachments: {
          total: 1,
          returned: 1,
          items: [
            {
              ref: 'zotero://user/0/attachment/WXYZ6789',
              title: 'a.pdf',
              contentType: 'application/pdf',
            },
          ],
        },
        notes: {
          total: 2,
          returned: 2,
          items: [
            { ref: 'zotero://user/0/item/NOTE0001', text: 'note one', truncated: false },
            { ref: 'zotero://user/0/item/NOTE0002', text: 'note two', truncated: false },
          ],
        },
        annotations: {
          total: 17,
          returned: 3,
          items: [
            {
              ref: 'zotero://user/0/annotation/ANN000001',
              type: 'highlight',
              text: 'a'.repeat(500),
              color: '#ffd400',
              pageLabel: '7',
            },
            {
              ref: 'zotero://user/0/annotation/ANN000002',
              type: 'note',
              text: 'annotation two',
              color: '#ffd400',
            },
          ],
        },
      }),
    )
    expect(meta.title).toBe('FlashAttention-2')
    expect(meta.creators).toBe('Tri Dao; Jane Smith')
    expect(meta.year).toBe(2023)
    expect(meta.itemType).toBe('journalArticle')
    expect(meta.venue).toBe('ICLR')
    expect(meta.ref).toBe('zotero://user/0/item/ABCDEFGH')
    expect(meta.notes).toEqual({ total: 2, returned: 2 })
    expect(meta.annotations).toEqual({ total: 17, returned: 3 })
    expect(meta.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      contentType: 'application/pdf',
    })
    expect(meta.attachments).toEqual({ total: 1, returned: 1 })
    expect(meta.notesPreview).toHaveLength(2)
    expect(meta.notesPreview[0]).toEqual({
      ref: 'zotero://user/0/item/NOTE0001',
      preview: 'note one',
    })
    expect(meta.annotationsPreview).toHaveLength(2)
    expect(meta.annotationsPreview[0]!.preview).toHaveLength(200)
    expect(meta.annotationsPreview[0]!.pageLabel).toBe('7')
    expect(meta.annotationsPreview[1]!.pageLabel).toBeUndefined()
  })

  it("keeps a child page's paging facts so a partial slice never reads as complete", () => {
    const meta = projectGetMeta(
      getDetail({
        notes: {
          completeness: 'page',
          total: 120,
          returned: 50,
          offset: 50,
          limit: 50,
          nextOffset: 100,
          items: [],
        },
      }),
    )
    expect(meta.notes).toEqual({
      completeness: 'page',
      total: 120,
      returned: 50,
      offset: 50,
      limit: 50,
      nextOffset: 100,
    })
  })

  it('omits child facts the call did not request', () => {
    const meta = projectGetMeta(
      getDetail({
        ref: 'zotero://user/0/item/ABCDEFGH',
        title: 'Metadata only',
        creators: [],
        abstract: undefined,
        abstractTruncated: false,
        tags: [],
        collections: [],
        children: { total: 0 },
      }),
    )
    expect(meta.notes).toBeUndefined()
    expect(meta.annotations).toBeUndefined()
    expect(meta.ref).toBe('zotero://user/0/item/ABCDEFGH')
    expect(meta.bestAttachment).toBeUndefined()
    expect(meta.notesPreview).toEqual([])
    expect(meta.annotationsPreview).toEqual([])
  })

  it('passes the attachment selection through with its content type', () => {
    const meta = projectGetMeta(
      getDetail({
        ref: 'zotero://user/0/item/ABCDEFGH',
        title: 'T',
        creators: [],
        abstract: undefined,
        abstractTruncated: false,
        tags: [],
        collections: [],
        children: { total: 0 },
        bestAttachment: {
          ref: 'zotero://user/0/attachment/WXYZ6789',
          title: 'PDF',
          contentType: 'application/pdf',
        },
      }),
    )
    expect(meta.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      contentType: 'application/pdf',
    })
  })

  it('caps the venue string like the other header fields', () => {
    const meta = projectGetMeta(
      getDetail({
        ref: 'zotero://user/0/item/ABCDEFGH',
        itemType: 'journalArticle',
        title: 'T',
        creators: [],
        venue: 'v'.repeat(500),
        abstract: undefined,
        abstractTruncated: false,
        tags: [],
        collections: [],
        children: { total: 0 },
      }),
    )
    expect(meta.venue).toHaveLength(MAX_PRESENTATION_GET_VENUE_CHARS)
  })
})

describe('projectExportMeta', () => {
  const REFS = [
    'zotero://user/0/item/AAAAAAA1',
    'zotero://user/0/item/AAAAAAA2',
    'zotero://user/0/item/AAAAAAA3',
  ]

  it('counts the actually exported citations for the citation arm', () => {
    const meta = projectExportMeta(
      {
        format: 'citation',
        style: 'apa',
        locale: 'en-US',
        citations: [
          { ref: 'zotero://user/0/item/AAAAAAA1', text: 'A' },
          { ref: 'zotero://user/0/item/AAAAAAA2', text: 'B' },
          { ref: 'zotero://user/0/item/AAAAAAA3', text: 'C' },
        ],
      },
      REFS,
    )
    expect(meta).toEqual({
      format: 'citation',
      requested: 3,
      count: 3,
      style: 'apa',
      locale: 'en-US',
      refs: REFS,
      refsOmitted: 0,
    })
  })

  it('counts zero when the citation arm carries no citations', () => {
    expect(projectExportMeta({ format: 'citation' }, ['zotero://user/0/item/AAAAAAA1'])).toEqual({
      format: 'citation',
      requested: 1,
      count: 0,
      refs: ['zotero://user/0/item/AAAAAAA1'],
      refsOmitted: 0,
    })
  })

  it('reports only the requested count for the opaque text formats', () => {
    expect(projectExportMeta({ format: 'bibtex', text: 'raw' }, REFS)).toEqual({
      format: 'bibtex',
      requested: 3,
      refs: REFS,
      refsOmitted: 0,
    })
  })

  it('bounds the itemized refs and counts the rest', () => {
    const refs = Array.from({ length: 25 }, (_, index) => `zotero://user/0/item/ITEM${index}`)
    const meta = projectExportMeta({ format: 'bibtex', text: 'raw' }, refs)
    expect(meta.refs).toHaveLength(20)
    expect(meta.refsOmitted).toBe(5)
    expect(meta.refs[0]).toBe('zotero://user/0/item/ITEM0')
  })

  it('itemizes the per-document facts with their located entry', () => {
    const meta = projectExportMeta(
      {
        format: 'bibtex',
        text: 'raw',
        items: [
          { ref: 'zotero://user/0/item/AAAAAAA1', exportKey: 'a1', title: 'A', start: 0, end: 11 },
          { ref: 'zotero://user/0/item/AAAAAAA2', exportKey: 'a2', entryIndex: 1 },
          { ref: 'zotero://user/0/item/AAAAAAA3' },
        ],
      },
      REFS,
    )
    expect(meta).toEqual({
      format: 'bibtex',
      requested: 3,
      refs: REFS,
      refsOmitted: 0,
      items: [
        { ref: 'zotero://user/0/item/AAAAAAA1', exportKey: 'a1', title: 'A', start: 0, end: 11 },
        { ref: 'zotero://user/0/item/AAAAAAA2', exportKey: 'a2', entryIndex: 1 },
        { ref: 'zotero://user/0/item/AAAAAAA3' },
      ],
    })
  })

  it('omits absent citation-key conflict metadata', () => {
    const meta = projectExportMeta(
      {
        format: 'bibtex',
        text: 'raw',
        items: [{ ref: 'zotero://user/0/item/AAAAAAA1', citationKey: 'nativeKey' }],
      },
      ['zotero://user/0/item/AAAAAAA1'],
    )
    expect(meta.items).toEqual([{ ref: 'zotero://user/0/item/AAAAAAA1', citationKey: 'nativeKey' }])
  })

  it('preserves citation-key conflict metadata for review', () => {
    const meta = projectExportMeta(
      {
        format: 'bibtex',
        text: 'raw',
        items: [
          {
            ref: 'zotero://user/0/item/AAAAAAA1',
            citationKey: 'nativeKey',
            citationKeyConflict: { native: 'nativeKey', extra: 'legacyKey' },
          },
        ],
      },
      ['zotero://user/0/item/AAAAAAA1'],
    )
    expect(meta.items).toEqual([
      {
        ref: 'zotero://user/0/item/AAAAAAA1',
        citationKey: 'nativeKey',
        citationKeyConflict: { native: 'nativeKey', extra: 'legacyKey' },
      },
    ])
  })

  it('bounds the per-document items to the same ref bound', () => {
    const refs = Array.from({ length: 25 }, (_, index) => `zotero://user/0/item/ITEM${index}`)
    const meta = projectExportMeta(
      {
        format: 'ris',
        text: 'raw',
        items: refs.map((ref, index) => ({ ref, start: index, end: index + 1 })),
      },
      refs,
    )
    expect(meta.items).toHaveLength(20)
    expect(meta.items![19]).toEqual({ ref: 'zotero://user/0/item/ITEM19', start: 19, end: 20 })
    expect(meta.refsOmitted).toBe(5)
  })

  it('omits the items for exports without per-document data', () => {
    expect(projectExportMeta({ format: 'bibliography', text: 'x' }, REFS)).toEqual({
      format: 'bibliography',
      requested: 3,
      refs: REFS,
      refsOmitted: 0,
    })
  })
})
