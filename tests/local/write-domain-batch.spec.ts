import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../src/local/write-domain.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  writeListTooLongMessage,
  ZOTERO_INVALID_ARGUMENT,
} from '../../src/errors.js'
import {
  batchHeaders,
  COLLECTION_KEY,
  grantAuthorize,
  itemJson,
  ITEM_KEY,
  ITEM_REF,
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../helpers/mock-zotero.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('batchItems domain operations', () => {
  it('refuses an empty request with no operations before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(batchItems(deps, {})).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: WRITE_LIST_SELECTION_MESSAGE,
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses batch operations exceeding 50 entries', async () => {
    const { deps } = writeDeps(mock)
    const deletes = Array.from({ length: 51 }, (_, i) => ({
      library: { type: 'user' as const, id: 0 as const },
      kind: 'item' as const,
      key: `DEL000${i}`,
      serverId: SERVER_ID,
    }))
    await expect(batchItems(deps, { delete: deletes })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeListTooLongMessage('batch items', 50),
    })
  })

  it('executes a pure batch create via native POST batch', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)

    let sentEntries: unknown[] = []
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
      sentEntries = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '[]') as unknown[]
      helpers.raw(
        200,
        batchHeaders(25),
        JSON.stringify({
          successful: {
            '0': itemJson('BATCH001', 25, { itemType: 'journalArticle', title: 'Paper 1' }),
            '1': itemJson('BATCH002', 25, { itemType: 'book', title: 'Book 2' }),
          },
          success: { '0': 'BATCH001', '1': 'BATCH002' },
          unchanged: {},
          failed: {},
        }),
      )
    })

    const result = await batchItems(deps, {
      create: [
        { itemType: 'journalArticle', title: 'Paper 1', tags: ['ml'] },
        { itemType: 'book', title: 'Book 2' },
      ],
    })

    expect(result.kind).toBe('applied')
    expect(result.failed).toHaveLength(0)
    expect(result.total).toBe(2)
    expect(result.created).toHaveLength(2)
    expect(result.created[0]?.ref).toBe(`zotero://user/0/item/BATCH001?server=${SERVER_ID}`)
    expect(result.created[1]?.ref).toBe(`zotero://user/0/item/BATCH002?server=${SERVER_ID}`)
    expect(result.libraryVersion).toBe(25)
    expect(sentEntries).toHaveLength(2)
  })

  it('executes batch item updates for tags and collections sequentially', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)

    // Serve read for ITEM_KEY
    serveItemRead(mock, {
      key: ITEM_KEY,
      data: {
        itemType: 'journalArticle',
        title: 'Existing Paper',
        tags: [{ tag: 'old-tag' }],
        collections: [COLLECTION_KEY],
      },
      version: 4,
    })

    let patchBody: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) => {
      patchBody = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(
        204,
        {
          'Last-Modified-Version': '5',
          'Zotero-Server-ID': SERVER_ID,
        },
        '',
      )
    })

    const result = await batchItems(deps, {
      update: [
        {
          ref: ITEM_REF,
          addTags: ['new-tag'],
          removeTags: ['old-tag'],
          addCollections: ['Second'],
          removeCollections: [
            {
              library: { type: 'user', id: 0 },
              kind: 'collection',
              key: COLLECTION_KEY,
              serverId: SERVER_ID,
            },
          ],
        },
      ],
    })

    expect(result.kind).toBe('applied')
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]?.unchanged).toBe(false)
    expect(result.updated[0]?.addedTags).toEqual(['new-tag'])
    expect(result.updated[0]?.removedTags).toEqual(['old-tag'])
    expect(result.libraryVersion).toBe(5)
    expect(patchBody).toBeDefined()
    expect(patchBody?.tags).toEqual([{ tag: 'new-tag' }])
    expect(patchBody?.collections).toEqual([SECOND_COLLECTION_KEY])
    expect(result.updated[0]?.addedCollections).toEqual([
      `zotero://user/0/collection/${SECOND_COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(result.updated[0]?.removedCollections).toEqual([
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
  })

  it('serializes every create field and resolves string and ref collection destinations', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)
    let sentEntries: unknown
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
      sentEntries = JSON.parse(mock.requests.at(-1)?.body ?? 'null')
      helpers.raw(
        200,
        batchHeaders(26),
        JSON.stringify({
          successful: {
            '0': itemJson('FULLITM1', 26, { itemType: 'book', title: 'Complete book' }),
            '1': itemJson('FULLITM2', 26, { itemType: 'webpage', url: 'https://example.org' }),
          },
          success: { '0': 'FULLITM1', '1': 'FULLITM2' },
          unchanged: {},
          failed: {},
        }),
      )
    })
    const collectionRef = {
      library: { type: 'user' as const, id: 0 as const },
      kind: 'collection' as const,
      key: COLLECTION_KEY,
      serverId: SERVER_ID,
    }

    const result = await batchItems(deps, {
      create: [
        {
          itemType: 'book',
          title: 'Complete book',
          url: 'https://example.org/book',
          date: '2026',
          doi: '10.1000/example',
          abstractNote: 'Abstract',
          publicationTitle: 'Publisher',
          creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
          tags: ['reviewed'],
          collections: ['Second'],
        },
        { itemType: 'webpage', url: 'https://example.org', collections: [collectionRef] },
      ],
    })

    expect(sentEntries).toEqual([
      {
        itemType: 'book',
        title: 'Complete book',
        url: 'https://example.org/book',
        date: '2026',
        DOI: '10.1000/example',
        abstractNote: 'Abstract',
        publicationTitle: 'Publisher',
        creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
        tags: [{ tag: 'reviewed' }],
        collections: [SECOND_COLLECTION_KEY],
      },
      { itemType: 'webpage', url: 'https://example.org', collections: [COLLECTION_KEY] },
    ])
    expect(result.failed).toEqual([])
    expect(result.unverified).toEqual([])
    expect(result.created.map(({ index, url, title }) => ({ index, url, title }))).toEqual([
      { index: 0, title: 'Complete book', url: undefined },
      { index: 1, title: undefined, url: 'https://example.org' },
    ])
  })

  it('settles an unchanged collection-only update without a PATCH', async () => {
    const { deps } = writeDeps(mock)
    serveItemRead(mock, {
      key: ITEM_KEY,
      data: { itemType: 'journalArticle', tags: [], collections: [COLLECTION_KEY] },
      version: 4,
    })
    const result = await batchItems(deps, {
      update: [{ ref: ITEM_REF, addCollections: ['方法论'] }],
    })
    expect(result.updated).toMatchObject([{ unchanged: true, addedCollections: [] }])
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('executes batch item deletions sequentially with version preconditions', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)

    let trashed = false
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
      helpers.json(
        itemJson(ITEM_KEY, trashed ? 10 : 9, { deleted: trashed ? 1 : 0 }),
        batchHeaders(trashed ? 10 : 9),
      ),
    )
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}/children`, (_req, _res, helpers) =>
      helpers.json([], { ...batchHeaders(9), 'Total-Results': '0' }),
    )

    let deleteVersionHeader: string | null = null
    let patch: unknown
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (req, _res, helpers) => {
      deleteVersionHeader = (req.headers['if-unmodified-since-version'] as string) ?? null
      patch = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}')
      trashed = true
      helpers.raw(
        204,
        {
          'Last-Modified-Version': '10',
          'Zotero-Server-ID': SERVER_ID,
        },
        '',
      )
    })

    const result = await batchItems(deps, {
      delete: [ITEM_REF],
    })

    expect(result.kind).toBe('applied')
    expect(result.deleted).toHaveLength(1)
    expect(result.deleted[0]?.key).toBe(ITEM_KEY)
    expect(patch).toEqual({ deleted: 1 })
    expect(deleteVersionHeader).toBe('9')
    expect(result.libraryVersion).toBe(10)
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('executes a mixed batch (create, update, delete) in a single turn', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)

    // 1. Create handler
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
      helpers.raw(
        200,
        batchHeaders(11),
        JSON.stringify({
          successful: {
            '0': itemJson('NEWITEM1', 11, { itemType: 'journalArticle', title: 'New' }),
          },
          success: { '0': 'NEWITEM1' },
          unchanged: {},
          failed: {},
        }),
      )
    })

    // 2. Read for update
    serveItemRead(mock, {
      key: 'UPDATEK1',
      data: { itemType: 'journalArticle', tags: [] },
      version: 11,
    })

    // Update patch
    mock.route('PATCH', '/api/users/0/items/UPDATEK1', (_req, _res, helpers) => {
      helpers.raw(
        204,
        {
          'Last-Modified-Version': '12',
          'Zotero-Server-ID': SERVER_ID,
        },
        '',
      )
    })

    // 3. Read for delete
    let trashed = false
    mock.route('GET', '/api/users/0/items/DELETEK1', (_req, _res, helpers) =>
      helpers.json(
        itemJson('DELETEK1', trashed ? 13 : 12, { deleted: trashed ? 1 : 0 }),
        batchHeaders(trashed ? 13 : 12),
      ),
    )
    mock.route('GET', '/api/users/0/items/DELETEK1/children', (_req, _res, helpers) =>
      helpers.json([], { ...batchHeaders(12), 'Total-Results': '0' }),
    )

    // Delete handler
    mock.route('PATCH', '/api/users/0/items/DELETEK1', (_req, _res, helpers) => {
      trashed = true
      helpers.raw(
        204,
        {
          'Last-Modified-Version': '13',
          'Zotero-Server-ID': SERVER_ID,
        },
        '',
      )
    })

    const result = await batchItems(deps, {
      create: [{ itemType: 'journalArticle', title: 'New' }],
      update: [
        {
          ref: {
            library: { type: 'user', id: 0 },
            kind: 'item',
            key: 'UPDATEK1',
            serverId: SERVER_ID,
          },
          addTags: ['tagged'],
        },
      ],
      delete: [
        { library: { type: 'user', id: 0 }, kind: 'item', key: 'DELETEK1', serverId: SERVER_ID },
      ],
    })

    expect(result.kind).toBe('applied')
    expect(result.total).toBe(3)
    expect(result.created).toHaveLength(1)
    expect(result.updated).toHaveLength(1)
    expect(result.deleted).toHaveLength(1)
    expect(result.unverified).toEqual([])
    expect(result.libraryVersion).toBe(13)
  })

  it('isolates failures on a single item into the failed bucket without aborting other operations', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)

    // First update succeeds
    serveItemRead(mock, {
      key: 'OK000001',
      data: { itemType: 'journalArticle', tags: [] },
      version: 1,
    })
    mock.route('PATCH', '/api/users/0/items/OK000001', (_req, _res, helpers) => {
      helpers.raw(
        204,
        {
          'Last-Modified-Version': '2',
          'Zotero-Server-ID': SERVER_ID,
        },
        '',
      )
    })

    // Second update fails with 412 version conflict
    serveItemRead(mock, {
      key: 'FAIL0001',
      data: { itemType: 'journalArticle', tags: [] },
      version: 1,
    })
    mock.route('PATCH', '/api/users/0/items/FAIL0001', (_req, _res, helpers) => {
      helpers.raw(
        412,
        {
          'Zotero-Server-ID': SERVER_ID,
        },
        'Precondition Failed: version mismatch',
      )
    })

    const result = await batchItems(deps, {
      update: [
        {
          ref: {
            library: { type: 'user', id: 0 },
            kind: 'item',
            key: 'OK000001',
            serverId: SERVER_ID,
          },
          addTags: ['tag1'],
        },
        {
          ref: {
            library: { type: 'user', id: 0 },
            kind: 'item',
            key: 'FAIL0001',
            serverId: SERVER_ID,
          },
          addTags: ['tag2'],
        },
      ],
    })

    expect(result.kind).toBe('applied')
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]?.ref).toBe(`zotero://user/0/item/OK000001?server=${SERVER_ID}`)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.op).toBe('update')
    expect(result.failed[0]?.ref).toBe(`zotero://user/0/item/FAIL0001?server=${SERVER_ID}`)
    expect(result.failed[0]?.code).toBe('ZOTERO_WRITE_CONFLICT')
  })
})
