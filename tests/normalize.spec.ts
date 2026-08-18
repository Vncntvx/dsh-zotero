import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../src/errors.js'
import { extractAttachmentKey } from '../src/attachments.js'
import {
  collectionKeysOf,
  matchScopeName,
  nearScopeCandidates,
  normalizeAnnotationRecord,
  normalizeCreators,
  normalizeItemDetail,
  normalizeNoteRecord,
  normalizeScopeEntry,
  normalizeSearchItem,
  normalizeVenue,
  partitionChildren,
  plainNoteText,
  type ZoteroChildKind,
} from '../src/normalize.js'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

function expectUnexpected(fn: () => unknown): ZoteroError {
  let thrown: unknown
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
  return thrown as ZoteroError
}

describe('normalizeSearchItem', () => {
  it('normalizes a full Zotero 10 item, including the best attachment link and server provenance', () => {
    const item = normalizeSearchItem(fixture('item10'), 'S1')
    expect(item).toEqual({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      title: 'FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning',
      creatorSummary: 'Dao, Tri',
      year: 2023,
      itemType: 'conferencePaper',
      bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      bestAttachmentType: 'application/pdf',
      attachmentSize: 1234567,
    })
  })

  it('omits the server qualifier when the instance reported none (pre-Zotero-10)', () => {
    const item = normalizeSearchItem(fixture('item-pre10'))
    expect(item.ref).toBe('zotero://user/0/item/EFGH5678')
    expect(item.bestAttachmentRef).toBeUndefined()
    expect(item.year).toBe(2017)
  })

  it('ignores unknown fields from future Zotero versions', () => {
    const item = normalizeSearchItem(fixture('item-extra-fields'), 'S2')
    expect(item.ref).toBe('zotero://user/0/item/MNOP3456?server=S2')
    expect(item.title).toBe('A Forward-Tolerant Record')
    expect(item.year).toBe(2020)
  })

  it('tolerates missing optional fields', () => {
    const item = normalizeSearchItem(fixture('item-minimal'))
    expect(item).toEqual({
      ref: 'zotero://user/0/item/QRST7890',
      title: '',
      creatorSummary: '',
      year: undefined,
      itemType: 'webpage',
      bestAttachmentRef: undefined,
      bestAttachmentType: undefined,
      attachmentSize: undefined,
    })
  })

  it('omits the year when parsedDate does not start with four digits', () => {
    const item = normalizeSearchItem({
      key: 'ABCD1234',
      meta: { parsedDate: 'n/a' },
      data: { itemType: 'book', title: 'Undated' },
    })
    expect(item.year).toBeUndefined()
    expect(item.title).toBe('Undated')
  })

  it('falls back to the top-level itemType when data.itemType is absent', () => {
    const item = normalizeSearchItem({
      key: 'ABCD1234',
      itemType: 'book',
      data: { title: 'Top Level Type' },
    })
    expect(item.itemType).toBe('book')
  })

  it('falls back to the top-level itemType when the data block is missing entirely', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234', itemType: 'book' })
    expect(item.itemType).toBe('book')
  })

  it('carries the parent ref for child notes', () => {
    const item = normalizeSearchItem(
      { key: 'NOTE1111', data: { itemType: 'note', title: '', parentItem: 'ABCD1234' } },
      'S1',
    )
    expect(item.parentRef).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(
      normalizeSearchItem({ key: 'ABCD1234', data: { itemType: 'book' } }).parentRef,
    ).toBeUndefined()
  })

  it('synthesizes a note title from the first body line when the title is empty', () => {
    const item = normalizeSearchItem({
      key: 'NOTE1111',
      data: { itemType: 'note', title: '', note: '<p>论文概述</p><p>second line</p>' },
    })
    expect(item.title).toBe('论文概述')
  })

  it('falls back to an untitled marker for notes without any body', () => {
    const item = normalizeSearchItem({ key: 'NOTE1111', data: { itemType: 'note', title: '' } })
    expect(item.title).toBe('(untitled note)')
  })

  it('keeps an explicit note title when Zotero reports one', () => {
    const item = normalizeSearchItem({
      key: 'NOTE1111',
      data: { itemType: 'note', title: 'Real title', note: 'body' },
    })
    expect(item.title).toBe('Real title')
  })

  it('yields an empty itemType when neither level declares one', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234' })
    expect(item.itemType).toBe('')
  })

  it('fails loud when the key invariant is broken', () => {
    expectUnexpected(() => normalizeSearchItem({ key: 'nope', data: {} }))
    expectUnexpected(() => normalizeSearchItem({ data: { title: 'no key' } }))
    expectUnexpected(() => normalizeSearchItem(null))
  })
})

