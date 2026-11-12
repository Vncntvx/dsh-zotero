/**
 * Search result shaping and the filtered-search index lifecycle: an empty
 * query reports itself as empty, an empty filtered page still offers next
 * actions, a stored index serves later pages without a rescan, a rescan that
 * keeps drifting fails loud, listings without instance/version headers are
 * served unqualified, and collection-scope note scans carry the caller's
 * signal while omitting an absent server claim.
 * @module tests/local/search/search-domain-paging
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../../src/http-client.js'
import { ZOTERO_UNEXPECTED } from '../../../src/errors.js'
import { runSearch } from '../../../src/local/search-domain.js'
import { createSearchIndexCaches } from '../../../src/local/search-index.js'
import { ScopeDirectory } from '../../../src/local/scope-directory.js'
import {
  PROVIDER_LIMITS,
  request,
  searchOptions,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../../helpers/provider-harness.js'
import { SERVER_ID, COLLECTION_KEY, collectionRef } from '../../helpers/server/keys.js'
import { collectionRow, item, noteRow, searchHit } from '../../helpers/server/objects.js'
import { serveJson, serveSearchPage } from '../../helpers/server/serve.js'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { deferred } from '../../helpers/sync.js'

let harness: ProviderHarness
let mock: MockZotero

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
})

afterEach(async () => {
  await teardownProvider(harness)
})

/** Three 2023 candidates the year filter accepts. */
function yearRows(): ReturnType<typeof searchHit>[] {
  return ['ITEM0001', 'ITEM0002', 'ITEM0003'].map((key) =>
    searchHit({ key, data: { title: `Paper ${key}`, date: '2023' }, meta: { parsedDate: '2023' } }),
  )
}

function listingReads(): number {
  return mock.requests.filter((entry) => entry.pathname.endsWith('/items/top')).length
}

function batchRequests(): MockZotero['requests'] {
  return mock.requests.filter((entry) => entry.search.get('itemKey') !== null)
}

describe('search result shaping', () => {
  it('reports a missing query as empty and does not scan notes', async () => {
    serveSearchPage(mock, { items: [searchHit()], total: 1 })
    const result = await harness.provider.search(request({}), undefined, searchOptions())
    expect(result.queryWasEmpty).toBe(true)
    expect(result.normalizedQuery).toBe('')
    expect(mock.requests).toHaveLength(1)
  })

  it('offers next actions when a filtered page has no accepted rows', async () => {
    serveSearchPage(mock, {
      items: [
        searchHit({
          data: { title: 'Old Paper', date: '2020' },
          meta: { parsedDate: '2020-01-01' },
        }),
      ],
      total: 1,
    })
    const result = await harness.provider.search(request({ yearFrom: 2025 }), undefined, {
      includeSupplemental: false,
    })
    expect(result.total).toBe(0)
    expect(result.items).toEqual([])
    expect(result.nextActions).toEqual([
      'Try a DOI',
      'Shorten the title',
      'Add an author surname',
      'Search a collection scope',
    ])
  })
})

