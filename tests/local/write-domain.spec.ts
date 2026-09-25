import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalApiProvider } from '../../src/local/provider.js'
import {
  WRITE_CAPABILITY_UNAVAILABLE_CODE,
  addToCollection,
  createNote,
  updateTags,
  writeCapabilityUnavailableMessage,
} from '../../src/local/write-domain.js'
import {
  SERVER_MISMATCH_MESSAGE,
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  WRITE_IDENTITY_UNSUPPORTED_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
  writeObjectRefusedMessage,
  writeObjectStateMissingMessage,
  writeListEmptyMessage,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_IMPLEMENTED,
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
import { MockZotero } from '../helpers/mock-zotero.js'
import { parseRef } from '../../src/refs.js'
import { ZoteroHttpClient } from '../../src/http-client.js'
import { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { WriteAuthorizer } from '../../src/write-auth.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('createNote', () => {
  it('creates a standalone note with tags, a collection by name, and source relations, reading the saved state back from the batch', async () => {
    grantAuthorize(mock)
    let entry: Record<string, unknown> | undefined
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}')[0] as Record<
        string,
        unknown
      >
      helpers.raw(
        200,
        batchHeaders(42),
        batchBody(NEW_KEY, 42, {
          itemType: 'note',
          tags: [{ tag: 'methods' }],
          collections: [COLLECTION_KEY],
          relations: { 'dc:relation': ['http://zotero.org/users/0/items/SOURCE01'] },
        }),
      )
    })
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: '**方法**：见第 2 节。',
      collections: ['方法论'],
      tags: ['methods'],
      sourceRefs: [SOURCE_REF],
    })
    expect(result.kind).toBe('applied')
    expectApplied(result)
    expect(result.key).toBe(NEW_KEY)
    expect(result.ref).toBe(`zotero://user/0/item/${NEW_KEY}?server=${SERVER_ID}`)
    expect(result.version).toBe(42)
    expect(result.collections).toEqual([
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(result.tags).toEqual(['methods'])
    expect(result.sourceRefs).toEqual([`zotero://user/0/item/SOURCE01?server=${SERVER_ID}`])
    expect(result.libraryVersion).toBe(42)
    expect(result.serverId).toBe(SERVER_ID)
    expect(entry?.itemType).toBe('note')
    expect(entry?.note).toBe('<p><strong>方法</strong>：见第 2 节。</p>')
    expect(entry?.tags).toEqual([{ tag: 'methods' }])
    expect(entry?.collections).toEqual([COLLECTION_KEY])
    expect(entry?.relations).toEqual({
      'dc:relation': ['http://zotero.org/users/0/items/SOURCE01'],
    })
  })
  it('refuses a resolved collection ref from another Zotero instance', async () => {
    const staleCollection = parseRef(
      `zotero://user/0/collection/${COLLECTION_KEY}?server=OTHER1234`,
    )
    const { deps } = writeDeps(mock)
    await expect(
      createNote(deps, async () => staleCollection, {
        markdown: 'x',
        collections: ['stale'],
      }),
    ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
    expect(mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
  it('coalesces concurrent collection-name reads into one listing request', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        batchBody(NEW_KEY, 42, {
          itemType: 'note',
          collections: [COLLECTION_KEY, SECOND_COLLECTION_KEY],
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    const before = mock.requests.filter(
      (request) => request.pathname === '/api/users/0/collections',
    ).length
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'x',
      collections: ['方法论', 'Second'],
    })
    const after = mock.requests.filter(
      (request) => request.pathname === '/api/users/0/collections',
    ).length
    expectApplied(result)
    expect(result.collections).toHaveLength(2)
    expect(after - before).toBe(1)
  })
  it('returns a non-retryable committed-unverified result when saved data is missing', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        JSON.stringify({
          successful: { '0': { key: NEW_KEY, version: 42 } },
          success: { '0': NEW_KEY },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).resolves.toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      key: NEW_KEY,
      version: 42,
      libraryVersion: 42,
      serverId: SERVER_ID,
    })
  })
  it('uses the success bucket identity when the successful object is missing', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        JSON.stringify({
          successful: {},
          success: { '0': NEW_KEY },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).resolves.toMatchObject({
      kind: 'committed-unverified',
      key: NEW_KEY,
      reason: 'saved-state-unverified',
    })
  })

  it('does not throw an invalid-ref error after a malformed successful key', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        JSON.stringify({
          successful: { '0': { key: 'not a key', version: 42, data: {} } },
          success: { '0': NEW_KEY },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).resolves.toMatchObject({
      kind: 'committed-unverified',
      key: NEW_KEY,
    })
  })

  it('returns a non-retryable commit-unknown result when the response drops', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res) => {
      res.destroy()
    })
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, resolveThrough(directory), { markdown: 'x' })
    expect(result).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: SERVER_ID,
    })
    expect(result.libraryVersion).toBeUndefined()
    expect(
      mock.requests.filter(
        (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
      ),
    ).toHaveLength(1)
  })

  it('does not claim a requested parent when the committed response omits it', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        batchBody(NEW_KEY, 42, {
          itemType: 'note',
          relations: { 'dc:relation': [] },
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), {
        markdown: 'x',
        parentItem: ITEM_REF,
      }),
    ).resolves.toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      key: NEW_KEY,
      version: 42,
    })
  })
  it('creates a child note under its parent with relations and without collections', async () => {
    grantAuthorize(mock)
    let entry: Record<string, unknown> | undefined
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}')[0] as Record<
        string,
        unknown
      >
      helpers.raw(
        200,
        batchHeaders(43),
        batchBody(NEW_KEY, 43, {
          parentItem: ITEM_KEY,
          relations: { 'dc:relation': ['http://zotero.org/users/0/items/SOURCE01'] },
        }),
      )
    })
    const { deps, directory } = writeDeps(mock)
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'reads it',
      parentItem: ITEM_REF,
      sourceRefs: [SOURCE_REF],
    })
    expectApplied(result)
    expect(result.parentItem).toBe(`zotero://user/0/item/${ITEM_KEY}?server=${SERVER_ID}`)
    expect(result.collections).toEqual([])
    expect(entry?.parentItem).toBe(ITEM_KEY)
    expect(entry?.collections).toBeUndefined()
  })
  it('refuses collections on a child note when the domain is called without the tool layer', async () => {
    // Dual-end invariant: tools/create-note buildRequest already refuses this
    // on the model path; this spec pins the domain gate for direct callers.
    const { deps, directory } = writeDeps(mock)
    let thrown: unknown
    try {
      await createNote(deps, resolveThrough(directory), {
        markdown: 'x',
        parentItem: ITEM_REF,
        collections: ['方法论'],
      })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_CHILD_COLLECTIONS_MESSAGE)
    expect(mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
  it('rejects blank direct write arguments before any network request', async () => {
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: '   ' }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
    await expect(updateTags(deps, { item: ITEM_REF, tags: ['   '] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
    })
    await expect(
      addToCollection(deps, resolveThrough(directory), {
        item: ITEM_REF,
        collection: '   ',
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
    expect(mock.requests).toHaveLength(0)
  })
  it('refuses a malformed direct-call key before any network request', async () => {
    const { deps } = writeDeps(mock)
    await expect(
      updateTags(deps, {
        item: { ...ITEM_REF, key: '../../../groups/55/items/ABCDEFGH' },
        tags: ['new'],
      }),
    ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_REF' })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses a group-library target', async () => {
    const { deps, directory } = writeDeps(mock)
    let code: string | undefined
    try {
      await createNote(deps, resolveThrough(directory), {
        markdown: 'x',
        parentItem: parseRef(`zotero://group/55/item/${ITEM_KEY}`),
      })
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(mock.requests).toHaveLength(0)
  })
  it('maps a per-object refusal to the typed error its status names', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(44),
        JSON.stringify({
          successful: {},
          success: {},
          unchanged: {},
          failed: { '0': { key: '', code: 404, message: 'parent item not found' } },
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    let thrown: unknown
    try {
      await createNote(deps, resolveThrough(directory), {
        markdown: 'x',
        parentItem: ITEM_REF,
      })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(writeObjectRefusedMessage('parent item not found', 404))
    expect((thrown as { code?: string }).code).toBe(ZOTERO_NOT_FOUND)
  })
  it('replays a batch once after re-authorization when the key was consumed', async () => {
    let posts = 0
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      posts += 1
      if (posts === 1) {
        helpers.raw(401, { 'Content-Type': 'text/plain' }, 'API key required')
        return
      }
      helpers.raw(200, batchHeaders(45), batchBody(NEW_KEY, 45, {}))
    })
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID },
        JSON.stringify({ key: 'R'.repeat(32), remember: true }),
      ),
    )
    const { deps, directory, authorizer } = writeDeps(mock)
    const invalidate = vi.spyOn(authorizer, 'invalidate')
    const result = await createNote(deps, resolveThrough(directory), { markdown: 'x' })
    expect(result.kind).toBe('applied')
    expectApplied(result)
    expect(posts).toBe(2)
    expect(
      mock.requests.filter((request) => request.pathname === '/api/local/authorize'),
    ).toHaveLength(2)
    expect(invalidate).toHaveBeenCalledWith(SERVER_ID, 'R'.repeat(32))
  })
  it('propagates a non-401 failure from the re-authorization attempt', async () => {
    let posts = 0
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      posts += 1
      if (posts === 1) {
        helpers.raw(401, { 'Content-Type': 'text/plain' }, 'API key required')
        return
      }
      helpers.raw(412, { 'Content-Type': 'text/plain' }, 'version conflict')
    })
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID },
        JSON.stringify({ key: 'R'.repeat(32), remember: false }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).rejects.toMatchObject({ code: ZOTERO_WRITE_CONFLICT })
  })
  it('escalates to the after-authorization guidance when a second 401 arrives', async () => {
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(401, { 'Content-Type': 'text/plain' }, 'API key required'),
    )
    mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID },
        JSON.stringify({ key: 'R'.repeat(32), remember: false }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    let thrown: unknown
    try {
      await createNote(deps, resolveThrough(directory), { markdown: 'x' })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_UNAUTHORIZED)
  })

  it('translates 400 batch refusal codes onto invalid argument', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        JSON.stringify({
          successful: {},
          success: {},
          unchanged: {},
          failed: { '0': { key: '', code: 400, message: 'Invalid payload' } },
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeObjectRefusedMessage('Invalid payload', 400),
    })
  })

  it('translates unexpected batch refusal codes onto unexpected error', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        JSON.stringify({
          successful: {},
          success: {},
          unchanged: {},
          failed: { '0': { key: '', code: 500, message: 'Internal crash' } },
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: writeObjectRefusedMessage('Internal crash', 500),
    })
  })

  it('marks note unverified when response note body is not a string', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        batchHeaders(42),
        JSON.stringify({
          successful: {
            '0': {
              key: NEW_KEY,
              version: 42,
              data: { key: NEW_KEY, version: 42, itemType: 'note', note: 123 },
            },
          },
          success: { '0': NEW_KEY },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), { markdown: 'x' }),
    ).resolves.toMatchObject({
      kind: 'committed-unverified',
      key: NEW_KEY,
      version: 42,
      reason: 'saved-state-unverified',
    })
  })

  it('fails when the server does not report an instance identity', async () => {
    const rawMock = await MockZotero.start()
    rawMock.route('GET', '/api/', (_req, res, helpers) => helpers.raw(200, {}, JSON.stringify({})))
    try {
      const bareClient = new ZoteroHttpClient({
        baseUrl: rawMock.baseUrl,
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      })
      const writer = new ZoteroWriteHttpClient({
        baseUrl: rawMock.baseUrl,
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      })
      const authorizer = new WriteAuthorizer({ client: writer, persistKey: () => true })
      const bareDeps = { client: bareClient, writer, authorizer }
      await expect(
        createNote(bareDeps, async () => ITEM_REF, { markdown: 'x' }),
      ).rejects.toMatchObject({
        code: ZOTERO_NOT_IMPLEMENTED,
        message: WRITE_IDENTITY_UNSUPPORTED_MESSAGE,
      })
    } finally {
      await rawMock.close()
    }
  })

  it('refuses a ref tied to a different server instance', async () => {
    const { deps, directory } = writeDeps(mock)
    await expect(
      createNote(deps, resolveThrough(directory), {
        markdown: 'x',
        parentItem: parseRef(`zotero://user/0/item/${ITEM_KEY}?server=other-srv`),
      }),
    ).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
      message: SERVER_MISMATCH_MESSAGE,
    })
  })

  it('refuses an empty tags list on updateTags', async () => {
    const { deps } = writeDeps(mock)
    await expect(updateTags(deps, { item: ITEM_REF, tags: [] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeListEmptyMessage('tags'),
    })
  })
})