describe('extractAttachmentKey', () => {
  it('extracts an 8-character key from an attachment href', () => {
    expect(extractAttachmentKey('http://localhost:23119/api/users/0/items/WXYZ6789')).toBe(
      'WXYZ6789',
    )
    expect(extractAttachmentKey('https://api.zotero.org/users/1/items/WXYZ6789?format=json')).toBe(
      'WXYZ6789',
    )
  })

  it('returns undefined when no key is present', () => {
    expect(
      extractAttachmentKey('http://localhost:23119/api/users/0/items/not-a-key'),
    ).toBeUndefined()
    expect(extractAttachmentKey(undefined)).toBeUndefined()
  })
})

describe('normalizeScopeEntry', () => {
  it('reads the key and data name of a collection or saved search', () => {
    expect(
      normalizeScopeEntry({
        key: 'COLL1234',
        version: 1,
        data: { key: 'COLL1234', version: 1, name: 'LLM Papers' },
      }),
    ).toEqual({ key: 'COLL1234', name: 'LLM Papers' })
  })

  it('tolerates a missing name and rejects a broken key', () => {
    expect(normalizeScopeEntry({ key: 'SRCH1234', data: {} }).name).toBe('')
    expectUnexpected(() => normalizeScopeEntry({ key: 'nope', data: { name: 'x' } }))
  })
})

describe('matchScopeName', () => {
  const entries = [
    { key: 'AAAA1111', name: 'LLM' },
    { key: 'BBBB2222', name: 'LLMs' },
    { key: 'CCCC3333', name: 'Reasoning' },
  ]

  it('prefers an exact Unicode match', () => {
    expect(matchScopeName(entries, 'LLM')).toEqual([{ key: 'AAAA1111', name: 'LLM' }])
    expect(matchScopeName(entries, 'LLMs')).toEqual([{ key: 'BBBB2222', name: 'LLMs' }])
  })

  it('falls back to a case-insensitive match', () => {
    expect(matchScopeName(entries, 'llm')).toEqual([{ key: 'AAAA1111', name: 'LLM' }])
  })

  it('returns every case-insensitive match and an empty list otherwise', () => {
    expect(matchScopeName(entries, 'reasoning')).toEqual([{ key: 'CCCC3333', name: 'Reasoning' }])
    expect(matchScopeName(entries, 'vision')).toEqual([])
  })
})

describe('nearScopeCandidates', () => {
  const entries = [
    { key: 'AAAA1111', name: 'LLM Papers 2026' },
    { key: 'BBBB2222', name: 'LLM Inference' },
    { key: 'CCCC3333', name: 'Speculative Decoding' },
  ]

  it('returns case-insensitive substring matches sorted by name length', () => {
    expect(nearScopeCandidates(entries, 'llm')).toEqual([
      { key: 'BBBB2222', name: 'LLM Inference' },
      { key: 'AAAA1111', name: 'LLM Papers 2026' },
    ])
  })

  it('respects the limit and returns nothing without matches', () => {
    expect(nearScopeCandidates(entries, 'llm', 1)).toEqual([
      { key: 'BBBB2222', name: 'LLM Inference' },
    ])
    expect(nearScopeCandidates(entries, 'quantization')).toEqual([])
  })

  it('orders equal-length matches by name', () => {
    const sameLength = [
      { key: 'AAAA1111', name: 'LLM Zoo' },
      { key: 'BBBB2222', name: 'LLM Ada' },
    ]
    expect(nearScopeCandidates(sameLength, 'llm')).toEqual([
      { key: 'BBBB2222', name: 'LLM Ada' },
      { key: 'AAAA1111', name: 'LLM Zoo' },
    ])
  })
})

