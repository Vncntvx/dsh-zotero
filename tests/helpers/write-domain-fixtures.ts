/**
 * Shared fixtures for the write-domain specs (the eight entries: createNote /
 * updateItemTags / updateItemCollections / createCollection / deleteCollection
 * / createItem / updateItem / deleteLibraryTags). One source so those specs
 * cannot drift on mock shape, key constants, or the authorizer wiring.
 * @module dsh-zotero/tests/helpers/write-domain-fixtures
 */

import type { ZoteroHttpClient } from '../../src/http-client.js'
import type { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { WriteAuthorizer } from '../../src/write-auth.js'
import { resolveCollectionsMixed, ScopeDirectory } from '../../src/local/scope-directory.js'
import { fetchItemTypeFields } from '../../src/local/write-domain.js'
import { PERSONAL_LIBRARY, parseRef } from '../../src/refs.js'
import type { WriteDomainDeps } from '../../src/local/write-domain.js'
import type { ZoteroObjectRef } from '../../src/types.js'
import { MockZotero } from './mock-zotero.js'
import { testHttpClient, testWriteClient } from './test-clients.js'

export const SERVER_ID = 'srv-write-domain-1'
export const ITEM_KEY = 'ITEMABC1'
export const NEW_KEY = 'NEWNOTE1'
export const COLLECTION_KEY = 'COLL1234'
export const SECOND_COLLECTION_KEY = 'COLL5678'

export const ITEM_REF: ZoteroObjectRef = parseRef(`zotero://user/0/item/${ITEM_KEY}`)
export const SOURCE_REF: ZoteroObjectRef = parseRef('zotero://user/0/item/SOURCE01')

export function itemJson(
  key: string,
  version: number,
  data: Record<string, unknown> = {},
): unknown {
  return {
    key,
    version,
    library: { type: 'user', id: 0, name: 'Personal' },
    links: {},
    meta: {},
    data: { key, version, itemType: 'journalArticle', ...data },
  }
}

export function batchBody(key: string, version: number, data: Record<string, unknown>): string {
  return JSON.stringify({
    successful: {
      '0': {
        key,
        version,
        data: { key, version, itemType: 'note', note: '<p>x</p>', ...data },
      },
    },
    success: { '0': key },
    unchanged: {},
    failed: {},
  })
}

export function batchHeaders(version: number): Record<string, string> {
  return { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': String(version) }
}

export function writeDeps(mock: MockZotero): {
  deps: WriteDomainDeps
  directory: ScopeDirectory
  authorizer: WriteAuthorizer
} {
  const client = testHttpClient(mock.baseUrl, { maxResponseBytes: 1_000_000 })
  const writer = testWriteClient(mock.baseUrl, { maxResponseBytes: 1_000_000 })
  const authorizer = new WriteAuthorizer({ client: writer, persistKey: () => true })
  const directory = new ScopeDirectory(client, () => 1000)
  const deps: WriteDomainDeps = {
    client,
    writer,
    authorizer,
    resolveCollection: (refOrName, signal) =>
      resolveCollectionsMixed(
        directory,
        [refOrName],
        PERSONAL_LIBRARY,
        signal,
        client.serverId,
      ).then((refs) => refs[0]!),
    resolveCollections: (inputs, signal) =>
      resolveCollectionsMixed(directory, inputs, PERSONAL_LIBRARY, signal, client.serverId),
    itemTypeFields: (itemType, signal) => fetchItemTypeFields({ client }, itemType, signal),
    onCollectionsChanged: () => directory.invalidate(PERSONAL_LIBRARY, 'collections'),
  }
  return { deps, directory, authorizer }
}

/**
 * Serve one item read for a write precondition — the one home for this route
 * so the write-domain specs cannot drift on mock shape. The default body is
 * the standard `itemJson` shape with both write-relevant arrays present;
 * `body` replaces it verbatim (malformed shapes), `serverId` varies the
 * identity, and `version: 'omit'` drops the version header the way a
 * protocol-drift mock would.
 */
export function serveItemRead(
  mock: MockZotero,
  options: {
    key?: string
    data?: Record<string, unknown>
    body?: unknown
    serverId?: string
    version?: number | 'omit'
  } = {},
): void {
  const key = options.key ?? ITEM_KEY
  const headers: Record<string, string> = {
    'Zotero-Server-ID': options.serverId ?? SERVER_ID,
  }
  if (options.version !== 'omit') {
    const version = options.version ?? 10
    headers['Last-Modified-Version'] = String(version)
  }
  const payload =
    options.body ??
    itemJson(key, options.version === 'omit' ? 10 : (options.version ?? 10), {
      tags: [],
      collections: [],
      ...options.data,
    })
  mock.route('GET', `/api/users/0/items/${key}`, (_req, res, helpers) =>
    helpers.raw(200, headers, JSON.stringify(payload)),
  )
}

/** Register the authorize dialog answering with a persistent grant. */
export function grantAuthorize(mock: MockZotero): void {
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'R'.repeat(32), remember: true }),
    ),
  )
}

/** Start the mock with the identity and collection listing every write spec needs. */
export async function startWriteDomainMock(): Promise<MockZotero> {
  const mock = await MockZotero.start()
  mock.route('GET', '/api/', (_req, res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
  )
  mock.route('GET', '/api/users/0/collections', (_req, res, helpers) =>
    helpers.json(
      [
        {
          key: COLLECTION_KEY,
          version: 3,
          library: { type: 'user', id: 0 },
          data: { key: COLLECTION_KEY, name: '方法论' },
        },
        {
          key: SECOND_COLLECTION_KEY,
          version: 4,
          library: { type: 'user', id: 0 },
          data: { key: SECOND_COLLECTION_KEY, name: 'Second' },
        },
      ],
      { 'Zotero-Server-ID': SERVER_ID },
    ),
  )
  // The sibling-name check reads the parent's children (or the top level)
  // paginated with an honest total, so both shapes are served here.
  mock.route('GET', '/api/users/0/collections/top', (_req, res, helpers) =>
    helpers.json(
      [
        {
          key: COLLECTION_KEY,
          version: 3,
          library: { type: 'user', id: 0 },
          data: { key: COLLECTION_KEY, name: '方法论' },
        },
        {
          key: SECOND_COLLECTION_KEY,
          version: 4,
          library: { type: 'user', id: 0 },
          data: { key: SECOND_COLLECTION_KEY, name: 'Second' },
        },
      ],
      { 'Zotero-Server-ID': SERVER_ID, 'Total-Results': '2' },
    ),
  )
  mock.route(
    'GET',
    `/api/users/0/collections/${COLLECTION_KEY}/collections`,
    (_req, res, helpers) =>
      helpers.json([], { 'Zotero-Server-ID': SERVER_ID, 'Total-Results': '0' }),
  )
  mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, res, helpers) =>
    helpers.json({
      key: COLLECTION_KEY,
      version: 3,
      library: { type: 'user', id: 0 },
      data: { key: COLLECTION_KEY, name: '方法论' },
    }),
  )
  return mock
}

/**
 * Narrow a write-domain result to its `applied` arm so tests can read the
 * saved fields without casting. Throws with the actual kind on mismatch.
 */
export function expectApplied<T extends { kind: string }>(
  result: T,
): asserts result is Extract<T, { kind: 'applied' }> {
  if (result.kind !== 'applied') {
    throw new Error(`expected kind "applied", got ${JSON.stringify(result.kind)}`)
  }
}
