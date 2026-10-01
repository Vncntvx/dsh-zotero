import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createItem, updateItem } from '../../src/local/write-domain.js'
import {
  SERVER_MISMATCH_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  writeFieldNotForItemTypeMessage,
  writeNonBlankMessage,
  writeObjectRefusedMessage,
  writeItemTypeUnsupportedMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
} from '../../src/errors.js'
import {
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
  expectApplied,
} from '../helpers/write-domain-fixtures.js'
import type { ZoteroCreateItemRequest, ZoteroUpdateItemRequest } from '../../src/types.js'
import type { MockZotero } from '../helpers/mock-zotero.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

/** Serve one item read carrying tags and collections, as Zotero always does. */
function serveItem(
  data: Record<string, unknown>,
  options: { serverId?: string; version?: number } = {},
): void {
  mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
    helpers.raw(
      200,
      {
        'Zotero-Server-ID': options.serverId ?? SERVER_ID,
        'Last-Modified-Version': String(options.version ?? 10),
      },
      JSON.stringify(
        itemJson(ITEM_KEY, options.version ?? 10, { tags: [], collections: [], ...data }),
      ),
    ),
  )
}

describe('createItem', () => {
  it('refuses an item type outside the closed whitelist before any network', async () => {
    const { deps } = writeDeps(mock)
    const badType: string = 'film'
    await expect(
      createItem(deps, { itemType: badType, title: 'T' } as ZoteroCreateItemRequest),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeItemTypeUnsupportedMessage('film'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses an item that carries neither a title nor a URL', async () => {
    const { deps } = writeDeps(mock)
    await expect(createItem(deps, { itemType: 'webpage' })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses a creator without a type or any name before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(
      createItem(deps, { itemType: 'book', title: 'T', creators: [{ creatorType: '  ' }] }),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('creators[0].creatorType'),
    })
    await expect(
      createItem(deps, { itemType: 'book', title: 'T', creators: [{ creatorType: 'author' }] }),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: 'creators[0] must carry a name or a firstName/lastName pair',
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('posts the closed field set with wire names and normalized creators', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '60' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'NEWITEM1',
              version: 60,
              data: { key: 'NEWITEM1', version: 60, itemType: 'journalArticle', title: 'A study' },
            },
          },
          success: { '0': 'NEWITEM1' },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const { deps } = writeDeps(mock)
    const result = await createItem(deps, {
      itemType: 'journalArticle',
      title: 'A study',
      date: ' 2024 ',
      doi: '10.1/xyz',
      publicationTitle: 'Journal',
      creators: [
        { creatorType: 'author', name: 'Wu, Lei' },
        { creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' },
      ],
    })
    expectApplied(result)
    expect(result.ref).toBe(`zotero://user/0/item/NEWITEM1?server=${SERVER_ID}`)
    expect(result.itemType).toBe('journalArticle')
    expect(result.title).toBe('A study')
    expect(result.libraryVersion).toBe(60)
    const posted = mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
    )
    expect(JSON.parse(posted?.body ?? '[]')[0]).toEqual({
      itemType: 'journalArticle',
      title: 'A study',
      date: '2024',
      DOI: '10.1/xyz',
      publicationTitle: 'Journal',
      creators: [
        { creatorType: 'author', name: 'Wu, Lei' },
        { creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' },
      ],
    })
  })

  it('returns a non-retryable committed-unverified result when the saved state is missing', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '61' },
        JSON.stringify({ successful: {}, success: {}, unchanged: {}, failed: {} }),
      ),
    )
    const result = await createItem(deps, { itemType: 'webpage', url: 'https://example.org' })
    expect(result).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      serverId: SERVER_ID,
    })
    expect(result.kind === 'committed-unverified' && result.key).toBeUndefined()
  })

  it('treats a saved item of another type as an unverified creation', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '62' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'NEWITEM1',
              version: 62,
              data: { key: 'NEWITEM1', version: 62, itemType: 'book', title: 'A study' },
            },
          },
          success: { '0': 'NEWITEM1' },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const result = await createItem(deps, { itemType: 'journalArticle', title: 'A study' })
    expect(result).toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: 'NEWITEM1',
      version: 62,
    })
  })

  it('returns a non-retryable commit-unknown result when the response drops', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/items', (_req, res) => {
      res.destroy()
    })
    await expect(createItem(deps, { itemType: 'webpage', url: 'u' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: SERVER_ID,
    })
    expect(
      mock.requests.filter(
        (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
      ),
    ).toHaveLength(1)
  })

  it('maps a per-object refusal onto the typed error its status names', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '63' },
        JSON.stringify({
          successful: {},
          success: {},
          unchanged: {},
          failed: { '0': { key: '', code: 404, message: 'No such library' } },
        }),
      ),
    )
    await expect(createItem(deps, { itemType: 'webpage', url: 'u' })).rejects.toMatchObject({
      code: ZOTERO_NOT_FOUND,
      message: writeObjectRefusedMessage('No such library', 404),
    })
  })
})