describe('normalizeCreators', () => {
  it('formats name-field creators and first/last pairs, skipping empties', () => {
    expect(
      normalizeCreators({
        creators: [
          { creatorType: 'author', firstName: 'Tri', lastName: 'Dao' },
          { creatorType: 'author', firstName: '', lastName: 'Fu' },
          { creatorType: 'editor', name: 'OpenAI Research' },
        ],
      }),
    ).toEqual(['Tri Dao', 'Fu', 'OpenAI Research'])
  })

  it('returns an empty list when creators are absent or not an array', () => {
    expect(normalizeCreators(undefined)).toEqual([])
    expect(normalizeCreators({ creators: 'nope' })).toEqual([])
  })
})

describe('normalizeVenue', () => {
  it('picks the first available publication venue', () => {
    expect(normalizeVenue({ publicationTitle: 'ICML' })).toBe('ICML')
    expect(normalizeVenue({ proceedingsTitle: 'Proceedings' })).toBe('Proceedings')
    expect(normalizeVenue({ bookTitle: 'A Book' })).toBe('A Book')
    expect(normalizeVenue({ journalAbbreviation: 'JMLR' })).toBe('JMLR')
    expect(normalizeVenue({ conferenceName: 'NeurIPS' })).toBe('NeurIPS')
    expect(normalizeVenue({})).toBeUndefined()
  })

  it('prefers the earlier venue fields when several are present', () => {
    // The priority order is Zotero's own: publicationTitle wins over the
    // book-level and conference fields, proceedings over bookTitle. A
    // reordering of the field list must change which one is reported.
    expect(
      normalizeVenue({
        publicationTitle: 'ICML',
        bookTitle: 'A Book',
        conferenceName: 'NeurIPS',
      }),
    ).toBe('ICML')
    expect(normalizeVenue({ proceedingsTitle: 'Proceedings', bookTitle: 'A Book' })).toBe(
      'Proceedings',
    )
  })
})

describe('collectionKeysOf', () => {
  it('reads collection keys from the data block', () => {
    expect(collectionKeysOf({ data: { collections: ['COLL1234', 'COLL5678'] } })).toEqual([
      'COLL1234',
      'COLL5678',
    ])
    expect(collectionKeysOf({ data: {} })).toEqual([])
    expect(collectionKeysOf({ data: { collections: 'nope' } })).toEqual([])
  })
})

describe('normalizeNoteRecord', () => {
  it('normalizes a note child with truncation budget', () => {
    const row = { key: 'NOTE1111', data: { itemType: 'note', note: 'hello world' } }
    expect(normalizeNoteRecord(row, 'S1', 5)).toEqual({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      text: 'hello',
      truncated: true,
    })
  })

  it('tolerates a missing note body', () => {
    expect(
      normalizeNoteRecord({ key: 'NOTE1111', data: { itemType: 'note' } }, undefined, 100),
    ).toEqual({ ref: 'zotero://user/0/item/NOTE1111', text: '', truncated: false })
  })

  it('strips HTML and carries the parent ref when reported', () => {
    const row = {
      key: 'NOTE1111',
      data: { itemType: 'note', note: '<p>First</p><p>Second</p>', parentItem: 'ABCD1234' },
    }
    expect(normalizeNoteRecord(row, 'S1', 100)).toEqual({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      text: 'First\nSecond',
      truncated: false,
      parentRef: 'zotero://user/0/item/ABCD1234?server=S1',
    })
  })

  it('keeps the full body when no budget is given', () => {
    const row = { key: 'NOTE1111', data: { itemType: 'note', note: 'word word word' } }
    expect(normalizeNoteRecord(row, undefined)).toEqual({
      ref: 'zotero://user/0/item/NOTE1111',
      text: 'word word word',
      truncated: false,
    })
  })

  it('ignores malformed parent keys', () => {
    const row = { key: 'NOTE1111', data: { itemType: 'note', note: 'x', parentItem: 'nope!!' } }
    expect(normalizeNoteRecord(row, undefined, 10).parentRef).toBeUndefined()
  })
})

