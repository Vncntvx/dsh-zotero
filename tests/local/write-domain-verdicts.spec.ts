/**
 * The verdict arms of the write domain: how each entry point settles when
 * Zotero's answer contradicts the request, omits the state the claim would
 * rest on, or refuses before commit. One case per arm — the read-side key and
 * version checks, the batch buckets that mean "committed but unverifiable",
 * the sibling-listing checks, and the pre-commit refusals that must rethrow
 * instead of being dressed up as an unknown commit.
 * @module tests/local/write-domain-verdicts
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createCollection,
  createItem,
  createNote,
  deleteCollection,
  updateItemTags,
} from '../../src/local/write-domain.js'
import { OBJECT_NOT_FOUND_MESSAGE } from '../../src/http-client.js'
import {
  SERVER_MISMATCH_MESSAGE,
  WRITE_ITEM_TYPE_MISSING_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  writeObjectRefusedMessage,
} from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  SOURCE_REF,
  ITEM_KEY,
  ITEM_REF,
  NEW_KEY,
  batchBody,
  batchHeaders,
  grantAuthorize,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../helpers/write-domain-fixtures.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

/** Serve one collection object read under the standard identity. */
function serveCollectionRead(key: string, body: unknown): void {
  mock.route('GET', `/api/users/0/collections/${key}`, (_req, res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify(body)),
  )
}

/** Answer a create POST with a hand-built batch body. */
function serveCreateBatch(path: string, body: string, status = 200): void {
  mock.route('POST', path, (_req, res, helpers) => helpers.raw(status, batchHeaders(42), body))
}

describe('createNote verdicts', () => {
  it('marks the commit unknown when the batch buckets contradict each other', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      JSON.stringify({
        successful: {},
        success: { '0': NEW_KEY },
        unchanged: {},
        failed: { '0': { key: '', code: 500, message: 'boom' } },
      }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createNote(deps, { markdown: 'x' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: SERVER_ID,
    })
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('treats saved tags that are not an array as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      batchBody(NEW_KEY, 42, { tags: 'not-an-array', collections: [] }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createNote(deps, { markdown: 'x' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      key: NEW_KEY,
      version: 42,
    })
  })

  it('treats a saved tag entry carrying an invalid type as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      batchBody(NEW_KEY, 42, {
        tags: [{ tag: 'methods', type: 'automatic' }],
        collections: [],
      }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createNote(deps, { markdown: 'x', tags: ['methods'] })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: NEW_KEY,
    })
  })

  it('reads a saved relation delivered as one string instead of an array', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      batchBody(NEW_KEY, 43, {
        collections: [],
        relations: { 'dc:relation': 'http://zotero.org/users/0/items/SOURCE01' },
      }),
    )
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, {
      markdown: 'x',
      sourceRefs: [SOURCE_REF],
    })
    expect(result).toMatchObject({ kind: 'applied', key: NEW_KEY })
    expect(result.kind === 'applied' ? result.sourceRefs : []).toEqual([
      `zotero://user/0/item/SOURCE01?server=${SERVER_ID}`,
    ])
  })

  it('answers an unchanged-bucket-only batch as committed but unkeyed', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      JSON.stringify({
        successful: {},
        success: {},
        unchanged: { '0': NEW_KEY },
        failed: {},
      }),
    )
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, { markdown: 'x' })
    expect(result).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      serverId: SERVER_ID,
    })
    expect('key' in result).toBe(false)
  })

  it('maps a per-object 412 refusal onto the write conflict', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      JSON.stringify({
        successful: {},
        success: {},
        unchanged: {},
        failed: { '0': { key: '', code: 412, message: 'Item has changed since load' } },
      }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createNote(deps, { markdown: 'x' })).rejects.toMatchObject({
      code: ZOTERO_WRITE_CONFLICT,
      message: writeObjectRefusedMessage('Item has changed since load', 412),
    })
  })
})

describe('read-side verdicts', () => {
  it('fails loud when the item read answers with a different object', async () => {
    serveItemRead(mock, {
      key: ITEM_KEY,
      body: {
        key: 'OTHERKEY1',
        version: 7,
        data: { key: 'OTHERKEY1', itemType: 'journalArticle', tags: [], collections: [] },
      },
    })
    const { deps } = writeDeps(mock)
    await expect(updateItemTags(deps, { item: ITEM_REF, add: ['methods'] })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: expect.stringContaining(`a different item than ${ITEM_KEY}`),
    })
  })

  it('fails loud when the item read omits the item type', async () => {
    serveItemRead(mock, {
      key: ITEM_KEY,
      body: {
        key: ITEM_KEY,
        version: 7,
        data: { key: ITEM_KEY, tags: [], collections: [] },
      },
    })
    const { deps } = writeDeps(mock)
    await expect(updateItemTags(deps, { item: ITEM_REF, add: ['methods'] })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: WRITE_ITEM_TYPE_MISSING_MESSAGE,
    })
  })

  it('fails loud when the delete read answers with a different collection', async () => {
    serveCollectionRead(SECOND_COLLECTION_KEY, {
      key: 'OTHERCOL1',
      version: 6,
      data: { key: 'OTHERCOL1', name: 'Second' },
    })
    const { deps, directory } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: expect.stringContaining(`a different collection than ${SECOND_COLLECTION_KEY}`),
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('fails loud when the delete read omits the object version', async () => {
    serveCollectionRead(SECOND_COLLECTION_KEY, {
      key: SECOND_COLLECTION_KEY,
      data: { key: SECOND_COLLECTION_KEY, name: 'Second' },
    })
    const { deps, directory } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: WRITE_VERSION_MISSING_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })
})

