import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-batch.js'

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
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('batchItems update and delete', () => {
  it('refuses two spellings of the same delete target before reading the graph or writing', async () => {
    await expect(
      batchItems(writeDeps(mock).deps, {
        delete: [ITEM_REF, { ...ITEM_REF, serverId: SERVER_ID }],
      }),
    ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
    expect(mock.requests.filter(({ pathname }) => pathname !== '/api/')).toEqual([])
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

  it('rejects an empty item update before reading or writing', async () => {
    const { deps } = writeDeps(mock)
    await expect(
      batchItems(deps, {
        update: [{ ref: ITEM_REF }],
      }),
    ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
    expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0)
  })

  it('puts an item update with a missing receipt in unverified without retrying', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)
    serveItemRead(mock, {
      key: ITEM_KEY,
      data: { itemType: 'journalArticle', tags: [] },
      version: 4,
    })
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID }, ''),
    )
    const result = await batchItems(deps, { update: [{ ref: ITEM_REF, addTags: ['new'] }] })
    expect(result.updated).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.unverified).toMatchObject([
      { op: 'update', reason: 'receipt-unknown', retryable: false, ref: expect.any(String) },
    ])
    expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1)
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

  it('isolates failures on a single item into the failed bucket without aborting other operations', async () => {
    const { deps } = writeDeps(mock)
    grantAuthorize(mock)

    // First update succeeds
    serveItemRead(mock, {
      key: 'OK000001',
      data: { itemType: 'journalArticle', tags: [] },
      version: 1,
    })
    // Second update fails with 412 version conflict
    serveItemRead(mock, {
      key: 'FAIL0001',
      data: { itemType: 'journalArticle', tags: [] },
      version: 1,
    })
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
      expect(JSON.parse(mock.requests.at(-1)!.body)).toEqual([
        { key: 'OK000001', version: 1, tags: [{ tag: 'tag1' }] },
        { key: 'FAIL0001', version: 1, tags: [{ tag: 'tag2' }] },
      ])
      helpers.json(
        {
          successful: { '0': itemJson('OK000001', 2, { tags: [{ tag: 'tag1' }] }) },
          success: { '0': 'OK000001' },
          unchanged: {},
          failed: { '1': { key: 'FAIL0001', code: 412, message: 'Version mismatch' } },
        },
        batchHeaders(2),
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

    expect(result.kind).toBe('partial')
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]?.ref).toBe(`zotero://user/0/item/OK000001?server=${SERVER_ID}`)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.op).toBe('update')
    expect(result.failed[0]?.ref).toBe(`zotero://user/0/item/FAIL0001?server=${SERVER_ID}`)
    expect(result.failed[0]?.code).toBe('ZOTERO_WRITE_CONFLICT')
  })
})