describe('plainNoteText', () => {
  it('strips tags, turns block ends into newlines, and decodes entities', () => {
    expect(plainNoteText('<p>A &amp; B</p><p>C&nbsp;D<br/>E</p>')).toBe('A & B\nC D\nE')
  })

  it('returns an empty string for non-string or empty input', () => {
    expect(plainNoteText(undefined)).toBe('')
    expect(plainNoteText(42)).toBe('')
    expect(plainNoteText('<p></p>')).toBe('')
  })
})

describe('normalizeAnnotationRecord', () => {
  it('normalizes an annotation child and omits empty optionals', () => {
    const row = {
      key: 'ANNO1111',
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: 'the key insight',
        annotationComment: 'check this',
        annotationColor: '#ffd400',
        annotationPageLabel: '7',
        annotationSortIndex: '00003',
        annotationPosition: '{"pageIndex":6}',
        parentItem: 'WXYZ6789',
      },
    }
    expect(normalizeAnnotationRecord(row, 'S1')).toEqual({
      ref: 'zotero://user/0/item/ANNO1111?server=S1',
      type: 'highlight',
      text: 'the key insight',
      comment: 'check this',
      color: '#ffd400',
      pageLabel: '7',
      parentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
    })
  })

  it('tolerates image annotations without annotationText', () => {
    expect(
      normalizeAnnotationRecord(
        { key: 'ANNO2222', data: { itemType: 'annotation', annotationType: 'image' } },
        undefined,
      ),
    ).toEqual({
      ref: 'zotero://user/0/item/ANNO2222',
      type: 'image',
      text: '',
      comment: undefined,
      color: undefined,
      pageLabel: undefined,
    })
  })

  it('keeps empty-string optionals distinct from absent ones', () => {
    // Zotero reports an empty annotationComment/annotationColor as '' rather
    // than omitting the field; the record stays lossless by carrying them.
    expect(
      normalizeAnnotationRecord(
        {
          key: 'ANNO3333',
          data: {
            itemType: 'annotation',
            annotationType: 'highlight',
            annotationText: 'x',
            annotationComment: '',
            annotationColor: '',
          },
        },
        undefined,
      ),
    ).toEqual({
      ref: 'zotero://user/0/item/ANNO3333',
      type: 'highlight',
      text: 'x',
      comment: '',
      color: '',
    })
  })
})

describe('partitionChildren', () => {
  it('partitions children into notes, annotations, and attachments', () => {
    const rows = [
      { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } },
      {
        key: 'ANNO1111',
        data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'a' },
      },
      {
        key: 'WXYZ6789',
        data: {
          itemType: 'attachment',
          title: 'p',
          contentType: 'application/pdf',
          linkMode: 'imported_file',
        },
      },
      { key: 'AAAA1111', data: { itemType: 'note', note: 'n2' } },
    ]
    const partitioned = partitionChildren(rows, 'S1', 100)
    expect(partitioned.notes).toHaveLength(2)
    expect(partitioned.annotations).toHaveLength(1)
    expect(partitioned.attachments).toHaveLength(1)
    expect(partitioned.attachments[0]).toEqual({
      key: 'WXYZ6789',
      title: 'p',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    })
    expect(partitioned.notes[0]!.text).toBe('n')
  })

  it('sorts annotations by their Zotero sort index', () => {
    const rows = [
      {
        key: 'ANNO2222',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'second',
          annotationSortIndex: '00002',
        },
      },
      {
        key: 'ANNO1111',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'first',
          annotationSortIndex: '00001',
        },
      },
    ]
    expect(
      partitionChildren(rows, undefined, 100).annotations.map((annotation) => annotation.text),
    ).toEqual(['first', 'second'])
  })

  it('fails loud on a child without a valid key', () => {
    expect(() => partitionChildren([{ data: { itemType: 'note' } }], undefined, 100)).toThrowError()
  })

  it('normalizes only the requested kinds', () => {
    const rows = [
      { key: 'NOTE1111', data: { itemType: 'note', note: '<p>body</p>' } },
      {
        key: 'ANNO1111',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'a',
          annotationSortIndex: '00001',
        },
      },
      {
        key: 'WXYZ6789',
        data: { itemType: 'attachment', title: 'p', contentType: 'application/pdf' },
      },
    ]
    const partitioned = partitionChildren(
      rows,
      'S1',
      undefined,
      new Set<ZoteroChildKind>(['attachment']),
    )
    expect(partitioned.notes).toEqual([])
    expect(partitioned.annotations).toEqual([])
    expect(partitioned.attachments).toHaveLength(1)
  })

  it('skips malformed rows of unrequested kinds', () => {
    const malformed = [{ data: { itemType: 'note', note: 'body' } }]
    expect(
      partitionChildren(malformed, undefined, 100, new Set<ZoteroChildKind>(['attachment'])),
    ).toEqual({ notes: [], annotations: [], attachments: [] })
    expect(() =>
      partitionChildren(malformed, undefined, 100, new Set<ZoteroChildKind>(['note'])),
    ).toThrowError()
  })
})

