/**
 * The domain↔wire mappings the library panel's host endpoints run through:
 * every optional-field arm on both directions, so the strict wire codecs
 * never see a `undefined` key and the panel never sees a tool-domain fact.
 * @module tests/unit/library-views
 */

import { describe, expect, it } from 'vitest'
import {
  browseRequestOf,
  browseViewOf,
  exportViewOf,
  itemRequestOf,
  itemViewOf,
  searchOptionsOf,
  searchRequestOf,
  searchViewOf,
} from '../../src/library-views.js'
import type {
  ZoteroBrowseResult,
  ZoteroExportTextResult,
  ZoteroItemDetail,
  ZoteroSearchResult,
} from '../../src/types.js'
import type { ZoteroItemDetailView, ZoteroLibrarySearchRequestView } from '../../src/contract.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../../src/errors.js'
import { itemDetail } from '../helpers/library-fixtures.js'

describe('browseRequestOf', () => {
  it('forwards server-side tag queries and their matching mode', () => {
    expect(
      browseRequestOf({ kind: 'tags', q: 'vision', match: 'contains', offset: 0, limit: 50 }),
    ).toEqual({ kind: 'tags', q: 'vision', match: 'contains', offset: 0, limit: 50 })
  })
  it('maps the panel request, keeping library and parent only when present', () => {
    expect(browseRequestOf({ kind: 'libraries', offset: 0, limit: 50 })).toEqual({
      kind: 'libraries',
      offset: 0,
      limit: 50,
    })
    expect(
      browseRequestOf({
        kind: 'collections',
        library: { type: 'group', id: 7 },
        parentRef: 'zotero://user/0/collection/C1',
        offset: 10,
        limit: 25,
      }),
    ).toEqual({
      kind: 'collections',
      library: { type: 'group', id: 7 },
      parentRef: 'zotero://user/0/collection/C1',
      offset: 10,
      limit: 25,
    })
  })
})

