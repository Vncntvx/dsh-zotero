import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCollection,
  deleteCollection,
  deleteLibraryTags,
} from '../../src/local/write-domain.js'
import {
  SERVER_MISMATCH_MESSAGE,
  WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
  writeCollectionNameExistsMessage,
  writeObjectRefusedMessage,
  writeNonBlankMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
} from '../../src/errors.js'
import {
  COLLECTION_KEY,
  grantAuthorize,
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
  expectApplied,
} from '../helpers/write-domain-fixtures.js'
import { MockZotero } from '../helpers/mock-zotero.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

/** How many requests the mock served for one method and path. */
function count(method: string, pathname: string): number {
  return mock.requests.filter(
    (request) => request.method === method && request.pathname === pathname,
  ).length
}

/** Serve one collection read carrying both the object and library versions. */
function serveCollection(
  key: string,
  name: string,
  options: { serverId?: string; libraryVersion?: number; version?: number } = {},
): void {
  const headers: Record<string, string> = {
    'Zotero-Server-ID': options.serverId ?? SERVER_ID,
  }
  if (options.libraryVersion !== undefined) {
    headers['Last-Modified-Version'] = String(options.libraryVersion)
  }
  mock.route('GET', `/api/users/0/collections/${key}`, (_req, res, helpers) =>
    helpers.raw(
      200,
      headers,
      JSON.stringify({
        key,
        version: options.version ?? 3,
        library: { type: 'user', id: 0 },
        data: { key, version: options.version ?? 3, name },
      }),
    ),
  )
}