describe('normalizeItemDetail', () => {
  const PARENT = {
    key: 'ABCD1234',
    version: 3,
    links: {
      self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
      attachment: {
        href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
        type: 'application/json',
        attachmentType: 'application/pdf',
      },
    },
    meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 3 },
    data: {
      itemType: 'journalArticle',
      title: 'FlashAttention-2',
      date: '2023-07-28',
      creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
      publicationTitle: 'ICML',
      DOI: '10.1234/fa2',
      url: 'https://arxiv.org/abs/2307.08691',
      abstractNote: 'FlashAttention is an algorithm for fast attention.',
      tags: [{ tag: 'attention' }, { tag: 'efficient' }],
      collections: ['COLL1234', 'COLL9999'],
    },
  }

  const CHILDREN = [
    { key: 'NOTE1111', data: { itemType: 'note', note: 'my note' } },
    {
      key: 'ANNO1111',
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: 'insight',
        annotationSortIndex: '00001',
        annotationColor: '#ffd400',
      },
    },
    {
      key: 'WXYZ6789',
      data: {
        itemType: 'attachment',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
        linkMode: 'imported_file',
      },
    },
  ]

  it("normalizes a full detail with every include and Zotero's best attachment", () => {
    const detail = normalizeItemDetail({
      parent: PARENT,
      serverId: 'S1',
      include: new Set(['notes', 'annotations', 'attachments']),
      childrenRows: CHILDREN,
      collectionNames: new Map([['COLL1234', 'LLM Papers']]),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail).toEqual({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      itemType: 'journalArticle',
      title: 'FlashAttention-2',
      creators: ['Tri Dao'],
      date: '2023-07-28',
      year: 2023,
      venue: 'ICML',
      doi: '10.1234/fa2',
      url: 'https://arxiv.org/abs/2307.08691',
      abstract: 'FlashAttention is an algorithm for fast attention.',
      abstractTruncated: false,
      tags: ['attention', 'efficient'],
      collections: [
        { ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' },
        { ref: 'zotero://user/0/collection/COLL9999?server=S1' },
      ],
      children: { total: 3 },
      bestAttachment: {
        ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
      },
      notes: {
        total: 1,
        returned: 1,
        items: [
          { ref: 'zotero://user/0/item/NOTE1111?server=S1', text: 'my note', truncated: false },
        ],
      },
      annotations: {
        total: 1,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/item/ANNO1111?server=S1',
            type: 'highlight',
            text: 'insight',
            color: '#ffd400',
          },
        ],
      },
      attachments: {
        total: 1,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
            title: 'Full Text PDF',
            contentType: 'application/pdf',
            linkMode: 'imported_file',
          },
        ],
      },
      version: 3,
      serverId: 'S1',
    })
  })

  it('omits unrequested child kinds, optionals, and provenance when absent', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'Bare' } },
      include: new Set(['notes']),
      childrenRows: [],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail).toEqual({
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'journalArticle',
      title: 'Bare',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      notes: { total: 0, returned: 0, items: [] },
    })
  })

  it('omits the abstract entirely when it is empty', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: { itemType: 'journalArticle', title: 'T', abstractNote: '' },
      },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.abstract).toBeUndefined()
    expect(detail.abstractTruncated).toBe(false)
  })

  it('truncates the abstract at the budget and flags it', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: { itemType: 'journalArticle', title: 'T', abstractNote: 'abcdefgh' },
      },
      include: new Set(),
      maxAbstractChars: 4,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.abstract).toBe('abcd')
    expect(detail.abstractTruncated).toBe(true)
  })

  it('caps note and annotation counts and reports the uncapped totals', () => {
    const notes = Array.from({ length: 60 }, (_, i) => ({
      key: `NOTE${String(i).padStart(4, '0')}`,
      data: { itemType: 'note', note: `note ${i}` },
    }))
    const annotations = Array.from({ length: 105 }, (_, i) => ({
      key: `ANNO${String(i).padStart(4, '0')}`,
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: `a ${i}`,
        annotationSortIndex: String(i).padStart(5, '0'),
      },
    }))
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T' } },
      include: new Set(['notes', 'annotations']),
      childrenRows: [...notes, ...annotations],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.notes).toMatchObject({ total: 60, returned: 50 })
    expect(detail.notes!.items).toHaveLength(50)
    expect(detail.annotations).toMatchObject({ total: 105, returned: 100 })
    expect(detail.annotations!.items[0]!.text).toBe('a 0')
  })

  it('falls back to the fetched children count when numChildren is absent', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T' } },
      include: new Set(['notes']),
      childrenRows: [{ key: 'NOTE1111', data: { itemType: 'note', note: 'n' } }],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.children).toEqual({ total: 1 })
  })

  it("keeps Zotero's numChildren when it disagrees with the fetched rows", () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        meta: { numChildren: 7 },
        data: { itemType: 'journalArticle', title: 'T' },
      },
      include: new Set(['notes']),
      childrenRows: [{ key: 'NOTE1111', data: { itemType: 'note', note: 'n' } }],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.children).toEqual({ total: 7 })
  })

  it('borrows the attachment title only when the children carry it', () => {
    const withLinks = {
      key: 'ABCD1234',
      links: {
        attachment: {
          href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
          attachmentType: 'application/pdf',
        },
      },
      data: { itemType: 'journalArticle', title: 'T' },
    }
    const detail = normalizeItemDetail({
      parent: withLinks,
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: '',
      contentType: 'application/pdf',
    })
  })

  it('skips empty tags, empty venues, and unknown child kinds', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'journalArticle',
          title: 'T',
          publicationTitle: '',
          tags: [{ tag: 'real' }, { tag: '' }, 'not-a-tag-object'],
          creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
        },
      },
      include: new Set(['notes', 'annotations', 'attachments']),
      childrenRows: [
        { key: 'UNKN1234', data: { itemType: 'futureKind' } },
        { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } },
      ],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.tags).toEqual(['real'])
    expect(detail.venue).toBeUndefined()
    expect(detail.creators).toEqual(['Tri Dao'])
    expect(detail.notes!.total).toBe(1)
    expect(detail.annotations!.total).toBe(0)
    expect(detail.attachments!.total).toBe(0)
  })

  it('falls back to the top-level itemType when the data block omits it', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', itemType: 'journalArticle', data: { title: 'T' } },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.itemType).toBe('journalArticle')
  })

  it('fails loud when the parent has no valid key', () => {
    const error = expectUnexpected(() =>
      normalizeItemDetail({
        parent: {},
        include: new Set(),
        maxAbstractChars: 100,
        maxNoteBodyChars: 3000,
        maxNoteChars: 2000,
        maxNoteRecords: 50,
        maxAnnotationRecords: 100,
      }),
    )
    expect(error.code).toBe(ZOTERO_UNEXPECTED)
  })

  it('returns the note body for note items under the budget', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'NOTE1111',
        data: { itemType: 'note', note: '<p>hello <b>world</b></p>' },
      },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 8,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.noteBody).toEqual({ text: 'hello wo', truncated: true })
  })

  it('omits noteBody for non-note items', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T' } },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.noteBody).toBeUndefined()
  })
})

