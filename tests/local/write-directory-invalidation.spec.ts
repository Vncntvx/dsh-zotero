/**
 * The provider's post-write directory invalidation, end to end (W4): a
 * collection write drops the cached scope listing, so a name that resolved a
 * moment ago stops resolving instead of being served from a stale cache. The
 * domain only calls `onCollectionsChanged`; the provider is what wires that
 * callback onto the directory, so the wiring is what this pins.
 * @module tests/local/write-directory-invalidation
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalApiProvider } from '../../src/local/provider.js'
import { WriteAuthorizer } from '../../src/write-auth.js'
import { ZOTERO_NOT_FOUND } from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { testHttpClient, testWriteClient } from '../helpers/test-clients.js'
import {
  SECOND_COLLECTION_KEY,
  SERVER_ID,
  grantAuthorize,
} from '../helpers/write-domain-fixtures.js'

let mock: MockZotero

beforeEach(async () => {
  mock = await MockZotero.start()
})

afterEach(async () => {
  await mock.close()
})

/**
 * Serve the collections listing from whatever array the case passes. The
 * route closes over it, so a test can drop an entry after the first resolve
 * and let the cache prove which answer a later resolve used.
 */
function serveListing(rows: readonly { key: string; name: string }[]): void {
  mock.route('GET', '/api/users/0/collections', (_req, res, helpers) =>
    helpers.json(
      rows.map((entry) => ({
        key: entry.key,
        version: 4,
        library: { type: 'user', id: 0 },
        data: { key: entry.key, name: entry.name },
      })),
    ),
  )
}

/** One provider carrying the write collaborators the capability needs. */
function createWritableProvider(): LocalApiProvider {
  const client = testHttpClient(mock.baseUrl, { maxResponseBytes: 1_000_000 })
  const writer = testWriteClient(mock.baseUrl, { maxResponseBytes: 1_000_000 })
  return new LocalApiProvider(
    client,
    PROVIDER_LIMITS,
    writer,
    new WriteAuthorizer({ client: writer, persistKey: () => true }),
  )
}

describe('a collection write invalidates the scope directory', () => {
  it('stops resolving the deleted name instead of serving the cached listing', async () => {
    grantAuthorize(mock)
    mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
    )
    const rows = [{ key: SECOND_COLLECTION_KEY, name: 'Second' }]
    serveListing(rows)
    mock.route('GET', `/api/users/0/collections/${SECOND_COLLECTION_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '4' },
        JSON.stringify({
          key: SECOND_COLLECTION_KEY,
          version: 4,
          library: { type: 'user', id: 0 },
          data: { key: SECOND_COLLECTION_KEY, name: 'Second' },
        }),
      ),
    )
    mock.route(
      'DELETE',
      `/api/users/0/collections/${SECOND_COLLECTION_KEY}`,
      (_req, res, helpers) =>
        helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '5' }, ''),
    )
    const provider = createWritableProvider()

    // First pass: the name resolves through the listing and the delete runs.
    const deleted = await provider.deleteCollection({ collection: 'Second' })
    expect(deleted).toMatchObject({
      kind: 'deleted',
      key: SECOND_COLLECTION_KEY,
      libraryVersion: 5,
    })

    // Zotero no longer has it: the listing answers without the entry. A
    // resolver still holding the cached listing would resolve again and reach
    // the object read; only an invalidated one fails at the name.
    rows.splice(0, rows.length)
    await expect(provider.deleteCollection({ collection: 'Second' })).rejects.toMatchObject({
      code: ZOTERO_NOT_FOUND,
      message: `No collection named "Second" was found.`,
    })
    const deletes = mock.requests.filter((request) => request.method === 'DELETE')
    expect(deletes).toHaveLength(1)
  })
})
