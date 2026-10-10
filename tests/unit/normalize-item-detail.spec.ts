/**
 * The full detail projection `normalizeItemDetail` builds: the parent's
 * metadata, its child records, the canonicalized relation map, and the
 * `extraFields` lossless-JSON gate on every field the projection did not
 * consume. The gate is a whole-module contract, so it stays its own describe
 * rather than folding into a function's block. The compact search-hit
 * projection `normalizeSearchItem` and its hostile-input contract live in
 * `normalize-search-item.spec.ts`.
 * @module tests/unit/normalize-item-detail
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { normalizeItemDetail, type NormalizeItemDetailInput } from '../../src/normalize.js'
import { expectUnexpected } from './normalize-helpers.js'

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
      creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
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
            ref: 'zotero://user/0/annotation/ANNO1111?server=S1',
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
    expect(detail.creators).toEqual([{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }])
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

describe('normalizeItemDetail relations', () => {
  /**
   * Fresh bounds for one relation case. Every relation test runs under the
   * same limits and none of them is the subject, so they are stated once:
   * built fresh per call rather than shared, so no test can hand the next one
   * a mutation.
   */
  function bounds(): Pick<
    NormalizeItemDetailInput,
    | 'include'
    | 'maxAbstractChars'
    | 'maxNoteBodyChars'
    | 'maxNoteChars'
    | 'maxNoteRecords'
    | 'maxAnnotationRecords'
  > {
    return {
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    }
  }

  /** One parent whose only interesting field is its relation map. */
  function parentWith(relations: unknown, extra: Record<string, unknown> = {}) {
    return {
      key: 'ABCD1234',
      ...extra,
      data: { itemType: 'journalArticle', title: 'T', relations },
    }
  }

  function detailWithLibrary(parentLibrary: Record<string, unknown>): {
    targetRef: string | undefined
  } {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        ...parentLibrary,
        data: {
          itemType: 'journalArticle',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/users/123/items/BBBB1234'] },
        },
      },
      library: { type: 'user', id: 0 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    return { targetRef: detail.relations?.[0]?.targetRef }
  }

  it('canonicalizes a personal relation when the parent library proves the id', () => {
    // Every spelling Zotero has used for the parent's library id counts as
    // proof: nested id, libraryID/libraryId in either casing or as a string,
    // and the top-level record fields.
    for (const parentLibrary of [
      { library: { type: 'user', id: 123 } },
      { library: { libraryID: 123 } },
      { library: { libraryId: 123 } },
      { library: { id: '123' } },
      { library: { libraryID: '123' } },
      { libraryID: 123 },
      { libraryId: 123 },
    ]) {
      expect(detailWithLibrary(parentLibrary).targetRef).toBe('zotero://user/0/item/BBBB1234')
    }
  })

  it('keeps the raw URI when no parent library fact proves the id', () => {
    expect(detailWithLibrary({ library: { type: 'user', id: 999 } }).targetRef).toBeUndefined()
    expect(detailWithLibrary({}).targetRef).toBeUndefined()
  })

  it('drops a non-string relation value instead of guessing a target', () => {
    const detail = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'book',
          title: 'T',
          relations: { 'dc:relation': 42 as unknown as string },
        },
      },
      library: { type: 'user', id: 0 },
      ...bounds(),
    })
    expect(detail.relations).toBeUndefined()
  })

  it('maps a relation to the group library the item lives in', () => {
    const detail = normalizeItemDetail({
      parent: parentWith({ 'dc:relation': ['http://zotero.org/groups/42/items/BBBB1234'] }),
      library: { type: 'group', id: 42 },
      serverId: 'S1',
      ...bounds(),
    })
    expect(detail.relations).toEqual([
      {
        predicate: 'dc:relation',
        targetUri: 'http://zotero.org/groups/42/items/BBBB1234',
        targetRef: 'zotero://group/42/item/BBBB1234?server=S1',
      },
    ])
  })

  it('leaves a relation to another group without a target', () => {
    const detail = normalizeItemDetail({
      parent: parentWith({ 'dc:relation': ['http://zotero.org/groups/99/items/BBBB1234'] }),
      library: { type: 'group', id: 42 },
      ...bounds(),
    })
    expect(detail.relations?.[0]?.targetRef).toBeUndefined()
    expect(detail.relations?.[0]?.targetUri).toBe('http://zotero.org/groups/99/items/BBBB1234')
  })

  it('maps a personal relation the item library itself proves', () => {
    const detail = normalizeItemDetail({
      parent: parentWith({ 'dc:relation': ['http://zotero.org/users/0/items/BBBB1234'] }),
      library: { type: 'user', id: 0 },
      serverId: 'S1',
      ...bounds(),
    })
    expect(detail.relations?.[0]?.targetRef).toBe('zotero://user/0/item/BBBB1234?server=S1')
  })

  it('keeps a foreign URI and drops the malformed values beside it', () => {
    const detail = normalizeItemDetail({
      parent: parentWith({
        'unknown:pred': [
          'https://doi.org/10.1234/abc',
          '',
          42 as unknown as string,
          'http://zotero.org/users/0/items/BBBB1234',
        ],
      }),
      library: { type: 'user', id: 0 },
      ...bounds(),
    })
    // Two values survive: the DOI and the Zotero URI; the empty string and
    // the non-string are dropped rather than turned into a guessed target.
    expect(detail.relations?.length).toBe(2)
    expect(detail.relations?.[0]?.predicate).toBe('unknown:pred')
    expect(detail.relations?.[0]?.targetUri).toBe('https://doi.org/10.1234/abc')
    expect(detail.relations?.[0]?.targetRef).toBeUndefined()
  })

  it('treats an empty or unreadable relation map as no relations', () => {
    for (const relations of [{}, 'bad' as unknown as Record<string, unknown>]) {
      const detail = normalizeItemDetail({
        parent: parentWith(relations),
        library: { type: 'user', id: 0 },
        ...bounds(),
      })
      expect(detail.relations).toBeUndefined()
    }
  })
})

