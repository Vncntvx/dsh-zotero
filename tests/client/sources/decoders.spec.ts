/**
 * The meta decoding layer: presentation projections decoded defensively,
 * absent or malformed fields degrade instead of crashing.
 * @module tests/client/sources/decoders
 */

import { describe, expect, it } from 'vitest'
import {
  attachmentMetaOf,
  exportMetaOf,
  getMetaOf,
  retrieveMetaOf,
  searchMetaOf,
} from '../../../src/client/sources/decoders.ts'

describe('searchMetaOf', () => {
  const ROW = {
    ref: 'zotero://user/0/item/ABCDEFGH',
    title: 'Paper',
    creatorSummary: 'Creator',
    year: 2020,
  }

  it('decodes valid rows and the omission count', () => {
    const meta = searchMetaOf({
      returned: 3,
      total: 42,
      displayed: 3,
      omitted: 0,
      noteMatches: 1,
      items: [
        ROW,
        {
          ...ROW,
          bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
          bestAttachmentType: 'application/pdf',
        },
      ],
    })
    expect(meta.omitted).toBe(0)
    expect(meta.rows).toEqual([
      ROW,
      {
        ...ROW,
        bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
        bestAttachmentType: 'application/pdf',
      },
    ])
  })

  it('degrades malformed rows to null and absent facts to null', () => {
    const meta = searchMetaOf({ items: [{ ref: 'x' }] })
    expect(meta.rows).toBeNull()
    expect(meta.omitted).toBeNull()
  })

  it('degrades a non-record row to null and omits an absent year', () => {
    expect(searchMetaOf({ items: ['x'] }).rows).toBeNull()
    const meta = searchMetaOf({
      items: [
        {
          ref: 'zotero://user/0/item/ABCDEFGH',
          title: 'T',
          creatorSummary: 'C',
        },
      ],
    })
    expect(meta.rows).toEqual([
      { ref: 'zotero://user/0/item/ABCDEFGH', title: 'T', creatorSummary: 'C' },
    ])
  })
})

describe('getMetaOf', () => {
  it('decodes the attachment selection with its ref', () => {
    const meta = getMetaOf({
      title: 'T',
      creators: 'C',
      year: 2020,
      venue: 'V',
      bestAttachment: {
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
      },
    })
    expect(meta.title).toBe('T')
    expect(meta.creators).toBe('C')
    expect(meta.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      contentType: 'application/pdf',
    })
  })

  it('keeps a ref-less attachment selection as the content type alone', () => {
    const meta = getMetaOf({ bestAttachment: { contentType: 'application/pdf' } })
    expect(meta.bestAttachment).toEqual({ contentType: 'application/pdf' })
  })

  it('degrades absent and malformed fields to null', () => {
    const meta = getMetaOf({ title: 3, bestAttachment: 'x' })
    expect(meta.title).toBeNull()
    expect(meta.bestAttachment).toBeNull()
  })

  it('ignores an attachment record without a content type', () => {
    expect(getMetaOf({ bestAttachment: {} }).bestAttachment).toBeNull()
  })
})