/**
 * Start a mock whose collection listing is whatever the case needs: the
 * shared fixture registers its own listing first (first route wins), so the
 * listing verdicts build their own identity and list.
 */
async function startListingMock(
  rows: readonly unknown[],
  listingHeaders: Record<string, string> = {},
): Promise<MockZotero> {
  const own = await MockZotero.start()
  own.route('GET', '/api/', (_req, res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
  )
  own.route('GET', '/api/users/0/collections/top', (_req, res, helpers) =>
    helpers.json(rows, { ...listingHeaders, 'Total-Results': String(rows.length) }),
  )
  grantAuthorize(own)
  return own
}

describe('createCollection verdicts', () => {
  it('rejects a sibling listing served by another Zotero instance', async () => {
    const own = await startListingMock([], { 'Zotero-Server-ID': 'srv-somewhere-else' })
    try {
      const { deps, directory } = writeDeps(own)
      await expect(createCollection(deps, { name: 'Field notes' })).rejects.toMatchObject({
        code: ZOTERO_SERVER_MISMATCH,
        message: SERVER_MISMATCH_MESSAGE,
      })
      expect(own.requests.some((request) => request.method === 'POST')).toBe(false)
    } finally {
      await own.close()
    }
  })

  it('skips sibling rows without a usable key or name instead of failing the create', async () => {
    const own = await startListingMock([
      { data: { name: 'Ghost' } },
      { key: 'not a key', data: { key: 'not a key', name: 'Broken' } },
      { key: 'ABCD5678', version: 3, data: { key: 'ABCD5678' } },
      { key: 'COLL9999', version: 3, data: { key: 'COLL9999', name: 'Taken' } },
    ])
    try {
      own.route('POST', '/api/users/0/collections', (_req, res, helpers) =>
        helpers.raw(200, batchHeaders(42), batchBody('NEWCOLL1', 42, { name: 'Field notes' })),
      )
      const { deps, directory } = writeDeps(own)
      const result = await createCollection(deps, {
        name: 'Field notes',
      })
      expect(result).toMatchObject({ kind: 'applied', key: 'NEWCOLL1' })
    } finally {
      await own.close()
    }
  })

  it('answers a batch with no outcome buckets as commit-unknown', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/collections',
      JSON.stringify({ successful: {}, success: {}, unchanged: {}, failed: {} }),
    )
    const { deps } = writeDeps(mock)
    const result = await createCollection(deps, { name: 'Field notes' })
    expect(result).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: SERVER_ID,
    })
    expect('key' in result).toBe(false)
  })

  it('answers a batch whose saved state never arrived as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/collections',
      JSON.stringify({
        successful: { '0': { key: 'NEWCOLL1', version: 42 } },
        success: { '0': 'NEWCOLL1' },
        unchanged: {},
        failed: {},
      }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createCollection(deps, { name: 'Field notes' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: 'NEWCOLL1',
      version: 42,
    })
  })

  it('answers a saved name that contradicts the request as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/collections',
      batchBody('NEWCOLL1', 42, { name: 'Something else' }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createCollection(deps, { name: 'Field notes' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: 'NEWCOLL1',
      version: 42,
    })
  })

  it('answers a saved parent that contradicts a top-level create as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/collections',
      batchBody('NEWCOLL1', 42, { name: 'Field notes', parentCollection: SECOND_COLLECTION_KEY }),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createCollection(deps, { name: 'Field notes' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: 'NEWCOLL1',
      version: 42,
    })
  })

  it('rethrows a pre-commit refusal instead of calling it unknown', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/collections', (_req, res, helpers) =>
      helpers.raw(404, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(createCollection(deps, { name: 'Field notes' })).rejects.toMatchObject({
      code: ZOTERO_NOT_FOUND,
      message: OBJECT_NOT_FOUND_MESSAGE,
    })
  })
})

describe('createItem verdicts', () => {
  it('answers a batch whose saved version is missing as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      JSON.stringify({
        successful: { '0': { key: 'NEWITEM1', data: { key: 'NEWITEM1', itemType: 'book' } } },
        success: { '0': 'NEWITEM1' },
        unchanged: {},
        failed: {},
      }),
    )
    const { deps } = writeDeps(mock)
    await expect(createItem(deps, { itemType: 'book', title: 'A study' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: 'NEWITEM1',
    })
  })

  it('answers a saved item that contradicts the response key as unverifiable', async () => {
    grantAuthorize(mock)
    serveCreateBatch(
      '/api/users/0/items',
      JSON.stringify({
        successful: {
          '0': { key: 'NEWITEM1', version: 42, data: { key: 'OTHERKEY1', itemType: 'book' } },
        },
        success: { '0': 'NEWITEM1' },
        unchanged: {},
        failed: {},
      }),
    )
    const { deps } = writeDeps(mock)
    await expect(createItem(deps, { itemType: 'book', title: 'A study' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: 'NEWITEM1',
      version: 42,
    })
  })

  it('rethrows a pre-commit refusal instead of calling it unknown', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(404, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
    )
    const { deps } = writeDeps(mock)
    await expect(createItem(deps, { itemType: 'book', title: 'A study' })).rejects.toMatchObject({
      code: ZOTERO_NOT_FOUND,
      message: OBJECT_NOT_FOUND_MESSAGE,
    })
  })
})
