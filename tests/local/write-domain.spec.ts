import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZoteroHttpClient } from '../../src/http-client.js'
import { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { WriteAuthorizer } from '../../src/write-auth.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import {
  WRITE_CAPABILITY_UNAVAILABLE_CODE,
  addToCollection,
  createNote,
  updateTags,
  writeCapabilityUnavailableMessage,
} from '../../src/local/write-domain.js'
import { LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { parseRef } from '../../src/refs.js'
import {
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
  writeObjectRefusedMessage,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_UNAUTHORIZED,
} from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'

const SERVER_ID = 'srv-write-domain-1'
const ITEM_KEY = 'ITEMABC1'
const NEW_KEY = 'NEWNOTE1'
const COLLECTION_KEY = 'COLL1234'

const LIMITS: LocalApiLimits = {
  maxNoteScanRecords: 200,
  maxDetailChars: 500,
  maxNoteBodyChars: 30_000,
  maxNoteChars: 2000,
  maxNoteRecords: 50,
  maxAnnotationRecords: 100,
  fulltextChunkWords: 200,
  maxEvidenceChars: 6000,
  maxEvidencePassages: 4,
  maxFulltextChars: 100_000,
  maxExportChars: 1_000_000,
  defaultStyle: 'apa',
  defaultLocale: 'en-US',
  maxBrowseResults: 50,
  maxChangesResults: 50,
}

let mock: MockZotero

function itemJson(key: string, version: number, data: Record<string, unknown> = {}): unknown {
  return {
    key,
    version,
    library: { type: 'user', id: 0, name: 'Personal' },
    links: {},
    meta: {},
    data: { key, version, itemType: 'journalArticle', ...data },
  }
}

function batchBody(key: string, version: number, data: Record<string, unknown>): string {
  return JSON.stringify({
    successful: { '0': { key, version, data: { key, version, ...data } } },
    success: { '0': key },
    unchanged: {},
    failed: {},
  })
}

function batchHeaders(version: number): Record<string, string> {
  return { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': String(version) }
}

function writeDeps(): {
  deps: { client: ZoteroHttpClient; writer: ZoteroWriteHttpClient; authorizer: WriteAuthorizer }
  directory: ScopeDirectory
  authorizer: WriteAuthorizer
} {
  const client = new ZoteroHttpClient({
    baseUrl: mock.baseUrl,
    timeoutMs: 5000,
    maxResponseBytes: 1_000_000,
  })
  const writer = new ZoteroWriteHttpClient({
    baseUrl: mock.baseUrl,
    timeoutMs: 5000,
    maxResponseBytes: 1_000_000,
  })
  const authorizer = new WriteAuthorizer({ client: writer, persistKey: () => true })
  return {
    deps: { client, writer, authorizer },
    directory: new ScopeDirectory(client, 1000),
    authorizer,
  }
}

/** Register the authorize dialog answering with a persistent grant. */
function grantAuthorize(): void {
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'R'.repeat(32), remember: true }),
    ),
  )
}

function resolveThrough(directory: ScopeDirectory) {
  return (refOrName: string, signal?: AbortSignal) =>
    directory
      .resolveNamed('collection', refOrName, { type: 'user', id: 0 }, signal)
      .then((r) => r.ref)
}

const ITEM_REF = parseRef(`zotero://user/0/item/${ITEM_KEY}`)
const SOURCE_REF = parseRef('zotero://user/0/item/SOURCE01')

beforeEach(async () => {
  mock = await MockZotero.start()
  mock.route('GET', '/api/', (_req, res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
  )
  mock.route('GET', '/api/users/0/collections', (_req, res, helpers) =>
    helpers.json([
      {
        key: COLLECTION_KEY,
        version: 3,
        library: { type: 'user', id: 0 },
        data: { key: COLLECTION_KEY, name: '方法论' },
      },
    ]),
  )
  mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, res, helpers) =>
    helpers.json({
      key: COLLECTION_KEY,
      version: 3,
      library: { type: 'user', id: 0 },
      data: { key: COLLECTION_KEY, name: '方法论' },
    }),
  )
})

afterEach(async () => {
  await mock.close()
})