describe('filtered search index lifecycle', () => {
  it('serves a second page from the stored index without rescanning the listing', async () => {
    const rows = yearRows()
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      const itemKey = search.get('itemKey')
      if (itemKey !== null) {
        helpers.json(
          rows.filter((row) => itemKey.split(',').includes(row.key)),
          { 'Total-Results': String(rows.length), 'Zotero-Server-ID': SERVER_ID },
        )
        return
      }
      helpers.json(rows, {
        'Total-Results': String(rows.length),
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '7',
      })
    })
    const filter = { yearFrom: 2023, query: 'Paper', limit: 3 }
    const first = await harness.provider.search(request(filter), undefined, {
      includeSupplemental: false,
    })
    const second = await harness.provider.search(request(filter), undefined, {
      includeSupplemental: false,
    })
    expect(second.queryWasEmpty).toBe(false)
    expect(second.items.map((entry) => entry.ref)).toEqual(first.items.map((entry) => entry.ref))
    expect(listingReads()).toBe(1)
    expect(batchRequests()).toHaveLength(2)
  })

  it('fails loud when the one allowed rescan still disagrees with the stored index', async () => {
    const rows = yearRows()
    let batchVersion = '7'
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      const itemKey = search.get('itemKey')
      if (itemKey !== null) {
        const keys = itemKey.split(',')
        helpers.json(
          rows.filter((row) => keys.includes(row.key)),
          {
            'Total-Results': String(rows.length),
            'Zotero-Server-ID': SERVER_ID,
            'Last-Modified-Version': batchVersion,
          },
        )
        return
      }
      helpers.json(rows, {
        'Total-Results': String(rows.length),
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '7',
      })
    })
    const filter = { yearFrom: 2023, limit: 1 }
    await harness.provider.search(request(filter), undefined, { includeSupplemental: false })
    batchVersion = '8'
    await zoteroError(
      harness.provider.search(request(filter), undefined, { includeSupplemental: false }),
      ZOTERO_UNEXPECTED,
      'The library changed while a filtered search page was served',
    )
    expect(listingReads()).toBe(2)
  })

  it('serves a page unqualified when the listing reports no instance or version', async () => {
    const rows = yearRows().slice(0, 1)
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      const itemKey = search.get('itemKey')
      if (itemKey !== null) {
        helpers.json(rows, { 'Total-Results': String(rows.length) })
        return
      }
      helpers.json(rows, { 'Total-Results': String(rows.length) })
    })
    const result = await harness.provider.search(request({ yearFrom: 2023, limit: 1 }), undefined, {
      includeSupplemental: false,
    })
    expect(result.items.map((entry) => entry.ref)).toEqual(['zotero://user/0/item/ITEM0001'])
    expect(batchRequests()[0]?.headers['zotero-server-id']).toBeUndefined()
  })
})

describe('collection note scan identity and cancellation', () => {
  it('omits the parent-batch server claim when the collection resolved without one', async () => {
    serveJson(mock, '/api/users/0/collections/COLL1234', collectionRow())
    serveJson(mock, '/api/users/0/collections/COLL1234/items/top', [], { 'Total-Results': '0' })
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        helpers.json([noteRow({ data: { note: 'cascade risk', parentItem: 'PARE1111' } })])
        return
      }
      if (search.get('itemKey') !== null) {
        helpers.json([item({ key: 'PARE1111', data: { collections: [COLLECTION_KEY] } })], {
          'Total-Results': '1',
        })
        return
      }
      helpers.raw(500, {}, 'unexpected read')
    })
    const result = await harness.provider.search(
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: collectionRef() },
      }),
      undefined,
      searchOptions(),
    )
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
    ])
    const parentBatch = batchRequests()[0]
    expect(parentBatch?.search.get('itemKey')).toBe('PARE1111')
    expect(parentBatch?.headers['zotero-server-id']).toBeUndefined()
  })

  it('cancels the parent membership batch when the caller aborts mid-read', async () => {
    const started = deferred<void>()
    let parentSignal: AbortSignal | undefined
    const getJson = vi.fn(
      async (
        path: string,
        params?: URLSearchParams,
        options?: { serverId?: string; signal?: AbortSignal },
      ) => {
        if (path === 'users/0/collections/COLL1234') {
          return {
            json: collectionRow(),
            headers: new Headers({ 'Zotero-Server-ID': SERVER_ID }),
          }
        }
        if (path === 'users/0/collections/COLL1234/items/top') {
          return {
            json: [],
            headers: new Headers({ 'Total-Results': '0', 'Zotero-Server-ID': SERVER_ID }),
          }
        }
        if (path === 'users/0/items' && params?.get('itemType') === 'note') {
          return {
            json: [noteRow({ data: { note: 'cascade risk', parentItem: 'PARE1111' } })],
            headers: new Headers(),
          }
        }
        if (path === 'users/0/items' && params?.get('itemKey') !== null) {
          parentSignal = options?.signal
          started.resolve()
          return await new Promise<never>((_resolve, reject) => {
            const signal = options?.signal
            if (signal?.aborted === true) reject(signal.reason)
            else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
        throw new Error(`unexpected read ${path}`)
      },
    )
    const client = { getJson } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => 30_000,
      () => 2,
    )
    const controller = new AbortController()
    const search = runSearch(
      { client, limits: PROVIDER_LIMITS, searchCaches: createSearchIndexCaches() },
      directory,
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: collectionRef() },
      }),
      controller.signal,
      { includeSupplemental: true },
    )
    await started.promise
    controller.abort()
    await expect(search).rejects.toMatchObject({ name: 'AbortError' })
    expect(parentSignal?.aborted).toBe(true)
  })
})
