import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNote, updateItemTags } from '../../src/local/write-domain.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  writeNonBlankMessage,
  writeObjectStateMissingMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
} from '../../src/errors.js'
import {
  batchBody,
  batchHeaders,
  COLLECTION_KEY,
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
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

/** Serve one item read; both write-relevant arrays are always present. */
function serveItem(data: Record<string, unknown>): void {
  mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
      JSON.stringify(itemJson(ITEM_KEY, 10, { tags: [], collections: [], ...data })),
    ),
  )
}

describe('updateItemTags', () => {
  it('refuses a qualified item ref from another Zotero instance before reading it', async () => {
    const stale = parseRef(`zotero://user/0/item/${ITEM_KEY}?server=OTHER1234`)
    const { deps } = writeDeps(mock)
    await expect(updateItemTags(deps, { item: stale, add: ['new'] })).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
    })
    expect(mock.requests.some((request) => request.pathname.includes(`/items/${ITEM_KEY}`))).toBe(
      false,
    )
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('rejects an item read served by a different Zotero instance', async () => {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': 'OTHER1234', 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { tags: [], collections: [] })),
      ),
    )
    const { deps } = writeDeps(mock)
    await expect(updateItemTags(deps, { item: ITEM_REF, add: ['new'] })).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
    })
  })

  it('refuses a request that neither adds nor removes before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(updateItemTags(deps, { item: ITEM_REF })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: WRITE_LIST_SELECTION_MESSAGE,
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses blank entries in add or remove before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(updateItemTags(deps, { item: ITEM_REF, add: ['   '] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('add'),
    })
    await expect(updateItemTags(deps, { item: ITEM_REF, remove: [''] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('remove'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('merges add and remove under the item version precondition and preserves tag types', async () => {
    grantAuthorize(mock)
    serveItem({ tags: [{ tag: 'existing', type: 1 }, { tag: 'gone' }] })
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }, '')
    })
    const { deps } = writeDeps(mock)
    const result = await updateItemTags(deps, {
      item: ITEM_REF,
      add: ['new', 'existing'],
      remove: ['gone'],
    })
    expect(result.unchanged).toBe(false)
    expect(result.added).toEqual(['new'])
    expect(result.removed).toEqual(['gone'])
    expectApplied(result)
    expect(result.tags).toEqual(['existing', 'new'])
    expect(result.version).toBe(12)
    expect(result.libraryVersion).toBe(12)
    expect(body).toEqual({ tags: [{ tag: 'existing', type: 1 }, { tag: 'new' }] })
    const patch = mock.requests.find((request) => request.method === 'PATCH')
    expect(patch?.headers['if-unmodified-since-version']).toBe('10')
  })

  it('lets the removal win when a saved tag is named in both lists', async () => {
    grantAuthorize(mock)
    serveItem({ tags: [{ tag: 'kept' }, { tag: 'contested' }] })
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '11' }, ''),
    )
    const { deps } = writeDeps(mock)
    const result = await updateItemTags(deps, {
      item: ITEM_REF,
      add: ['contested', 'brand-new'],
      remove: ['contested'],
    })
    expectApplied(result)
    expect(result.tags).toEqual(['kept', 'brand-new'])
    expect(result.added).toEqual(['brand-new'])
    expect(result.removed).toEqual(['contested'])
    expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1)
  })

  it('reports unchanged and sends nothing when the merge matches the saved list', async () => {
    serveItem({ tags: [{ tag: 'existing' }] })
    const { deps } = writeDeps(mock)
    const result = await updateItemTags(deps, { item: ITEM_REF, add: ['existing'] })
    expect(result.unchanged).toBe(true)
    expectApplied(result)
    expect(result.libraryVersion).toBeUndefined()
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('fails loud when the read backing the write lacks the object version', async () => {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify([1, 2])),
    )
    const { deps } = writeDeps(mock)
    let thrown: unknown
    try {
      await updateItemTags(deps, { item: ITEM_REF, add: ['new'] })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_VERSION_MISSING_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_UNEXPECTED)
  })

  it('fails before PATCH when the item read omits or malforms existing tags or collections', async () => {
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
      { data: { tags: [42], collections: [] }, message: writeObjectStateMissingMessage('tags') },
      {
        data: { tags: [], collections: [42] },
        message: writeObjectStateMissingMessage('collections'),
      },
    ]
    for (const testCase of cases) {
      data = testCase.data
      const { deps } = writeDeps(mock)
      await expect(updateItemTags(deps, { item: ITEM_REF, add: ['new'] })).rejects.toMatchObject({
        code: ZOTERO_UNEXPECTED,
        message: testCase.message,
      })
      expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
    }
  })

  it('maps a lost precondition to the re-run guidance', async () => {
    grantAuthorize(mock)
    serveItem({ tags: [] })
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
      await updateItemTags(deps, { item: ITEM_REF, add: ['new'] })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_CONFLICT_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_CONFLICT)
  })
})

describe('createNote saved-state trust', () => {
  it('trusts an explicitly empty saved collection list instead of the request', async () => {
    grantAuthorize(mock)
    let entry: Record<string, unknown> | undefined
    mock.route('POST', '/api/users/0/items', (req, res, helpers) => {
      entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '[]')[0] as Record<
        string,
        unknown
      >
      helpers.raw(
        200,
        batchHeaders(46),
        batchBody(NEW_KEY, 46, { itemType: 'note', collections: [] }),
      )
    })
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'x',
      collections: ['方法论'],
    })
    expect(result.kind).toBe('applied')
    expectApplied(result)
    expect(result.collections).toEqual([])
    expect(entry?.collections).toEqual([COLLECTION_KEY])
  })

  it('trusts explicitly empty saved tags and relations instead of the request', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(47),
        batchBody(NEW_KEY, 47, {
          itemType: 'note',
          tags: [],
          relations: { 'dc:relation': [] },
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'x',
      tags: ['requested-tag'],
      sourceRefs: [SOURCE_REF],
    })
    expectApplied(result)
    expect(result.tags).toEqual([])
    expect(result.sourceRefs).toEqual([])
  })

  it('resolves the second collection from the same listing the first used', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(48),
        batchBody(NEW_KEY, 48, { itemType: 'note', collections: [SECOND_COLLECTION_KEY] }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'x',
      collections: ['Second'],
    })
    expectApplied(result)
    expect(result.collections).toEqual([
      `zotero://user/0/collection/${SECOND_COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
  })
})