describe('createCollection', () => {
  it('refuses a blank name before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(createCollection(deps, { name: '   ' })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('name'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('refuses a sibling that already carries the name before any POST', async () => {
    const { deps } = writeDeps(mock)
    let thrown: unknown
    try {
      await createCollection(deps, { name: '方法论' })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(writeCollectionNameExistsMessage('方法论'))
    expect((thrown as { code?: string }).code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(count('POST', '/api/users/0/collections')).toBe(0)
  })

  it('creates a top-level collection and invalidates the scope directory', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    const onCollectionsChanged = vi.fn()
    const scoped = { ...deps, onCollectionsChanged }
    let entry: Record<string, unknown> | undefined
    mock.route('POST', '/api/users/0/collections', (_req, res, helpers) => {
      entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '[]')[0] as Record<
        string,
        unknown
      >
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '50' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'NEWCOLL1',
              version: 50,
              data: { key: 'NEWCOLL1', version: 50, name: 'Field notes' },
            },
          },
          success: { '0': 'NEWCOLL1' },
          unchanged: {},
          failed: {},
        }),
      )
    })
    // Warm the directory's listing cache first: the create must drop it.
    await deps.resolveCollection('方法论')
    const result = await createCollection(scoped, {
      name: 'Field notes',
    })
    expectApplied(result)
    expect(result.ref).toBe(`zotero://user/0/collection/NEWCOLL1?server=${SERVER_ID}`)
    expect(result.key).toBe('NEWCOLL1')
    expect(result.name).toBe('Field notes')
    expect(result.version).toBe(50)
    expect(result.libraryVersion).toBe(50)
    expect(entry).toEqual({ name: 'Field notes' })
    expect(onCollectionsChanged).toHaveBeenCalledTimes(1)
    const posted = mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/collections',
    )
    expect(posted?.headers['if-unmodified-since-version']).toBeUndefined()
  })

  it('creates a child collection under a resolved parent', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/collections', (_req, res, helpers) => {
      const body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '[]') as Record<
        string,
        unknown
      >[]
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '51' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'CHILDCOL',
              version: 51,
              data: {
                key: 'CHILDCOL',
                version: 51,
                name: 'Sub',
                parentCollection: COLLECTION_KEY,
              },
            },
          },
          success: { '0': 'CHILDCOL' },
          unchanged: {},
          failed: {},
        }),
      )
      void body
    })
    const result = await createCollection(deps, {
      name: 'Sub',
      parent: '方法论',
    })
    expectApplied(result)
    expect(result.parentRef).toBe(
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    )
    const posted = mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/collections',
    )
    expect(JSON.parse(posted?.body ?? '[]')[0]).toEqual({
      name: 'Sub',
      parentCollection: COLLECTION_KEY,
    })
  })

  it('returns a non-retryable committed-unverified result when the saved state is missing', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    const onCollectionsChanged = vi.fn()
    mock.route('POST', '/api/users/0/collections', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '52' },
        JSON.stringify({
          successful: {},
          success: { '0': 'NEWCOLL1' },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const result = await createCollection(
      { ...deps, onCollectionsChanged },
      { name: 'Field notes' },
    )
    expect(result).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      key: 'NEWCOLL1',
      serverId: SERVER_ID,
    })
    // A collection that may exist must still drop the cached listing.
    expect(onCollectionsChanged).toHaveBeenCalledTimes(1)
  })

  it('returns a non-retryable commit-unknown result when the response drops', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/collections', (_req, res) => {
      res.destroy()
    })
    await expect(createCollection(deps, { name: 'Field notes' })).resolves.toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: SERVER_ID,
    })
    expect(count('POST', '/api/users/0/collections')).toBe(1)
  })

  it('maps a per-object refusal onto the typed error its status names', async () => {
    grantAuthorize(mock)
    const { deps } = writeDeps(mock)
    mock.route('POST', '/api/users/0/collections', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '53' },
        JSON.stringify({
          successful: {},
          success: {},
          unchanged: {},
          failed: { '0': { key: '', code: 400, message: 'Invalid name' } },
        }),
      ),
    )
    await expect(createCollection(deps, { name: 'Field notes' })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeObjectRefusedMessage('Invalid name', 400),
    })
  })

  it('fails loud when the sibling listing is not an array', async () => {
    // The fixture owns the listing route, so this case runs its own server
    // whose listing is deliberately mis-shaped.
    const own = await MockZotero.start()
    try {
      own.route('GET', '/api/', (_req, res, helpers) =>
        helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
      )
      own.route('GET', '/api/users/0/collections/top', (_req, res, helpers) =>
        helpers.json({ collections: [] }, { 'Zotero-Server-ID': SERVER_ID, 'Total-Results': '0' }),
      )
      const { deps } = writeDeps(own)
      await expect(createCollection(deps, { name: 'Field notes' })).rejects.toMatchObject({
        code: ZOTERO_UNEXPECTED,
      })
      expect(
        own.requests.some(
          (request) => request.method === 'POST' && request.pathname.endsWith('/collections'),
        ),
      ).toBe(false)
    } finally {
      await own.close()
    }
  })

  it('fails loud when a sibling collection row is malformed', async () => {
    const own = await MockZotero.start()
    try {
      own.route('GET', '/api/', (_req, res, helpers) =>
        helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
      )
      own.route('GET', '/api/users/0/collections/top', (_req, res, helpers) =>
        helpers.raw(
          200,
          {
            'Zotero-Server-ID': SERVER_ID,
            'Total-Results': '1',
            'Last-Modified-Version': '10',
          },
          JSON.stringify([{ key: 'NOT_VALID_KEY', data: { name: 'Invalid' } }]),
        ),
      )
      const { deps } = writeDeps(own)
      await expect(createCollection(deps, { name: 'New Folder' })).rejects.toMatchObject({
        code: ZOTERO_UNEXPECTED,
        message: 'Zotero returned a malformed collection row in the sibling listing',
      })
    } finally {
      await own.close()
    }
  })

  it('fails loud when the sibling listing returns an empty page with remaining range', async () => {
    const own = await MockZotero.start()
    try {
      own.route('GET', '/api/', (_req, res, helpers) =>
        helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
      )
      own.route('GET', '/api/users/0/collections/top', (_req, res, helpers) =>
        helpers.raw(
          200,
          {
            'Zotero-Server-ID': SERVER_ID,
            'Total-Results': '10',
            'Last-Modified-Version': '10',
          },
          JSON.stringify([]),
        ),
      )
      const { deps } = writeDeps(own)
      await expect(createCollection(deps, { name: 'New Folder' })).rejects.toMatchObject({
        code: ZOTERO_UNEXPECTED,
        message:
          'Zotero returned an empty page for sibling collections at offset 0 but Total-Results is 10',
      })
    } finally {
      await own.close()
    }
  })
})