describe('createNote', () => {
  it('creates a standalone note with tags, a collection by name, and source relations, reading the saved state back from the batch', async () => {
    grantAuthorize()
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
          relations: { 'dc:relation': 'http://zotero.org/users/0/items/SOURCE01' },
        }),
      )
    })
    const { deps, directory } = writeDeps()
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: '**方法**：见第 2 节。',
      collections: ['方法论'],
      tags: ['methods'],
      sourceRefs: [SOURCE_REF],
    })
    expect(result.kind).toBe('applied')
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

  it('creates a child note under its parent with relations and without collections', async () => {
    grantAuthorize()
    let entry: Record<string, unknown> | undefined
    mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}')[0] as Record<
        string,
        unknown
      >
      helpers.raw(200, batchHeaders(43), batchBody(NEW_KEY, 43, { parentItem: ITEM_KEY }))
    })
    const { deps, directory } = writeDeps()
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'reads it',
      parentItem: ITEM_REF,
      sourceRefs: [SOURCE_REF],
    })
    expect(result.parentItem).toBe(`zotero://user/0/item/${ITEM_KEY}?server=${SERVER_ID}`)
    expect(result.collections).toEqual([])
    expect(entry?.parentItem).toBe(ITEM_KEY)
    expect(entry?.collections).toBeUndefined()
  })

  it('refuses collections on a child note when the domain is called without the tool layer', async () => {
    // Dual-end invariant: tools/create-note buildRequest already refuses this
    // on the model path; this spec pins the domain gate for direct callers.
    const { deps, directory } = writeDeps()
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

  it('refuses a group-library target', async () => {
    const { deps, directory } = writeDeps()
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
  })

  it('maps a per-object refusal to the typed error its status names', async () => {
    grantAuthorize()
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
    const { deps, directory } = writeDeps()
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
    const { deps, directory } = writeDeps()
    const result = await createNote(deps, resolveThrough(directory), { markdown: 'x' })
    expect(result.kind).toBe('applied')
    expect(posts).toBe(2)
    expect(
      mock.requests.filter((request) => request.pathname === '/api/local/authorize'),
    ).toHaveLength(2)
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
    const { deps, directory } = writeDeps()
    let thrown: unknown
    try {
      await createNote(deps, resolveThrough(directory), { markdown: 'x' })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_UNAUTHORIZED)
  })
})

describe('updateTags', () => {
  function serveItem(data: Record<string, unknown>): void {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify(itemJson(ITEM_KEY, 10, data)),
      ),
    )
  }

  it('merges additions under the item version precondition and preserves tag types', async () => {
    grantAuthorize()
    serveItem({ tags: [{ tag: 'existing', type: 1 }] })
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }, '')
    })
    const { deps } = writeDeps()
    const result = await updateTags(deps, { item: ITEM_REF, tags: ['new', 'existing'] })
    expect(result.unchanged).toBe(false)
    expect(result.added).toEqual(['new'])
    expect(result.tags).toEqual(['existing', 'new'])
    expect(result.version).toBe(12)
    expect(result.libraryVersion).toBe(12)
    expect(body).toEqual({ tags: [{ tag: 'existing', type: 1 }, { tag: 'new' }] })
  })

  it('reports unchanged and sends nothing when every tag is already present', async () => {
    serveItem({ tags: [{ tag: 'existing' }] })
    const { deps } = writeDeps()
    const result = await updateTags(deps, { item: ITEM_REF, tags: ['existing'] })
    expect(result.unchanged).toBe(true)
    expect(result.libraryVersion).toBeUndefined()
    expect(result.added).toEqual([])
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('fails loud when the read backing the write lacks the object version', async () => {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify([1, 2])),
    )
    const { deps } = writeDeps()
    let thrown: unknown
    try {
      await updateTags(deps, { item: ITEM_REF, tags: ['new'] })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_VERSION_MISSING_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_UNEXPECTED)
  })

  it('falls back to the requested collections when the saved state omits them', async () => {
    grantAuthorize()
    let entry: Record<string, unknown> | undefined
    mock.route('POST', '/api/users/0/items', (req, res, helpers) => {
      entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '[]')[0] as Record<
        string,
        unknown
      >
      helpers.raw(200, batchHeaders(46), batchBody(NEW_KEY, 46, { itemType: 'note' }))
    })
    const { deps, directory } = writeDeps()
    const result = await createNote(deps, resolveThrough(directory), {
      markdown: 'x',
      collections: ['方法论'],
    })
    expect(result.kind).toBe('applied')
    expect(result.collections).toEqual([
      `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
    ])
    expect(entry?.collections).toEqual([COLLECTION_KEY])
  })

  it('maps a lost precondition to the re-run guidance', async () => {
    grantAuthorize()
    serveItem({ tags: [] })
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        412,
        { 'Content-Type': 'text/plain' },
        'item has been modified since specified version (expected 10, found 11)',
      ),
    )
    const { deps } = writeDeps()
    let thrown: unknown
    try {
      await updateTags(deps, { item: ITEM_REF, tags: ['new'] })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe(WRITE_CONFLICT_MESSAGE)
    expect((thrown as { code?: string }).code).toBe(ZOTERO_WRITE_CONFLICT)
  })
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

  it('adds the collection by name under the version precondition', async () => {
    grantAuthorize()
    serveItem([])
    let body: Record<string, unknown> | undefined
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '13' }, '')
    })
    const { deps, directory } = writeDeps()
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
    const { deps, directory } = writeDeps()
    const result = await addToCollection(deps, resolveThrough(directory), {
      item: ITEM_REF,
      collection: `zotero://user/0/collection/${COLLECTION_KEY}`,
    })
    expect(result.added).toBe(false)
    expect(result.version).toBe(10)
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('fails a collection name that resolves to nothing before any read-modify-write', async () => {
    const { deps, directory } = writeDeps()
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