describe('retrieveMetaOf', () => {
  const ITEM = {
    source: 'annotation',
    sourceRef: 'zotero://user/0/annotation/ANN1',
    preview: 'claim',
    previewTruncated: false,
    pageLabel: '7',
    attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
  }

  it('reads the availability facts, attachment ref, and coverage', () => {
    const meta = retrieveMetaOf({
      count: 1,
      sources: ['annotation'],
      truncated: true,
      sourcesSkipped: [],
      items: [ITEM],
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      coverage: { indexedPages: 5, totalPages: 10, complete: false },
      sourceAvailability: {
        annotation: { requested: true, returnedPassages: 1, unavailable: false },
        note: { requested: true, returnedPassages: 0, unavailable: true },
      },
    })
    expect(meta.truncated).toBe(true)
    expect(meta.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(meta.coverage).toEqual({ indexedPages: 5, totalPages: 10, complete: false })
    expect(meta.sourceAvailability).toEqual({
      annotation: { requested: true, returnedPassages: 1, unavailable: false },
      note: { requested: true, returnedPassages: 0, unavailable: true },
    })
    expect(meta.items).toEqual([ITEM])
  })

  it('drops malformed availability entries and coverage', () => {
    const meta = retrieveMetaOf({
      items: [],
      sourceAvailability: { annotation: { requested: true }, note: 'x' },
      coverage: { indexedPages: 1 },
    })
    expect(meta.sourceAvailability).toEqual({})
    expect(meta.coverage).toBeNull()
    expect(meta.truncated).toBeNull()
  })

  it('reads a chars-axis coverage', () => {
    const meta = retrieveMetaOf({
      items: [],
      coverage: { indexedChars: 100, totalChars: 200, complete: true },
    })
    expect(meta.coverage).toEqual({ indexedChars: 100, totalChars: 200, complete: true })
  })

  it('degrades malformed items to null', () => {
    const meta = retrieveMetaOf({ items: [{ source: 'annotation' }] })
    expect(meta.items).toBeNull()
  })
})

describe('attachmentMetaOf', () => {
  it('decodes the file arm with its ref', () => {
    const meta = attachmentMetaOf({
      kind: 'file',
      title: 'a.pdf',
      contentType: 'application/pdf',
      ref: 'zotero://user/0/attachment/WXYZ6789',
      path: '/tmp/a.pdf',
    })
    expect(meta.kind).toBe('file')
    expect(meta.location).toBe('/tmp/a.pdf')
    expect(meta.ref).toBe('zotero://user/0/attachment/WXYZ6789')
  })

  it('decodes the url arm and a record without a ref', () => {
    expect(
      attachmentMetaOf({ kind: 'url', title: 'p', contentType: 'text/html', url: 'https://e.org' }),
    ).toEqual({
      kind: 'url',
      title: 'p',
      contentType: 'text/html',
      location: 'https://e.org',
      ref: null,
    })
  })

  it('degrades an unknown kind to null fields', () => {
    const meta = attachmentMetaOf({ kind: 'other', contentType: 'application/pdf' })
    expect(meta.kind).toBeNull()
    expect(meta.location).toBeNull()
  })

  it('nulls the location when the arm field is missing', () => {
    const meta = attachmentMetaOf({ kind: 'file', contentType: 'application/pdf' })
    expect(meta.kind).toBe('file')
    expect(meta.title).toBeNull()
    expect(meta.location).toBeNull()
    expect(meta.ref).toBeNull()
  })

  it('nulls an absent content type', () => {
    const meta = attachmentMetaOf({ kind: 'url' })
    expect(meta.contentType).toBeNull()
  })
})

describe('exportMetaOf', () => {
  it('reads the bounded refs', () => {
    const meta = exportMetaOf({
      format: 'bibtex',
      style: 'apa',
      locale: 'en-US',
      refs: ['zotero://user/0/item/AAAAAAA1'],
      refsOmitted: 2,
    })
    expect(meta.format).toBe('bibtex')
    expect(meta.style).toBe('apa')
    expect(meta.locale).toBe('en-US')
    expect(meta.refs).toEqual(['zotero://user/0/item/AAAAAAA1'])
    expect(meta.refsOmitted).toBe(2)
  })

  it('treats a ref-less record as itemizing none', () => {
    const meta = exportMetaOf({ format: 'bibtex' })
    expect(meta.refs).toEqual([])
    expect(meta.refsOmitted).toBe(0)
  })

  it('nulls every absent fact', () => {
    expect(exportMetaOf({})).toEqual({
      format: null,
      style: null,
      locale: null,
      refs: [],
      refsOmitted: 0,
      items: [],
    })
  })

  it('decodes the bounded per-document items and drops malformed rows', () => {
    const meta = exportMetaOf({
      items: [
        {
          ref: 'zotero://user/0/item/AAAAAAA1',
          key: 'a1',
          title: 'Alpha',
          start: 0,
          end: 41,
        },
        { ref: 'zotero://user/0/item/AAAAAAA2', entryIndex: 1 },
        { ref: 'zotero://user/0/item/AAAAAAA4', start: 'x' },
        { key: 'no-ref' },
        'junk',
        { ref: 'zotero://user/0/item/AAAAAAA3', key: 7 },
      ],
    })
    expect(meta.items).toEqual([
      { ref: 'zotero://user/0/item/AAAAAAA1', key: 'a1', title: 'Alpha', start: 0, end: 41 },
      { ref: 'zotero://user/0/item/AAAAAAA2', entryIndex: 1 },
      { ref: 'zotero://user/0/item/AAAAAAA4' },
      { ref: 'zotero://user/0/item/AAAAAAA3' },
    ])
  })
})