describe('extraFields lossless-JSON gate', () => {
  it('drops non-finite and negative-zero numbers that JSON cannot round-trip', () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        repository: 'Zenodo',
        scoreNaN: Number.NaN,
        scoreInf: Number.POSITIVE_INFINITY,
        negZero: -0,
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toEqual({ repository: 'Zenodo' })
  })

  it('drops fields whose nested values cannot round-trip, keeping valid nested records', () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        validNested: { level: 1, tags: ['a', 'b'], flag: true, score: 3, nothing: null },
        nestedNaN: { score: Number.NaN },
        nestedInf: [1, Number.POSITIVE_INFINITY],
        nestedNegZero: { zero: -0 },
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toEqual({
      validNested: { level: 1, tags: ['a', 'b'], flag: true, score: 3, nothing: null },
    })
  })

  it('drops non-JSON values the strict harness gate rejects', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        kept: 'yes',
        missing: undefined,
        fn: () => 1,
        date: new Date('2024-01-01T00:00:00.000Z'),
        loop: circular,
        sparse: (() => {
          const sparseArray: unknown[] = []
          sparseArray[2] = 'x'
          return sparseArray
        })(),
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toEqual({ kept: 'yes' })
  })

  it('omits extraFields when every unconsumed field is dropped', () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      data: {
        key: 'ABCD1234',
        version: 1,
        itemType: 'journalArticle',
        title: 't',
        scoreNaN: Number.NaN,
      },
    }
    const detail = normalizeItemDetail({
      parent,
      include: new Set(),
      maxAbstractChars: 10,
      maxNoteBodyChars: 10,
      maxNoteChars: 10,
      maxNoteRecords: 1,
      maxAnnotationRecords: 1,
      fields: 'all',
    })
    expect(detail.extraFields).toBeUndefined()
  })
})
