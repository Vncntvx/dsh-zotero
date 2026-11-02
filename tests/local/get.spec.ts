/**
 * The `zotero_get` provider contract: item detail with lazy children and
 * collection names, and attachment resolution to verified on-disk files or
 * linked URLs.
 * @module tests/provider/get
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED } from '../../src/errors.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { expectedKindRefMessage, parseRef } from '../../src/refs.js'
import type { ZoteroGetRequest } from '../../src/types.js'
import {
  createProvider,
  getRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import {
  expectRequestCount,
  expectRequestLines,
  requestLines,
  zoteroError,
} from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  COLLECTION_KEY,
  ITEM_KEY,
  SECOND_ITEM_KEY,
  apiPath,
  attachmentRef,
  collectionRef,
  itemRef,
} from '../helpers/server/keys.js'
import {
  annotationRow,
  attachment,
  collectionRow,
  item,
  noteRow,
  paperItem,
  versionHeaders,
} from '../helpers/server/objects.js'
import { serveItemGraph, serveJson } from '../helpers/server/serve.js'
import { deferred } from '../helpers/sync.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProvider
let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
  provider = harness.provider
})

afterEach(async () => {
  await teardownProvider(harness)
})

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
}

/** The paper as the detail reads see it: one tag, one collection, two children. */
const PARENT = paperItem({
  meta: { numChildren: 2 },
  data: { tags: [{ tag: 'attention' }], collections: [COLLECTION_KEY] },
})

/** The same paper with no collection membership, for the reads that must skip the listing. */
const PARENT_WITHOUT_COLLECTIONS = paperItem({
  meta: { numChildren: 2 },
  data: { tags: [{ tag: 'attention' }] },
})

/** The canonical PDF as the location reads see it. */