describe('updateItem', () => {
  it('refuses an empty or unknown or blank selection before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(updateItem(deps, { item: ITEM_REF, set: {} })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: 'set must carry at least one item.',
    })
    const unknownField: Record<string, string> = { creators: 'Wu' }
    await expect(
      updateItem(deps, { item: ITEM_REF, set: unknownField } as ZoteroUpdateItemRequest),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
    await expect(updateItem(deps, { item: ITEM_REF, set: { title: '   ' } })).rejects.toMatchObject(
      {
        code: ZOTERO_INVALID_ARGUMENT,
        message: writeNonBlankMessage('set.title'),
      },
    )
    expect(mock.requests).toHaveLength(0)
  })

  it('patches the wire names under the item version precondition', async () => {
    grantAuthorize(mock)
    serveItem({ itemType: 'journalArticle' })
    mock.route('GET', '/api/itemTypeFields', (_req, res, helpers, search) =>
      helpers.json(
        ['title', 'date', 'DOI', 'publicationTitle', 'url', 'abstractNote', 'extra'].map(
          (field) => ({ field, itemType: search.get('itemType'), localized: field }),
        ),
      ),
    )
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '21' }, '')
    })
    const { deps } = writeDeps(mock)
    const result = await updateItem(deps, {
      item: ITEM_REF,
      set: { title: 'New title', doi: '10.2/abc', date: '2025' },
    })
    expect(result).toEqual({
      kind: 'applied',
      ref: `zotero://user/0/item/${ITEM_KEY}?server=${SERVER_ID}`,
      version: 21,
      changed: ['date', 'doi', 'title'],
      libraryVersion: 21,
      serverId: SERVER_ID,
    })
    expect(body).toEqual({ title: 'New title', DOI: '10.2/abc', date: '2025' })
    const patch = mock.requests.find((request) => request.method === 'PATCH')
    expect(patch?.headers['if-unmodified-since-version']).toBe('10')
  })

  it('refuses a field the item type does not accept before any PATCH', async () => {
    grantAuthorize(mock)
    serveItem({ itemType: 'webpage' })
    mock.route('GET', '/api/itemTypeFields', (_req, res, helpers, search) =>
      helpers.json(
        ['title', 'url', 'date'].map((field) => ({ field, itemType: search.get('itemType') })),
      ),
    )
    const { deps } = writeDeps(mock)
    await expect(
      updateItem(deps, { item: ITEM_REF, set: { doi: '10.1/x' } }),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeFieldNotForItemTypeMessage('doi', 'webpage'),
    })
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('fails loud when the item-type fields answer is not an array', async () => {
    grantAuthorize(mock)
    serveItem({ itemType: 'journalArticle' })
    mock.route('GET', '/api/itemTypeFields', (_req, res, helpers) => helpers.json({ fields: [] }))
    const { deps } = writeDeps(mock)
    await expect(updateItem(deps, { item: ITEM_REF, set: { title: 'T' } })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
    })
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('maps a lost precondition to the re-run guidance', async () => {
    grantAuthorize(mock)
    serveItem({ itemType: 'journalArticle' })
    mock.route('GET', '/api/itemTypeFields', (_req, res, helpers) =>
      helpers.json([{ field: 'title' }]),
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
      await updateItem(deps, { item: ITEM_REF, set: { title: 'T' } })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_CONFLICT_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_CONFLICT)
  })

  it('rejects an item read served by a different Zotero instance', async () => {
    serveItem({ itemType: 'journalArticle' }, { serverId: 'OTHER1234' })
    const { deps } = writeDeps(mock)
    await expect(updateItem(deps, { item: ITEM_REF, set: { title: 'T' } })).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
      message: SERVER_MISMATCH_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
})