describe('deleteCollection', () => {
  it('refuses a blank collection before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: '  ' })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('collection'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('fails a name that resolves to nothing before any delete', async () => {
    const { deps } = writeDeps(mock)
    await expect(
      deleteCollection(deps, { collection: 'no such collection' }),
    ).rejects.toMatchObject({ code: ZOTERO_NOT_FOUND })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('reads the collection, then deletes under the library-version precondition', async () => {
    grantAuthorize(mock)
    serveCollection(SECOND_COLLECTION_KEY, 'Second', { libraryVersion: 30 })
    mock.route(
      'DELETE',
      `/api/users/0/collections/${SECOND_COLLECTION_KEY}`,
      (_req, res, helpers) =>
        helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '31' }, ''),
    )
    const { deps } = writeDeps(mock)
    const onCollectionsChanged = vi.fn()
    const result = await deleteCollection(
      { ...deps, onCollectionsChanged },
      { collection: 'Second' },
    )
    expect(result).toEqual({
      kind: 'deleted',
      ref: `zotero://user/0/collection/${SECOND_COLLECTION_KEY}?server=${SERVER_ID}`,
      key: SECOND_COLLECTION_KEY,
      deleted: true,
      libraryVersion: 31,
      serverId: SERVER_ID,
    })
    const deleted = mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.pathname).toBe(`/api/users/0/collections/${SECOND_COLLECTION_KEY}`)
    expect(deleted?.headers['if-unmodified-since-version']).toBe('30')
    // Exactly one collection read: it proves the name resolution's answer and
    // supplies the precondition — a second identical GET is a wasted round trip.
    expect(count('GET', `/api/users/0/collections/${SECOND_COLLECTION_KEY}`)).toBe(1)
    expect(onCollectionsChanged).toHaveBeenCalledTimes(1)
    expect(count('POST', '/api/local/authorize')).toBe(1)
  })

  it('fails loud when the delete read carries no library version', async () => {
    grantAuthorize(mock)
    serveCollection(SECOND_COLLECTION_KEY, 'Second')
    const { deps } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('rejects a delete read served by a different Zotero instance', async () => {
    serveCollection(SECOND_COLLECTION_KEY, 'Second', {
      serverId: 'OTHER1234',
      libraryVersion: 30,
    })
    const { deps } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
      message: SERVER_MISMATCH_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('maps a lost precondition onto the write conflict', async () => {
    grantAuthorize(mock)
    serveCollection(SECOND_COLLECTION_KEY, 'Second', { libraryVersion: 30 })
    mock.route(
      'DELETE',
      `/api/users/0/collections/${SECOND_COLLECTION_KEY}`,
      (_req, res, helpers) =>
        helpers.raw(
          412,
          { 'Content-Type': 'text/plain' },
          'item has been modified since specified version (expected 30, found 31)',
        ),
    )
    const { deps } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_WRITE_CONFLICT,
    })
  })

  it('maps a vanished collection onto a typed not-found refusal', async () => {
    grantAuthorize(mock)
    serveCollection(SECOND_COLLECTION_KEY, 'Second', { libraryVersion: 30 })
    mock.route(
      'DELETE',
      `/api/users/0/collections/${SECOND_COLLECTION_KEY}`,
      (_req, res, helpers) => helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    const { deps } = writeDeps(mock)
    await expect(deleteCollection(deps, { collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_NOT_FOUND,
      message: writeObjectRefusedMessage('The collection no longer exists.', 404),
    })
  })
})

describe('deleteLibraryTags', () => {
  /** Serve the library-version read and record the DELETE it precedes. */
  function serveLibraryVersion(version: number | undefined, serverId = SERVER_ID): void {
    const headers: Record<string, string> = { 'Zotero-Server-ID': serverId }
    if (version !== undefined) headers['Last-Modified-Version'] = String(version)
    mock.route('GET', '/api/users/0/items/top', (_req, res, helpers) =>
      helpers.raw(200, headers, JSON.stringify([])),
    )
  }

  it('refuses an empty or blank selection before any network', async () => {
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: [] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: 'tags must carry at least one item.',
    })
    await expect(deleteLibraryTags(deps, { tags: ['  '] })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: writeNonBlankMessage('tags'),
    })
    expect(mock.requests).toHaveLength(0)
  })

  it('reads the library version, then deletes the tag query under that precondition', async () => {
    grantAuthorize(mock)
    serveLibraryVersion(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const { deps } = writeDeps(mock)
    const result = await deleteLibraryTags(deps, { tags: ['legacy', 'methods'] })
    expect(result).toEqual({
      kind: 'deleted',
      deletedTags: ['legacy', 'methods'],
      libraryVersion: 89,
      serverId: SERVER_ID,
    })
    const versionRead = mock.requests.find(
      (request) => request.method === 'GET' && request.pathname === '/api/users/0/items/top',
    )
    expect(versionRead?.search.get('limit')).toBe('1')
    const deleted = mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.pathname).toBe('/api/users/0/tags')
    expect(deleted?.search.get('tag')).toBe('legacy||methods')
    expect(deleted?.headers['if-unmodified-since-version']).toBe('88')
  })

  it('encodes each tag name so spaces and operators survive the query', async () => {
    grantAuthorize(mock)
    serveLibraryVersion(12)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '13' }, ''),
    )
    const { deps } = writeDeps(mock)
    const result = await deleteLibraryTags(deps, { tags: ['to read', 'a|b'] })
    expect(result.deletedTags).toEqual(['a|b', 'to read'])
    const deleted = mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.search.getAll('tag')).toEqual(['to read||a|b'])
    expect(deleted?.pathname).toBe('/api/users/0/tags')
  })

  it('repeats the same receipt on a rerun, skipping a tag no item carries', async () => {
    grantAuthorize(mock)
    serveLibraryVersion(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const { deps } = writeDeps(mock)
    // The delete is a tag query: a requested name no item carries is skipped
    // rather than refused, so a rerun answers with the identical receipt.
    const first = await deleteLibraryTags(deps, { tags: ['gone', 'legacy'] })
    const second = await deleteLibraryTags(deps, { tags: ['gone', 'legacy'] })
    expect(second).toEqual(first)
    expect(first.deletedTags).toEqual(['gone', 'legacy'])
    expect(mock.requests.filter((request) => request.method === 'DELETE')).toHaveLength(2)
  })

  it('fails loud when the library-version read carries no version', async () => {
    grantAuthorize(mock)
    serveLibraryVersion(undefined)
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
      message: WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('rejects a library-version read served by a different Zotero instance', async () => {
    serveLibraryVersion(88, 'OTHER1234')
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
      code: ZOTERO_SERVER_MISMATCH,
      message: SERVER_MISMATCH_MESSAGE,
    })
    expect(mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  it('maps a lost precondition onto the write conflict', async () => {
    grantAuthorize(mock)
    serveLibraryVersion(88)
    mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(
        412,
        { 'Content-Type': 'text/plain' },
        'item has been modified since specified version (expected 88, found 89)',
      ),
    )
    const { deps } = writeDeps(mock)
    await expect(deleteLibraryTags(deps, { tags: ['legacy'] })).rejects.toMatchObject({
      code: ZOTERO_WRITE_CONFLICT,
    })
  })
})
