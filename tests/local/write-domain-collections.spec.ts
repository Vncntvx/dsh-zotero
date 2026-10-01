import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateItemCollections } from '../../src/local/write-domain.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  writeNonBlankMessage,
  writeObjectStateMissingMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
} from '../../src/errors.js'
import {
  COLLECTION_KEY,
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
  expectApplied,
} from '../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../helpers/mock-zotero.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('updateItemCollections', () => {
  it('refuses a collection ref claiming another Zotero instance', async () => {
    const { deps } = writeDeps(mock)
    await expect(
      updateItemCollections(deps, {
        item: ITEM_REF,
        add: [`zotero://user/0/collection/${COLLECTION_KEY}?server=OTHER1234`],
      }),
    ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
    expect(mock.requests.some((request) => request.pathname.includes(`/items/${ITEM_KEY}`))).toBe(
      false,
    )
  })

  it('refuses a selection-free request before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(updateItemCollections(deps, { item: ITEM_REF })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: WRITE_LIST_SELECTION_MESSAGE,
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses blank entries in add or remove before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(
      updateItemCollections(deps, { item: ITEM_REF, add: ['  '] }),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('add'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('adds the collection by name under the version precondition', async () => {
    grantAuthorize(mock)
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { tags: [], collections: [] })),
      ),
    )
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '13' }, '')
    })
    const { deps } = writeDeps(mock)
    const result = await updateItemCollections(deps, {
      item: ITEM_REF,
      add: ['方法论'],
    })
    expectApplied(result)
    expect(result.added).toEqual([
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(result.removed).toEqual([])
    expect(result.unchanged).toBe(false)
    expect(result.version).toBe(13)
    expect(result.libraryVersion).toBe(13)
    expect(body).toEqual({ collections: [COLLECTION_KEY] })
    const patch = mock.requests.find((request) => request.method === 'PATCH')
    expect(patch?.headers['if-unmodified-since-version']).toBe('10')
  })

  it('removes a collection by name under the version precondition', async () => {
    grantAuthorize(mock)
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(
          itemJson(ITEM_KEY, 10, {
            tags: [],
            collections: [COLLECTION_KEY, SECOND_COLLECTION_KEY],
          }),
        ),
      ),
    )
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '14' }, '')
    })
    const { deps } = writeDeps(mock)
    const result = await updateItemCollections(deps, {
      item: ITEM_REF,
      remove: ['Second'],
    })
    expectApplied(result)
    expect(result.collections).toEqual([
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(result.removed).toEqual([
      `zotero://user/0/collection/${SECOND_COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(body).toEqual({ collections: [COLLECTION_KEY] })
  })

  it('reports an existing membership without writing', async () => {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { tags: [], collections: [COLLECTION_KEY] })),
      ),
    )
    const { deps } = writeDeps(mock)
    const result = await updateItemCollections(deps, {
      item: ITEM_REF,
      add: [`zotero://user/0/collection/${COLLECTION_KEY}`],
    })
    expectApplied(result)
    expect(result.unchanged).toBe(true)
    expect(result.version).toBe(10)
    expect(result.libraryVersion).toBeUndefined()
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('fails a collection name that resolves to nothing before any read-modify-write', async () => {
    const { deps } = writeDeps(mock)
    let code: string | undefined
    try {
      await updateItemCollections(deps, {
        item: ITEM_REF,
        add: ['no such collection'],
      })
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe(ZOTERO_NOT_FOUND)
    expect(
      mock.requests.some((request) => request.pathname === `/api/users/0/items/${ITEM_KEY}`),
    ).toBe(false)
  })

  it('fails loud when the read backing the write lacks the object version', async () => {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify([1, 2])),
    )
    const { deps } = writeDeps(mock)
    await expect(
      updateItemCollections(deps, { item: ITEM_REF, add: ['方法论'] }),
    ).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: WRITE_VERSION_MISSING_MESSAGE,
    })
  })

  it('fails before PATCH when the item read omits or malforms existing collections', async () => {
    let data: Record<string, unknown> = {}
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, data)),
      ),
    )
    const cases = [
      { data: {}, message: writeObjectStateMissingMessage('tags') },
      {
        data: { tags: [], collections: undefined },
        message: writeObjectStateMissingMessage('collections'),
      },
      {
        data: { tags: [], collections: [42] },
        message: writeObjectStateMissingMessage('collections'),
      },
    ]
    for (const testCase of cases) {
      data = testCase.data
      const { deps } = writeDeps(mock)
      await expect(
        updateItemCollections(deps, {
          item: ITEM_REF,
          add: ['方法论'],
        }),
      ).rejects.toMatchObject({
        code: ZOTERO_UNEXPECTED,
        message: testCase.message,
      })
      expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
    }
  })

  it('maps a lost precondition to the re-run guidance', async () => {
    grantAuthorize(mock)
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { tags: [], collections: [] })),
      ),
    )
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        412,
        { 'Content-Type': 'text/plain' },
        'item has been modified since specified version (expected 10, found 11)',
      ),
    )
    const { deps } = writeDeps(mock)
    let thrown: unknown
    try {
      await updateItemCollections(deps, {
        item: ITEM_REF,
        add: ['方法论'],
      })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_CONFLICT_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_CONFLICT)
  })
})
