/**
 * Shared fixtures for the write-domain specs (createNote / updateTags /
 * addToCollection). One source so the three specs cannot drift on mock
 * shape, key constants, or the authorizer wiring.
 * @module dsh-zotero/tests/helpers/write-domain-fixtures
 */

import { ZoteroHttpClient } from '../../src/http-client.js'
import { ZoteroWriteHttpClient } from '../../src/write-http.js'
import { WriteAuthorizer } from '../../src/write-auth.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { parseRef } from '../../src/refs.js'
import type { ZoteroObjectRef } from '../../src/types.js'
import { MockZotero } from './mock-zotero.js'

export const SERVER_ID = 'srv-write-domain-1'
export const ITEM_KEY = 'ITEMABC1'
export const NEW_KEY = 'NEWNOTE1'
export const COLLECTION_KEY = 'COLL1234'
export const SECOND_COLLECTION_KEY = 'COLL5678'

export const LIMITS: LocalApiLimits = {
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
export function grantAuthorize(mock: MockZotero): void {
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'R'.repeat(32), remember: true }),
    ),
  )
}

export function resolveThrough(directory: ScopeDirectory) {
  return (refOrName: string, signal?: AbortSignal) =>
    directory
      .resolveNamed('collection', refOrName, { type: 'user', id: 0 }, signal)
      .then((r) => r.ref)
}

/** Start the mock with the identity and collection listing every write spec needs. */
export async function startWriteDomainMock(): Promise<MockZotero> {
  const mock = await MockZotero.start()
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
      {
        key: SECOND_COLLECTION_KEY,
        version: 4,
        library: { type: 'user', id: 0 },
        data: { key: SECOND_COLLECTION_KEY, name: 'Second' },
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
