import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-batch.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  writeListTooLongMessage,
  ZOTERO_INVALID_ARGUMENT,
} from '../../../src/errors.js'
import {
  batchHeaders,
  COLLECTION_KEY,
  grantAuthorize,
  itemJson,
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

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
            '0': itemJson('BATCH001', 25, {
              itemType: 'journalArticle',
              title: 'Paper 1',
              tags: [{ tag: 'ml' }],
            }),
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

  it('archives a batch create transport refusal as per-index failures', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) =>
      helpers.raw(400, { 'Content-Type': 'text/plain', 'Zotero-Server-ID': SERVER_ID }, 'bad item'),
    )
    const result = await batchItems(deps, {
      create: [
        { itemType: 'book', title: 'First' },
        { itemType: 'book', title: 'Second' },
      ],
    })
    expect(result.created).toEqual([])
    expect(result.unverified).toEqual([])
    expect(result.failed).toMatchObject([
      { op: 'create', index: 0, code: 'ZOTERO_INVALID_ARGUMENT' },
      { op: 'create', index: 1, code: 'ZOTERO_INVALID_ARGUMENT' },
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
            '0': itemJson('FULLITM1', 26, {
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
            }),
            '1': itemJson('FULLITM2', 26, {
              itemType: 'webpage',
              url: 'https://example.org',
              collections: [COLLECTION_KEY],
            }),
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
      { index: 0, title: 'Complete book', url: 'https://example.org/book' },
      { index: 1, title: undefined, url: 'https://example.org' },
    ])
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
})