describe('the provider seam', () => {
  it('serves the write capability only when the write collaborators are wired', async () => {
    const client = new ZoteroHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 1000,
      maxResponseBytes: 1024,
    })
    const bare = new LocalApiProvider(client, LIMITS)
    expect(bare.capabilities.has('write')).toBe(false)
    let thrown: unknown
    try {
      await bare.createNote({ markdown: 'x' })
    } catch (error) {
      thrown = error
    }
    expect((thrown as { code?: string }).code).toBe(WRITE_CAPABILITY_UNAVAILABLE_CODE)
    expect((thrown as Error).message).toBe(writeCapabilityUnavailableMessage('local'))
  })
})

/**
 * What one sanctioned write costs on the wire. The plugin's answer to a slow
 * write is the sanctioned path itself — a write is one tool call and one or two
 * requests, while the improvised route re-derives the protocol in a dozen model
 * round trips. These cases pin the request side of that claim so it cannot
 * regress silently, and they show the steady state: once the instance identity
 * and the grant are held, a note write is exactly one request.
 */
describe('request minimum', () => {
  /** How many requests the mock served for one method and path. */
  function count(method: string, pathname: string): number {
    return mock.requests.filter(
      (request) => request.method === method && request.pathname === pathname,
    ).length
  }

  it('creates a note in one write request, and in exactly one request once identity and grant are held', async () => {
    grantAuthorize(mock)
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(200, batchHeaders(42), batchBody(NEW_KEY, 42, {})),
    )
    const { deps, directory } = writeDeps(mock)

    await createNote(deps, resolveThrough(directory), { markdown: 'first' })
    // The first write pays the one-time identity probe and the authorize dialog.
    expect(count('GET', '/api/')).toBe(1)
    expect(count('POST', '/api/local/authorize')).toBe(1)
    expect(count('POST', '/api/users/0/items')).toBe(1)
    // A note write never pre-reads the item and never re-reads it afterwards:
    // the batch response carries the saved state.
    expect(count('GET', `/api/users/0/items/${ITEM_KEY}`)).toBe(0)

    const before = mock.requests.length
    await createNote(deps, resolveThrough(directory), { markdown: 'second' })
    expect(
      mock.requests.slice(before).map((request) => `${request.method} ${request.pathname}`),
    ).toEqual(['POST /api/users/0/items'])
  })

  it('updates tags with one read and one patch', async () => {
    grantAuthorize(mock)
    mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
    )
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { tags: [] })),
      ),
    )
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '11' }, ''),
    )
    const { deps } = writeDeps(mock)

    await updateTags(deps, { item: ITEM_REF, tags: ['new'] })
    expect(count('GET', `/api/users/0/items/${ITEM_KEY}`)).toBe(1)
    expect(count('PATCH', `/api/users/0/items/${ITEM_KEY}`)).toBe(1)
    // Merge semantics need the read; nothing else is contacted.
    expect(count('POST', '/api/users/0/items')).toBe(0)
    expect(count('GET', '/api/users/0/collections')).toBe(0)
  })

  it('adds to a collection by ref without resolving any name', async () => {
    grantAuthorize(mock)
    mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
    )
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, { collections: [] })),
      ),
    )
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '11' }, ''),
    )
    const { deps, directory } = writeDeps(mock)

    await addToCollection(deps, resolveThrough(directory), {
      item: ITEM_REF,
      collection: `zotero://user/0/collection/${COLLECTION_KEY}`,
    })
    expect(count('GET', '/api/users/0/collections')).toBe(0)
    expect(count('GET', `/api/users/0/items/${ITEM_KEY}`)).toBe(1)
    expect(count('PATCH', `/api/users/0/items/${ITEM_KEY}`)).toBe(1)
  })
})