describe('browseViewOf', () => {
  const base = { total: 1, offset: 0, returned: 1 }
  it('normalizes an omitted saved-search condition list to an empty list', () => {
    expect(
      browseViewOf(
        {
          kind: 'savedSearches',
          items: [{ ref: 'zotero://user/0/search/SEARCH01', name: 'Unread' }],
          ...base,
        },
        50,
      ).items,
    ).toEqual([
      {
        kind: 'savedSearch',
        ref: 'zotero://user/0/search/SEARCH01',
        name: 'Unread',
        conditions: [],
      },
    ])
  })

  it('exposes tags and localized item types as the filter pickers consume them', () => {
    expect(browseViewOf({ kind: 'tags', items: [{ tag: 'vision' }], ...base }, 50).items).toEqual([
      { kind: 'tag', tag: 'vision' },
    ])
    expect(
      browseViewOf(
        {
          kind: 'itemTypes',
          items: [{ itemType: 'book', localized: 'Books' }, { itemType: 'journalArticle' }],
          ...base,
        },
        50,
      ).items,
    ).toEqual([
      { kind: 'itemType', itemType: 'book', localized: 'Books' },
      { kind: 'itemType', itemType: 'journalArticle' },
    ])
  })

  it('tags collection rows and keeps the breadcrumb optional arms', () => {
    const withParent: ZoteroBrowseResult = {
      kind: 'collections',
      items: [
        {
          ref: 'zotero://user/0/collection/C2',
          name: 'Child',
          parentRef: 'zotero://user/0/collection/C1',
          path: ['Root', 'Child'],
          depth: 1,
        },
      ],
      nextOffset: 1,
      ...base,
    }
    expect(browseViewOf(withParent, 50)).toEqual({
      kind: 'collections',
      items: [
        {
          kind: 'collection',
          ref: 'zotero://user/0/collection/C2',
          name: 'Child',
          parentRef: 'zotero://user/0/collection/C1',
          path: ['Root', 'Child'],
          depth: 1,
        },
      ],
      ...base,
      limit: 50,
      nextOffset: 1,
    })
    const rootRow: ZoteroBrowseResult = {
      kind: 'collections',
      items: [{ ref: 'zotero://user/0/collection/C1', name: 'Root', path: ['Root'], depth: 0 }],
      ...base,
    }
    expect(browseViewOf(rootRow, 25).items).toEqual([
      {
        kind: 'collection',
        ref: 'zotero://user/0/collection/C1',
        name: 'Root',
        path: ['Root'],
        depth: 0,
      },
    ])
  })

  it('forwards Zotero counts on collection rows and omits them when unreported', () => {
    const counted: ZoteroBrowseResult = {
      kind: 'collections',
      items: [
        {
          ref: 'zotero://user/0/collection/C3',
          name: 'Counted',
          path: ['Counted'],
          depth: 0,
          childCount: 2,
          itemCount: 0,
        },
      ],
      ...base,
    }
    expect(browseViewOf(counted, 50).items).toEqual([
      {
        kind: 'collection',
        ref: 'zotero://user/0/collection/C3',
        name: 'Counted',
        path: ['Counted'],
        depth: 0,
        childCount: 2,
        itemCount: 0,
      },
    ])
  })

  it('tags library and saved-search rows; conditions cross intact', () => {
    const libraries: ZoteroBrowseResult = {
      kind: 'libraries',
      items: [{ library: { type: 'group', id: 5 }, name: 'Lab' }],
      ...base,
    }
    expect(browseViewOf(libraries, 50).items).toEqual([
      { kind: 'library', library: { type: 'group', id: 5 }, name: 'Lab' },
    ])
    const searches: ZoteroBrowseResult = {
      kind: 'savedSearches',
      items: [
        {
          ref: 'zotero://user/0/search/S1',
          name: 'Unread',
          conditions: [{ condition: 'title', operator: 'contains', value: 'x' }],
        },
      ],
      ...base,
    }
    expect(browseViewOf(searches, 50).items).toEqual([
      {
        kind: 'savedSearch',
        ref: 'zotero://user/0/search/S1',
        name: 'Unread',
        conditions: [{ condition: 'title', operator: 'contains', value: 'x' }],
      },
    ])
  })

  it('refuses a tool-only browse kind instead of guessing a row shape', () => {
    const tags: ZoteroBrowseResult = {
      kind: 'itemFields',
      items: [{ field: 'title' }],
      ...base,
    }
    let thrown: unknown
    try {
      browseViewOf(tags, 50)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
  })
})

describe('searchRequestOf', () => {
  const base: ZoteroLibrarySearchRequestView = {
    scope: { kind: 'library' },
    sort: 'title',
    direction: 'asc',
    offset: 0,
    limit: 50,
  }

  it('preserves every panel filter, including false and zero, and copies array fields', () => {
    const view = {
      ...base,
      itemTypes: ['book'],
      tags: ['vision'],
      tagMatch: 'any' as const,
      yearFrom: 0,
      yearTo: 2024,
      hasAttachment: false,
      cacheGeneration: 0,
    }
    const domain = searchRequestOf(view)
    expect(domain).toMatchObject({
      itemTypes: ['book'],
      tags: ['vision'],
      tagMatch: 'any',
      yearFrom: 0,
      yearTo: 2024,
      hasAttachment: false,
    })
    expect(domain.itemTypes).not.toBe(view.itemTypes)
    expect(domain.tags).not.toBe(view.tags)
    // The panel's policy rides the options, not the request.
    expect(searchOptionsOf(view)).toEqual({ includeSupplemental: false, cacheGeneration: 0 })
  })

  it('defaults the mode, drops a blank q, and forwards the rest', () => {
    expect(searchRequestOf(base)).toEqual({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'title',
      direction: 'asc',
      offset: 0,
      limit: 50,
    })
    expect(searchOptionsOf(base)).toEqual({ includeSupplemental: false })
  })

  it('carries library, a non-blank q, the explicit mode, and itemLevel when present', () => {
    expect(
      searchRequestOf({
        ...base,
        library: { type: 'group', id: 3 },
        q: 'flash',
        mode: 'everything',
        itemLevel: 'all',
      }),
    ).toEqual({
      scope: { kind: 'library' },
      library: { type: 'group', id: 3 },
      query: 'flash',
      mode: 'everything',
      sort: 'title',
      direction: 'asc',
      offset: 0,
      limit: 50,
      itemLevel: 'all',
    })
    expect(
      searchOptionsOf({
        ...base,
        library: { type: 'group', id: 3 },
        q: 'flash',
        mode: 'everything',
        itemLevel: 'all',
      }),
    ).toEqual({ includeSupplemental: false })
  })
})

describe('searchViewOf', () => {
  it('mirrors every optional arm of each hit and drops the note supplement', () => {
    const full: ZoteroSearchResult = {
      scope: { kind: 'collection', ref: 'zotero://user/0/collection/C1', name: 'C' },
      items: [
        {
          ref: 'zotero://user/0/item/I1',
          title: 'T',
          creatorSummary: 'A',
          year: 2020,
          itemType: 'journalArticle',
          parentRef: 'zotero://user/0/item/P1',
          bestAttachmentRef: 'zotero://user/0/item/A1',
          bestAttachmentType: 'application/pdf',
          attachmentSize: 1024,
          extra: 'arXiv:1234',
          doi: '10.0/x',
        },
      ],
      total: 9,
      offset: 5,
      returned: 1,
      nextOffset: 6,
      supplemental: { kind: 'noteBody', items: [], scanned: 3, truncated: true },
    }
    expect(searchViewOf(full, 50)).toEqual({
      scope: { kind: 'collection', ref: 'zotero://user/0/collection/C1', name: 'C' },
      items: [
        {
          ref: 'zotero://user/0/item/I1',
          title: 'T',
          creatorSummary: 'A',
          year: 2020,
          itemType: 'journalArticle',
          parentRef: 'zotero://user/0/item/P1',
          bestAttachmentRef: 'zotero://user/0/item/A1',
          bestAttachmentType: 'application/pdf',
          attachmentSize: 1024,
          extra: 'arXiv:1234',
          doi: '10.0/x',
        },
      ],
      total: 9,
      offset: 5,
      returned: 1,
      limit: 50,
      nextOffset: 6,
    })
    const minimal: ZoteroSearchResult = {
      scope: { kind: 'trash', library: { type: 'user', id: 0 } },
      items: [{ ref: 'r', title: 'T', creatorSummary: '', itemType: 'note' }],
      total: 0,
      offset: 0,
      returned: 1,
    }
    expect(searchViewOf(minimal, 20).items).toEqual([
      { ref: 'r', title: 'T', creatorSummary: '', itemType: 'note' },
    ])
    expect('nextOffset' in searchViewOf(minimal, 20)).toBe(false)
    expect('supplemental' in searchViewOf(full, 50)).toBe(false)
  })
})

describe('itemRequestOf', () => {
  it('parses the ref and builds the include set', () => {
    expect(
      itemRequestOf({ ref: 'zotero://user/0/item/ITEMKEY1', include: ['notes', 'annotations'] }),
    ).toEqual({
      ref: { library: { type: 'user', id: 0 }, kind: 'item', key: 'ITEMKEY1' },
      include: new Set(['notes', 'annotations']),
      childPages: {},
    })
  })
})

describe('itemViewOf', () => {
  it('maps sparse child rows and linked attachments without inventing optional fields', () => {
    const detail = itemDetail({
      noteBody: { text: 'Note preview', truncated: true },
      bestAttachment: {
        ref: 'zotero://user/0/item/ATTA0001',
        title: 'Link',
        contentType: 'text/html',
      },
      notes: {
        total: 1,
        returned: 1,
        limit: 50,
        items: [{ ref: 'zotero://user/0/item/NOTE0001', text: 'Note', truncated: false }],
      },
      annotations: {
        total: 1,
        returned: 1,
        limit: 50,
        items: [{ ref: 'zotero://user/0/item/ANNO0001', type: 'highlight', text: 'Highlight' }],
      },
      attachments: {
        total: 2,
        returned: 2,
        limit: 50,
        items: [
          {
            ref: 'zotero://user/0/item/ATTA0001',
            title: 'Local',
            contentType: 'application/pdf',
          },
          { ref: 'zotero://user/0/item/ATTA0002', title: 'Unknown', contentType: 'text/plain' },
        ],
      },
    })
    const view = itemViewOf(detail)
    expect(view.noteBody).toEqual({ text: 'Note preview', truncated: true })
    expect(view.bestAttachment).toEqual({
      ref: 'zotero://user/0/item/ATTA0001',
      title: 'Link',
      contentType: 'text/html',
    })
    expect(view.notes).toMatchObject({
      offset: 0,
      items: [{ ref: 'zotero://user/0/item/NOTE0001', text: 'Note', truncated: false }],
    })
    expect(view.annotations?.items[0]).toEqual({
      ref: 'zotero://user/0/item/ANNO0001',
      type: 'highlight',
      text: 'Highlight',
    })
    expect(view.attachments?.items.map((row) => row.title)).toEqual(['Local', 'Unknown'])
    expect(
      itemViewOf(
        itemDetail({
          bestAttachment: {
            ref: 'zotero://user/0/item/ATTA0001',
            title: 'Unknown',
            contentType: 'text/plain',
          },
        }),
      ).bestAttachment,
    ).toEqual({
      ref: 'zotero://user/0/item/ATTA0001',
      title: 'Unknown',
      contentType: 'text/plain',
    })
  })
  it('mirrors every optional arm across metadata, creators, and child listings', () => {
    const detail: ZoteroItemDetail = {
      ref: 'zotero://user/0/item/I1',
      itemType: 'journalArticle',
      title: 'T',
      creators: [
        { creatorType: 'author', name: 'Org Name' },
        { creatorType: 'editor', firstName: 'F', lastName: 'L' },
      ],
      extra: 'key',
      date: '2020',
      year: 2020,
      venue: 'V',
      doi: '10.0/x',
      url: 'https://example.com',
      abstract: 'A',
      abstractTruncated: true,
      noteBody: { text: 'own note', truncated: true },
      tags: ['t'],
      collections: [
        { ref: 'zotero://user/0/collection/C1', name: 'Named' },
        { ref: 'zotero://user/0/collection/C2' },
      ],
      children: { total: 4 },
      bestAttachment: {
        ref: 'zotero://user/0/item/A1',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        linkMode: 'imported_file',
      },
      notes: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [
          { ref: 'zotero://user/0/item/N1', text: 'n', truncated: false },
          {
            ref: 'zotero://user/0/item/N2',
            text: 'n2',
            truncated: true,
            parentRef: 'zotero://user/0/item/I1',
          },
        ],
      },
      annotations: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            ref: 'zotero://user/0/item/G1',
            type: 'highlight',
            text: 'x',
            comment: 'c',
            color: '#fff',
            pageLabel: '7',
            parentRef: 'zotero://user/0/item/A1',
          },
        ],
      },
      attachments: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            ref: 'zotero://user/0/item/A2',
            title: 'a',
            contentType: 'text/html',
          },
        ],
      },
      relations: [{ predicate: 'dc:relation', targetUri: 'u' }],
      version: 5,
      serverId: 'S1',
    }
    const view: ZoteroItemDetailView = itemViewOf(detail)
    expect(view).toEqual({
      ref: 'zotero://user/0/item/I1',
      itemType: 'journalArticle',
      title: 'T',
      creators: [
        { creatorType: 'author', name: 'Org Name' },
        { creatorType: 'editor', firstName: 'F', lastName: 'L' },
      ],
      extra: 'key',
      date: '2020',
      year: 2020,
      venue: 'V',
      doi: '10.0/x',
      url: 'https://example.com',
      abstract: 'A',
      abstractTruncated: true,
      noteBody: { text: 'own note', truncated: true },
      tags: ['t'],
      collections: [
        { ref: 'zotero://user/0/collection/C1', name: 'Named' },
        { ref: 'zotero://user/0/collection/C2' },
      ],
      children: { total: 4 },
      bestAttachment: {
        ref: 'zotero://user/0/item/A1',
        title: 'paper.pdf',
        contentType: 'application/pdf',
      },
      notes: {
        offset: 0,
        limit: 50,
        total: 1,
        returned: 1,
        items: [
          { ref: 'zotero://user/0/item/N1', text: 'n', truncated: false },
          {
            ref: 'zotero://user/0/item/N2',
            text: 'n2',
            truncated: true,
            parentRef: 'zotero://user/0/item/I1',
          },
        ],
      },
      annotations: {
        offset: 0,
        limit: 50,
        total: 1,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/item/G1',
            type: 'highlight',
            text: 'x',
            comment: 'c',
            color: '#fff',
            pageLabel: '7',
            parentRef: 'zotero://user/0/item/A1',
          },
        ],
      },
      attachments: {
        offset: 0,
        limit: 50,
        total: 1,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/item/A2',
            title: 'a',
            contentType: 'text/html',
          },
        ],
      },
    })
    expect('relations' in view).toBe(false)
    expect('version' in view).toBe(false)
    expect('serverId' in view).toBe(false)
  })

  it('fails loud when a paged child collection reaches the view without page metadata', () => {
    // The panel's item endpoint always pages; a child collection without
    // `limit` means an unpaged domain record reached the wire view, which is
    // a host bug the client cannot page by.
    const detail: ZoteroItemDetail = {
      ref: 'r',
      itemType: 'journalArticle',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 1 },
      notes: { total: 1, returned: 1, items: [] },
    }
    expect(() => itemViewOf(detail)).toThrow('without page metadata')
  })

  it('keeps unrequested child sets and host-only facts absent on the sparse arm', () => {
    const sparse: ZoteroItemDetail = {
      ref: 'r',
      itemType: 'note',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
    }
    const view = itemViewOf(sparse)
    expect(view).toEqual({
      ref: 'r',
      itemType: 'note',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
    })
    for (const key of [
      'extra',
      'date',
      'year',
      'venue',
      'doi',
      'url',
      'abstract',
      'noteBody',
      'bestAttachment',
      'notes',
      'annotations',
      'attachments',
    ]) {
      expect(key in view).toBe(false)
    }
  })
})

describe('exportViewOf', () => {
  it('maps the citation arm and carries resolved style/locale', () => {
    const result: ZoteroExportTextResult = {
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [{ ref: 'r', text: '(Doe, 2020)' }],
    }
    expect(exportViewOf(result)).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [{ ref: 'r', text: '(Doe, 2020)' }],
    })
  })

  it('maps the bibliography arm and keeps absent style/locale absent', () => {
    const result: ZoteroExportTextResult = { format: 'bibliography', text: '[1] Doe.' }
    const view = exportViewOf(result)
    expect(view).toEqual({ format: 'bibliography', text: '[1] Doe.' })
    expect('style' in view).toBe(false)
    expect('locale' in view).toBe(false)
  })

  it('maps the translator arm as the opaque body only, never itemizing', () => {
    const result: ZoteroExportTextResult = {
      format: 'bibtex',
      style: 'apa',
      locale: 'en-US',
      text: '@article{doe2020}',
    }
    const view = exportViewOf(result)
    expect(view).toEqual({
      format: 'bibtex',
      style: 'apa',
      locale: 'en-US',
      text: '@article{doe2020}',
    })
    expect('items' in view).toBe(false)
  })
})
