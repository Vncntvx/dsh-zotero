/**
 * The search page's instance identity: a response that names a different
 * serving instance than the scope claims must fail, while headerless answers
 * and unclaimed scopes stay lazy.
 * @module tests/local/search/search-server-identity
 */

import { afterEach, beforeEach, expect, it } from 'vitest'
import { ZOTERO_SERVER_MISMATCH } from '../../../src/errors.js'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { createProvider, request, searchOptions } from '../../helpers/provider-harness.js'
import { noteRow, searchHit } from '../../helpers/server/objects.js'
import { serveJson, serveSearchPage } from '../../helpers/server/serve.js'
import { COLLECTIONS } from './support.js'

const collectionScope = {
  kind: 'collection' as const,
  refOrName: 'zotero://user/0/collection/COLL1234?server=S1',
}
const pagePath = '/api/users/0/collections/COLL1234/items/top'
const libraryPagePath = '/api/users/0/items/top'

let mock: MockZotero
beforeEach(async () => {
  mock = await MockZotero.start()
})
afterEach(async () => {
  await mock.close()
})

it('refuses a search page served by a different instance than the scope claims', async () => {
  serveJson(mock, '/api/users/0/collections/COLL1234', COLLECTIONS[0], {
    'Zotero-Server-ID': 'S1',
  })
  serveSearchPage(mock, { items: [searchHit()], total: 1, path: pagePath, serverId: 'S2' })
  const provider = createProvider(mock)
  await expect(
    provider.search(request({ scope: collectionScope }), undefined, searchOptions()),
  ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
})

it('keeps a headerless page answer usable for a claimed scope', async () => {
  serveJson(mock, '/api/users/0/collections/COLL1234', COLLECTIONS[0], {
    'Zotero-Server-ID': 'S1',
  })
  serveSearchPage(mock, { items: [searchHit()], total: 1, path: pagePath, serverId: null })
  const provider = createProvider(mock)
  const result = await provider.search(
    request({ scope: collectionScope }),
    undefined,
    searchOptions(),
  )
  expect(result.items).toHaveLength(1)
})

it('adopts the serving instance for a scope that reported no identity', async () => {
  serveJson(mock, '/api/users/0/collections/COLL1234', COLLECTIONS[0])
  serveSearchPage(mock, { items: [searchHit()], total: 1, path: pagePath, serverId: 'S2' })
  const provider = createProvider(mock)
  const result = await provider.search(
    request({ scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' } }),
    undefined,
    searchOptions(),
  )
  expect(result.items).toHaveLength(1)
  expect(result.items[0]!.ref).toContain('server=S2')
})

it('pins supplemental notes to the server discovered by the primary page', async () => {
  serveSearchPage(mock, { path: libraryPagePath, items: [searchHit()], total: 1, serverId: 'S1' })
  serveJson(mock, '/api/users/0/items', [noteRow({ data: { note: 'cascade' } })], {
    'Zotero-Server-ID': 'S2',
  })
  const provider = createProvider(mock)
  await expect(
    provider.search(request({ query: 'cascade' }), undefined, searchOptions()),
  ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
})

it('retains the first reported instance across note pages after a headerless primary page', async () => {
  serveSearchPage(mock, { path: libraryPagePath, items: [searchHit()], total: 1, serverId: null })
  mock.route('GET', '/api/users/0/items', (_req, _res, helpers, search) => {
    if (search.get('start') === '0') {
      helpers.json([noteRow({ data: { note: 'unrelated' } })], { 'Zotero-Server-ID': 'S1' })
    } else {
      helpers.json([], { 'Zotero-Server-ID': 'S2' })
    }
  })
  const provider = createProvider(mock, { maxNoteScanRecords: 1 })
  await expect(
    provider.search(request({ query: 'cascade' }), undefined, searchOptions()),
  ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
})