describe('annotation and note failure modes', () => {
  it('fails loud on an annotation without a valid key', () => {
    const error = expectUnexpected(() =>
      normalizeAnnotationRecord({ data: { annotationText: 'x' } }),
    )
    expect(error.code).toBe(ZOTERO_UNEXPECTED)
  })
})

describe('normalizeItemDetail include and fallback branches', () => {
  it('emits only the requested child kinds when children were fetched', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T' } },
      include: new Set(['annotations']),
      childrenRows: [
        { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } },
        {
          key: 'ANNO1111',
          data: {
            itemType: 'annotation',
            annotationType: 'highlight',
            annotationText: 'a',
            annotationSortIndex: '00001',
          },
        },
      ],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.notes).toBeUndefined()
    expect(detail.annotations!.total).toBe(1)
  })

  it('defaults the item type to an empty string when neither level carries one', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { title: 'T' } },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.itemType).toBe('')
  })
})

describe('normalizeScopeEntry tolerances', () => {
  it('defaults a missing collection name to an empty string', () => {
    expect(normalizeScopeEntry({ key: 'COLL1234' })).toEqual({ key: 'COLL1234', name: '' })
  })
})

describe('partitionChildren tolerances', () => {
  it('sorts annotations without a sort index first', () => {
    const rows = [
      {
        key: 'ANNO2222',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'sorted',
          annotationSortIndex: '00002',
        },
      },
      {
        key: 'ANNO1111',
        data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'unsorted' },
      },
    ]
    const partitioned = partitionChildren(rows, undefined, 100)
    expect(partitioned.annotations.map((annotation) => annotation.ref)).toEqual([
      'zotero://user/0/item/ANNO1111',
      'zotero://user/0/item/ANNO2222',
    ])
  })

  it('skips non-object child rows', () => {
    const partitioned = partitionChildren(
      ['junk', { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } }],
      undefined,
      100,
    )
    expect(partitioned.notes).toHaveLength(1)
    expect(partitioned.annotations).toHaveLength(0)
    expect(partitioned.attachments).toHaveLength(0)
  })
})

