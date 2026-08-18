/**
 * Card-sized presentation projections: logical caps per tool, provenance
 * honesty (fulltext never gains a page locator), the UTF-8 byte budget with
 * multibyte boundaries, and the detail-dropping overflow behavior.
 * @module tests/presentation-meta
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroSearchResult } from '../src/types.js'
import {
  MAX_PRESENTATION_EVIDENCE_CHARS,
  MAX_PRESENTATION_GET_VENUE_CHARS,
  MAX_PRESENTATION_META_BYTES,
  MAX_PRESENTATION_SEARCH_ROWS,
  MAX_PRESENTATION_SEARCH_ROWS_BYTES,
  boundedPresentationMeta,
  presentationMetaBytes,
  projectAttachmentMeta,
  projectExportMeta,
  projectGetMeta,
  projectRetrieveMeta,
  projectSearchMeta,
} from '../src/presentation-meta.js'

function searchResult(rows: number): ZoteroSearchResult {
  return {
    scope: { kind: 'library' },
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
    const meta = projectSearchMeta({ ...searchResult(2), nextOffset: 20 } as ZoteroSearchResult)
    expect(meta.nextOffset).toBe(20)
    expect(meta.items.map((item) => item.ref)).toEqual([
      'zotero://user/0/item/ABCDEFG0',
      'zotero://user/0/item/ABCDEFG1',
    ])
    expect(projectSearchMeta(searchResult(0)).nextOffset).toBeNull()
  })

  it('passes the merged note count through and defaults it to null', () => {
    expect(
      projectSearchMeta({ ...searchResult(1), noteMatches: 3 } as ZoteroSearchResult).noteMatches,
    ).toBe(3)
    expect(projectSearchMeta(searchResult(0)).noteMatches).toBeNull()
  })

  it('truncates long titles and creator summaries', () => {
    const meta = projectSearchMeta({
      scope: { kind: 'library' },
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

describe('projectGetMeta', () => {
  it('projects the header line, counts, and bounded child previews', () => {
    const meta = projectGetMeta({
      ref: 'zotero://user/0/item/ABCDEFGH',
      itemType: 'journalArticle',
      title: 'FlashAttention-2',
      creators: ['Dao, Tri', 'Smith, Jane'],
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
    })
    expect(meta.title).toBe('FlashAttention-2')
    expect(meta.creators).toBe('Dao, Tri; Smith, Jane')
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

  it('omits child facts the call did not request', () => {
    const meta = projectGetMeta({
      ref: 'zotero://user/0/item/ABCDEFGH',
      title: 'Metadata only',
      creators: [],
      abstract: undefined,
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
    })
    expect(meta.notes).toBeUndefined()
    expect(meta.annotations).toBeUndefined()
    expect(meta.itemType).toBeUndefined()
    expect(meta.ref).toBe('zotero://user/0/item/ABCDEFGH')
    expect(meta.bestAttachment).toBeUndefined()
    expect(meta.notesPreview).toEqual([])
    expect(meta.annotationsPreview).toEqual([])
  })

  it('keeps the attachment selection content type when its ref is absent', () => {
    const meta = projectGetMeta({
      ref: 'zotero://user/0/item/ABCDEFGH',
      title: 'T',
      creators: [],
      abstract: undefined,
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      bestAttachment: { contentType: 'application/pdf' },
    })
    expect(meta.bestAttachment).toEqual({ contentType: 'application/pdf' })
  })

  it('omits the ref when the input carries none', () => {
    const meta = projectGetMeta({
      title: 'T',
      creators: [],
      abstract: undefined,
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
    })
    expect(meta.ref).toBeUndefined()
  })

  it('caps the venue string like the other header fields', () => {
    const meta = projectGetMeta({
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
    })
    expect(meta.venue).toHaveLength(MAX_PRESENTATION_GET_VENUE_CHARS)
  })
})

describe('projectRetrieveMeta', () => {
  it('projects ranked evidence with provenance and source kinds', () => {
    const meta = projectRetrieveMeta(
      {
        evidence: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN000001',
            text: 'highlighted claim',
            pageLabel: '7',
            attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
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
      },
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
      pageLabel: '7',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
    })
    // Fulltext passages never gain an invented page locator.
    expect(meta.items[2]!.pageLabel).toBeUndefined()
  })

  it('records per-source availability from the requested list', () => {
    const meta = projectRetrieveMeta(
      {
        evidence: [
          { source: 'annotation', sourceRef: 'zotero://user/0/annotation/ANN1', text: 'a' },
          { source: 'fulltext', sourceRef: 'zotero://user/0/item/ABCDEFGH', text: 'b' },
        ],
        truncated: false,
        sourcesSkipped: ['note'],
      },
      ['annotation', 'note'],
    )
    expect(meta.sourceAvailability).toEqual({
      annotation: { requested: true, returnedPassages: 1, unavailable: false },
      note: { requested: true, returnedPassages: 0, unavailable: true },
    })
  })

  it('passes the attachment ref and coverage through when the result carries them', () => {
    const meta = projectRetrieveMeta(
      {
        evidence: [],
        truncated: false,
        sourcesSkipped: [],
        attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
        coverage: { indexedPages: 5, totalPages: 10, complete: false },
      },
      ['fulltext'],
    )
    expect(meta.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(meta.coverage).toEqual({ indexedPages: 5, totalPages: 10, complete: false })
  })

  it('caps passages and previews, marking preview truncation', () => {
    const meta = projectRetrieveMeta(
      {
        evidence: Array.from({ length: 6 }, (_, index) => ({
          source: 'fulltext',
          sourceRef: 'zotero://user/0/item/ABCDEFGH',
          text: `chunk ${index} ${'x'.repeat(MAX_PRESENTATION_EVIDENCE_CHARS + 10)}`,
        })),
        truncated: false,
        sourcesSkipped: [],
      },
      ['fulltext'],
    )
    expect(meta.items).toHaveLength(4)
    expect(meta.items[0]!.preview).toHaveLength(MAX_PRESENTATION_EVIDENCE_CHARS)
    expect(meta.items[0]!.previewTruncated).toBe(true)
  })
})

describe('projectAttachmentMeta', () => {
  it('projects the file arm with its copyable path', () => {
    expect(
      projectAttachmentMeta({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'FlashAttention-2.pdf',
        contentType: 'application/pdf',
        kind: 'file',
        path: '/Users/xu/Zotero/storage/ABCD1234/FlashAttention-2.pdf',
      }),
    ).toEqual({
      kind: 'file',
      title: 'FlashAttention-2.pdf',
      contentType: 'application/pdf',
      ref: 'zotero://user/0/attachment/WXYZ6789',
      path: '/Users/xu/Zotero/storage/ABCD1234/FlashAttention-2.pdf',
    })
  })

  it('projects the linked-url arm', () => {
    expect(
      projectAttachmentMeta({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'paper page',
        contentType: 'text/html',
        kind: 'url',
        url: 'https://example.org/paper',
      }),
    ).toEqual({
      kind: 'url',
      title: 'paper page',
      contentType: 'text/html',
      ref: 'zotero://user/0/attachment/WXYZ6789',
      url: 'https://example.org/paper',
    })
  })

  it('omits the attachment ref when the input carries none', () => {
    expect(
      projectAttachmentMeta({
        kind: 'file',
        title: 'a.pdf',
        contentType: 'application/pdf',
        path: '/tmp/a.pdf',
      }),
    ).toEqual({
      kind: 'file',
      title: 'a.pdf',
      contentType: 'application/pdf',
      path: '/tmp/a.pdf',
    })
    expect(
      projectAttachmentMeta({
        kind: 'url',
        title: 'p',
        contentType: 'text/html',
        url: 'https://e.org',
      }),
    ).toEqual({
      kind: 'url',
      title: 'p',
      contentType: 'text/html',
      url: 'https://e.org',
    })
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
      3,
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
    expect(projectExportMeta(2, { format: 'citation' }, ['zotero://user/0/item/AAAAAAA1'])).toEqual(
      {
        format: 'citation',
        requested: 2,
        count: 0,
        refs: ['zotero://user/0/item/AAAAAAA1'],
        refsOmitted: 0,
      },
    )
  })

  it('reports only the requested count for the opaque text formats', () => {
    expect(projectExportMeta(12, { format: 'bibtex', text: 'raw' }, REFS)).toEqual({
      format: 'bibtex',
      requested: 12,
      refs: REFS,
      refsOmitted: 0,
    })
  })

  it('bounds the itemized refs and counts the rest', () => {
    const refs = Array.from({ length: 25 }, (_, index) => `zotero://user/0/item/ITEM${index}`)
    const meta = projectExportMeta(25, { format: 'bibtex', text: 'raw' }, refs)
    expect(meta.refs).toHaveLength(20)
    expect(meta.refsOmitted).toBe(5)
    expect(meta.refs[0]).toBe('zotero://user/0/item/ITEM0')
  })

  it('itemizes the per-document facts with their located entry', () => {
    const meta = projectExportMeta(
      3,
      {
        format: 'bibtex',
        text: 'raw',
        items: [
          { ref: 'zotero://user/0/item/AAAAAAA1', key: 'a1', title: 'A', start: 0, end: 11 },
          { ref: 'zotero://user/0/item/AAAAAAA2', key: 'a2', entryIndex: 1 },
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
        { ref: 'zotero://user/0/item/AAAAAAA1', key: 'a1', title: 'A', start: 0, end: 11 },
        { ref: 'zotero://user/0/item/AAAAAAA2', key: 'a2', entryIndex: 1 },
        { ref: 'zotero://user/0/item/AAAAAAA3' },
      ],
    })
  })

  it('bounds the per-document items to the same ref bound', () => {
    const refs = Array.from({ length: 25 }, (_, index) => `zotero://user/0/item/ITEM${index}`)
    const meta = projectExportMeta(
      25,
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
    expect(projectExportMeta(2, { format: 'bibliography', text: 'x' }, REFS)).toEqual({
      format: 'bibliography',
      requested: 2,
      refs: REFS,
      refsOmitted: 0,
    })
  })
})

describe('boundedPresentationMeta', () => {
  it('passes non-object inputs through untouched', () => {
    expect(boundedPresentationMeta(null, ['items'])).toBeNull()
    expect(boundedPresentationMeta('plain', ['items'])).toBe('plain')
    expect(boundedPresentationMeta([1], ['items'])).toEqual([1])
  })

  it('keeps a projection inside the byte budget unchanged', () => {
    const meta = { count: 1, items: [] }
    expect(boundedPresentationMeta(meta, ['items'])).toEqual(meta)
  })

  it('measures UTF-8 bytes, not code units', () => {
    // 3000 中文字符 = 9000 UTF-8 bytes but only 3000 code units.
    const meta = { count: 1, items: [{ preview: '批'.repeat(3000) }] }
    expect(presentationMetaBytes(meta)).toBeGreaterThan(MAX_PRESENTATION_META_BYTES)
  })

  it('drops exactly the detail keys on overflow and records detailOmitted', () => {
    const filler = 'x'.repeat(MAX_PRESENTATION_META_BYTES)
    const meta = {
      count: 3,
      title: 'kept',
      items: [{ preview: filler }],
      notesPreview: [{ preview: filler }],
    }
    const bounded = boundedPresentationMeta(meta, ['items', 'notesPreview'])
    expect(bounded).toEqual({ detailOmitted: true, count: 3, title: 'kept' })
  })

  it('drops the export items and refs wholesale when the projection overflows', () => {
    const filler = 'x'.repeat(MAX_PRESENTATION_META_BYTES)
    const meta = projectExportMeta(
      2,
      {
        format: 'bibtex',
        text: 'raw',
        items: [{ ref: 'zotero://user/0/item/AAAAAAA1', key: 'a1', title: filler, start: 0 }],
      },
      ['zotero://user/0/item/AAAAAAA1'],
    )
    const bounded = boundedPresentationMeta(meta, ['refs', 'items'])
    expect(bounded).toEqual({ detailOmitted: true, format: 'bibtex', requested: 2, refsOmitted: 0 })
  })

  it('honors the byte budget at the exact boundary', () => {
    // Size the payload against the measured envelope so the fit is exact.
    const envelope = Buffer.byteLength(JSON.stringify({ count: 1, title: '' }), 'utf8')
    const slack = MAX_PRESENTATION_META_BYTES - envelope
    const exact = { count: 1, title: 't'.repeat(slack) }
    expect(presentationMetaBytes(exact)).toBe(MAX_PRESENTATION_META_BYTES)
    expect(boundedPresentationMeta(exact, [])).toEqual(exact)
    const over = { count: 1, title: 't'.repeat(slack + 1) }
    // No detail keys were declared, so the overflow keeps every fact and only records the flag.
    expect(boundedPresentationMeta(over, [])).toEqual({ detailOmitted: true, ...over })
  })
})