describe('getItem', () => {
  it('passes an independent offset and limit to every requested child lane', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS, versionHeaders())
    mock.route(
      'GET',
      `${apiPath()}/items/${ITEM_KEY}/children`,
      (_request, _response, helpers, search) => {
        const kind = search.get('itemType')
        if (kind === 'note') {
          expect(search.get('start')).toBe('0')
          expect(search.get('limit')).toBe('1')
          helpers.json([noteRow()], { 'Total-Results': '2', 'Zotero-Server-ID': 'S1' })
        } else if (kind === 'attachment') {
          expect(search.get('start')).toBe('1')
          expect(search.get('limit')).toBe('2')
          helpers.json([], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
        } else {
          expect(kind).toBe('annotation')
          helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' })
        }
      },
    )
    const detail = await provider.getItem({
      ...getRequest(['notes', 'attachments', 'annotations']),
      childPages: {
        notes: { offset: 0, limit: 1 },
        attachments: { offset: 1, limit: 2 },
        annotations: { offset: 0, limit: 2 },
      },
    } as ZoteroGetRequest & { childPages: NonNullable<ZoteroGetRequest['childPages']> })
    expect(detail.notes).toMatchObject({ total: 2, returned: 1, offset: 0, nextOffset: 1 })
    expect(detail.attachments).toMatchObject({ total: 1, returned: 0, offset: 1 })
    expect(detail.annotations).toMatchObject({ total: 0, returned: 0, offset: 0 })
  })

  it('clamps a paged child lane to the configured record cap and reports the effective limit', async () => {
    const notes = Array.from({ length: 5 }, (_, i) =>
      noteRow({ key: `NOTE${String(i).padStart(4, '0')}`, data: { note: `note ${i}` } }),
    )
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS, versionHeaders())
    mock.route(
      'GET',
      `${apiPath()}/items/${ITEM_KEY}/children`,
      (_request, _response, helpers, search) => {
        // The panel asked for a 50-row page; the configured cap narrows it,
        // and the answer's `limit` tells the client what it must page by.
        expect(search.get('start')).toBe('0')
        expect(search.get('limit')).toBe('5')
        helpers.json(notes, { 'Total-Results': '12', 'Zotero-Server-ID': 'S1' })
      },
    )
    const capped = makeProvider({ maxNoteRecords: 5 })
    const detail = await capped.getItem({
      ...getRequest(['notes']),
      childPages: { notes: { offset: 0, limit: 50 } },
    } as ZoteroGetRequest & { childPages: NonNullable<ZoteroGetRequest['childPages']> })
    expect(detail.notes).toMatchObject({
      total: 12,
      returned: 5,
      offset: 0,
      limit: 5,
      nextOffset: 5,
    })
  })

  it('fetches only the parent when nothing is included', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS, versionHeaders())
    const detail = await provider.getItem(getRequest())
    expectRequestLines(mock, ['/api/users/0/items/ABCD1234'])
    expect(detail.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(detail.children.total).toBe(2)
    expect(detail.notes).toBeUndefined()
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: '',
      contentType: 'application/pdf',
    })
  })

  it('fetches children lazily and resolves collection names once', async () => {
    serveItemGraph(mock, {
      parent: PARENT,
      children: [noteRow(), attachment()],
      annotations: [annotationRow()],
      collections: [collectionRow()],
    })
    const detail = await provider.getItem(getRequest(['notes', 'annotations', 'attachments']))
    // Parent first; the two children contracts and the collections listing
    // are independent once the parent has arrived.
    const lines = requestLines(mock)
    expect(lines[0]).toBe('/api/users/0/items/ABCD1234')
    expect(lines.slice(1).sort()).toEqual(
      [
        '/api/users/0/items/ABCD1234/children?start=0&limit=100',
        '/api/users/0/items/ABCD1234/children?itemType=annotation&start=0&limit=100',
        '/api/users/0/collections',
      ].sort(),
    )
    expect(detail.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' },
    ])
    expect(detail.notes).toEqual({
      completeness: 'complete',
      total: 1,
      returned: 1,
      items: [
        { ref: 'zotero://user/0/item/NOTE1111?server=S1', text: 'my note', truncated: false },
      ],
    })
    expect(detail.annotations!.total).toBe(1)
    expect(detail.annotations!.items[0]).toMatchObject({
      ref: 'zotero://user/0/annotation/ANNO1111?server=S1',
      parentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
    })
    expect(detail.attachments!.items[0]!.title).toBe('Full Text PDF')
    expect(detail.bestAttachment!.title).toBe('Full Text PDF')
  })

  it('skips the collections listing for items without collections', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS)
    await provider.getItem(getRequest())
    expectRequestLines(mock, ['/api/users/0/items/ABCD1234'])
  })

  it('reads no bare children listing when only annotations were asked for', async () => {
    // Annotations ride their own filtered contract, so the unfiltered
    // children request would fetch notes and attachments this call never
    // returns. Asking for annotations alone must not pay for that page.
    serveItemGraph(mock, {
      parent: PARENT,
      children: [noteRow(), attachment()],
      annotations: [annotationRow()],
      collections: [collectionRow()],
    })
    const detail = await provider.getItem(getRequest(['annotations']))
    expect(requestLines(mock)).not.toContain(
      '/api/users/0/items/ABCD1234/children?start=0&limit=100',
    )
    expect(requestLines(mock)).toContain(
      '/api/users/0/items/ABCD1234/children?itemType=annotation&start=0&limit=100',
    )
    expect(detail.annotations!.total).toBe(1)
    expect(detail.notes).toBeUndefined()
    expect(detail.attachments).toBeUndefined()
  })

  it('does not count annotations into children.total when numChildren is absent', async () => {
    serveItemGraph(mock, {
      parent: item({ meta: {} }),
      children: [],
      annotations: [annotationRow()],
      collections: [],
    })
    const detail = await provider.getItem(getRequest(['annotations']))
    expect(detail.annotations!.total).toBe(1)
    expect(detail.children.total).toBe(0)
  })

  it('leaves collection names off when the listing lacks them', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT)
    serveJson(mock, `${apiPath()}/collections`, [
      collectionRow({ key: 'COLL9999', data: { name: 'Other' } }),
    ])
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })

  it('fails loud with UNEXPECTED on a non-array children response', async () => {
    // A non-array body is a contract breach, not an empty page: folding it to
    // `[]` would silently under-report children on every item detail.
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS)
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, { key: 'NOTE1111' })
    await zoteroError(provider.getItem(getRequest(['notes'])), ZOTERO_UNEXPECTED)
  })

  it('reads every requested child lane as one batch', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS, versionHeaders())
    let inFlight = 0
    let peak = 0
    const release = deferred()
    mock.route(
      'GET',
      `${apiPath()}/items/${ITEM_KEY}/children`,
      async (_request, _response, helpers) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        if (inFlight === 3) release.resolve()
        await release.promise
        inFlight--
        helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' })
      },
    )
    const detail = await provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(['notes', 'attachments', 'annotations']),
      childPages: {
        notes: { offset: 0, limit: 10 },
        attachments: { offset: 0, limit: 10 },
        annotations: { offset: 0, limit: 10 },
      },
    })
    // The three listings are independent; all three requests must be in
    // flight before any of them is answered.
    expect(peak).toBe(3)
    expect(detail.notes).toMatchObject({ returned: 0 })
  })

  it('names an unconfirmed attachment target instead of a blank item type', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}`,
      { key: ATTACHMENT_KEY, data: { title: 'Mystery' } },
      versionHeaders(),
    )
    await zoteroError(
      provider.getItem({ ref: parseRef(attachmentRef()), include: new Set() }),
      ZOTERO_INVALID_ARGUMENT,
      'could not be confirmed as an attachment',
    )
  })

  it('reads full bodies independently of configured page caps', async () => {
    const notes = Array.from({ length: 7 }, (_, i) =>
      noteRow({ key: `NOTE${String(i).padStart(4, '0')}`, data: { note: `note ${i}` } }),
    )
    const annotations = Array.from({ length: 3 }, (_, i) =>
      annotationRow({
        key: `ANNO${String(i).padStart(4, '0')}`,
        data: {
          annotationText: `a ${i}`,
          annotationSortIndex: String(i).padStart(5, '0'),
          parentItem: ATTACHMENT_KEY,
        },
      }),
    )
    serveItemGraph(mock, {
      parent: PARENT_WITHOUT_COLLECTIONS,
      children: [...notes, attachment()],
      annotations,
      collections: null,
      attachmentItem: null,
    })
    const capped = makeProvider({ maxNoteRecords: 2, maxAnnotationRecords: 1, maxNoteChars: 5 })
    const detail = await capped.getItem(getRequest(['notes', 'annotations']))
    expect(detail.notes).toMatchObject({ total: 7, returned: 7 })
    expect(detail.notes!.items[0]).toMatchObject({ text: 'note 0', truncated: false })
    // The merged annotation corpus is capped as one collection.
    expect(detail.annotations).toMatchObject({ total: 3, returned: 3 })
  })

  it('passes unconsumed data fields through under fields:"all"', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ITEM_KEY}`,
      item({
        data: {
          itemType: 'dataset',
          title: 'Attention Is All You Need — replication data',
          repository: 'Zenodo',
          versionNumber: 2,
          archive: 'arXiv',
          libraryCatalog: 'Zotero',
          customField: { nested: ['a', 1, true] },
        },
      }),
    )
    const all = await provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(),
      fields: 'all',
    })
    // Consumed keys never leak into extraFields; unknown ones survive verbatim.
    expect(all.extraFields).toEqual({
      archive: 'arXiv',
      customField: { nested: ['a', 1, true] },
      libraryCatalog: 'Zotero',
      repository: 'Zenodo',
      versionNumber: 2,
    })
    const standard = await provider.getItem(getRequest())
    expect(standard.extraFields).toBeUndefined()
  })

  it('reuses the cached collections listing across items', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT)
    serveJson(
      mock,
      `${apiPath()}/items/${SECOND_ITEM_KEY}`,
      paperItem({
        key: SECOND_ITEM_KEY,
        meta: { numChildren: 2 },
        data: {
          key: SECOND_ITEM_KEY,
          tags: [{ tag: 'attention' }],
          collections: [COLLECTION_KEY],
        },
      }),
    )
    serveJson(mock, `${apiPath()}/collections`, [collectionRow()])
    const first = await provider.getItem(getRequest())
    const second = await provider.getItem({
      ref: parseRef(itemRef(SECOND_ITEM_KEY)),
      include: new Set(),
    })
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(1)
    expect(first.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234', name: 'LLM Papers' },
    ])
    expect(second.collections).toEqual(first.collections)
  })

  it('rejects non-item and non-attachment refs before any request happens', async () => {
    await zoteroError(
      provider.getItem({
        ref: parseRef(collectionRef()),
        include: new Set(),
      }),
      'ZOTERO_INVALID_REF',
      expectedKindRefMessage(['item', 'attachment'], 'collection'),
    )
    expectRequestCount(mock, 0)
  })
})

describe('getItem collections edge cases', () => {
  it('fails loud on a non-array collections listing', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT)
    serveJson(mock, `${apiPath()}/collections`, { key: 'COLL1234' })
    await zoteroError(provider.getItem(getRequest()), 'ZOTERO_UNEXPECTED', 'non-array body')
  })
})