describe('normalizeItemDetail attachment and title tolerances', () => {
  it('omits linkMode for attachments without one', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'T' } },
      include: new Set(['attachments']),
      childrenRows: [
        {
          key: 'WXYZ6789',
          data: { itemType: 'attachment', title: 'Snapshot', contentType: 'text/html' },
        },
      ],
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.attachments!.items).toEqual([
      { ref: 'zotero://user/0/attachment/WXYZ6789', title: 'Snapshot', contentType: 'text/html' },
    ])
  })

  it('defaults a missing title to an empty string', () => {
    const detail = normalizeItemDetail({
      parent: { key: 'ABCD1234', data: { itemType: 'journalArticle' } },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 3000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
    })
    expect(detail.title).toBe('')
  })
})

describe('normalization of hostile inputs', () => {
  it('fails loud on null and array item JSON', () => {
    for (const input of [null, []]) {
      let thrown: unknown
      try {
        normalizeSearchItem(input)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ZoteroError)
      expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
    }
  })

  it('tolerates non-string item types in search hits', () => {
    expect(normalizeSearchItem({ key: 'ABCD1234', data: { itemType: 42 } }).itemType).toBe('')
  })
})

describe('normalizeCreators partial names', () => {
  it('fills missing first or last names from the other field', () => {
    expect(normalizeCreators({ creators: [{ creatorType: 'author', lastName: 'Dao' }] })).toEqual([
      'Dao',
    ])
    expect(normalizeCreators({ creators: [{ creatorType: 'author', firstName: 'Tri' }] })).toEqual([
      'Tri',
    ])
  })
})

describe('normalizeAnnotationRecord missing type', () => {
  it('defaults a missing annotation type to an empty string', () => {
    expect(
      normalizeAnnotationRecord({ key: 'ANNO1111', data: { itemType: 'annotation' } }),
    ).toEqual({ ref: 'zotero://user/0/item/ANNO1111', type: '', text: '' })
  })
})
