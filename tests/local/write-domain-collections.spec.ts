import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToCollection } from '../../src/local/write-domain.js'
import {
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
  writeObjectRefusedMessage,
  writeObjectStateMissingMessage,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_UNAUTHORIZED,
} from '../../src/errors.js'
import {
  batchBody,
  batchHeaders,
  COLLECTION_KEY,
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
  LIMITS,
  NEW_KEY,
  resolveThrough,
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  SOURCE_REF,
  startWriteDomainMock,
  writeDeps,
  expectApplied,
} from '../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../helpers/mock-zotero.js'
import { parseRef } from '../../src/refs.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('addToCollection', () => {
  function serveItem(collections: string[]): void {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { collections })),
      ),
    )
  }

  it('refuses a resolved collection ref from another Zotero instance', async () => {
    const staleCollection = parseRef(
      `zotero://user/0/collection/${COLLECTION_KEY}?server=OTHER1234`,
    )
    const { deps } = writeDeps(mock)
    await expect(
      addToCollection(deps, async () => staleCollection, {
        item: ITEM_REF,
        collection: 'stale',
      }),
    ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
  it('fails before PATCH when the item read omits or malforms existing collections', async () => {
    let collections: unknown
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, collections === undefined ? {} : { collections })),
      ),
    )
    for (const value of [undefined, [42]]) {
      collections = value
      const { deps } = writeDeps(mock)
      await expect(
        addToCollection(
          deps,
          async () => parseRef(`zotero://user/0/collection/${COLLECTION_KEY}`),
          {
            item: ITEM_REF,
            collection: 'target',
          },
        ),
      ).rejects.toMatchObject({
        code: ZOTERO_UNEXPECTED,
        message: writeObjectStateMissingMessage('collections'),
      })
      expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
    }
  })
  it('adds the collection by name under the version precondition', async () => {
    grantAuthorize(mock)
    serveItem([])
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '13' }, '')
    })
    const { deps, directory } = writeDeps(mock)
    const result = await addToCollection(deps, resolveThrough(directory), {
      item: ITEM_REF,
      collection: '方法论',
    })
    expect(result.added).toBe(true)
    expect(result.collections).toEqual([
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(result.version).toBe(13)
    expect(body).toEqual({ collections: [COLLECTION_KEY] })
  })
  it('reports an existing membership without writing', async () => {
    serveItem([COLLECTION_KEY])
    const { deps, directory } = writeDeps(mock)
    const result = await addToCollection(deps, resolveThrough(directory), {
      item: ITEM_REF,
      collection: `zotero://user/0/collection/${COLLECTION_KEY}`,
    })
    expect(result.added).toBe(false)
    expect(result.version).toBe(10)
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
  it('fails a collection name that resolves to nothing before any read-modify-write', async () => {
    const { deps, directory } = writeDeps(mock)
    let code: string | undefined
    try {
      await addToCollection(deps, resolveThrough(directory), {
        item: ITEM_REF,
        collection: 'no such collection',
      })
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe(ZOTERO_NOT_FOUND)
    expect(
      mock.requests.some((request) => request.pathname === `/api/users/0/items/${ITEM_KEY}`),
    ).toBe(false)
  })
})
