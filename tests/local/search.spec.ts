/**
 * The `zotero_search` provider contract for a scope and its filters: query
 * serialization, scope resolution (library / collection / saved search), and
 * the failures those resolutions raise. The client-side note-content scan the
 * first page merges in is a separate mechanism with its own spec, in
 * `search-scan.spec.ts`.
 * @module tests/local/search
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
} from '../../src/errors.js'
import {
  buildSearchParams,
  encodeExcludeTag,
  encodeLiteralTag,
} from '../../src/local/search-domain.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  request,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, expectRequestPaths } from '../helpers/server/assert.js'
import { COLLECTION_KEY, ITEM_KEY, SERVER_ID } from '../helpers/server/keys.js'
import { collectionRow, savedSearchRow, searchHit } from '../helpers/server/objects.js'
import { serveJson, serveSearchPage, serveStatus } from '../helpers/server/serve.js'
import { COLLECTIONS, SEARCHES, makeProvider } from './search-helpers.js'

let mock: MockZotero
let provider: LocalApiProvider
let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
  provider = harness.provider
})

afterEach(async () => {
  await teardownProvider(harness)
})

describe('buildSearchParams', () => {
  it('omits q/qmode for a metadata query and serializes every explicit filter', () => {
    const params = buildSearchParams(
      request({
        query: 'flash attention',
        itemTypes: ['journalArticle', 'conferencePaper'],
        tags: ['reviewed', '-draft'],
        sort: 'dateAdded',
        direction: 'asc',
        offset: 20,
        limit: 5,
      }),
    )
    expect(params.get('q')).toBe('flash attention')
    expect(params.has('qmode')).toBe(false)
    expect(params.get('itemType')).toBe('journalArticle || conferencePaper')
    expect(params.getAll('tag')).toEqual(['reviewed', '\\-draft'])
    expect(params.get('sort')).toBe('dateAdded')
    expect(params.get('direction')).toBe('asc')
    expect(params.get('start')).toBe('20')
    expect(params.get('limit')).toBe('5')
  })

  it('sets qmode=everything only for full-text mode and omits empty filters', () => {
    const params = buildSearchParams(request({ mode: 'everything', query: 'work partitioning' }))
    expect(params.get('qmode')).toBe('everything')
    expect(params.has('itemType')).toBe(false)
    expect(params.getAll('tag')).toEqual([])
  })

  it('omits an empty query entirely', () => {
    const params = buildSearchParams(request({ query: '' }))
    expect(params.has('q')).toBe(false)
    expect(params.has('qmode')).toBe(false)
  })

  it('omits an empty itemTypes list', () => {
    const params = buildSearchParams(request({ itemTypes: [] }))
    expect(params.has('itemType')).toBe(false)
  })

  it('serializes excludeTags as - + escaped literal', () => {
    const params = buildSearchParams(request({ excludeTags: ['-foo', 'bar'] }))
    expect(params.getAll('tag')).toEqual(['-\\-foo', '-bar'])
  })

  it('serializes tagMatch any as one OR list and all as repeated tags', () => {
    const any = buildSearchParams(request({ tags: ['a', 'b'], tagMatch: 'any' }))
    expect(any.get('tag')).toBe('a || b')
    const all = buildSearchParams(request({ tags: ['a', 'b'], tagMatch: 'all' }))
    expect(all.getAll('tag')).toEqual(['a', 'b'])
  })
})

describe('encodeLiteralTag', () => {
  it('escapes a leading dash so literal tags never negate', () => {
    expect(encodeLiteralTag('-draft')).toBe('\\-draft')
    expect(encodeLiteralTag('reviewed')).toBe('reviewed')
    expect(encodeLiteralTag('deep learning')).toBe('deep learning')
  })
})

describe('encodeExcludeTag', () => {
  it('prefixes the NOT dash onto the escaped literal', () => {
    expect(encodeExcludeTag('foo')).toBe('-foo')
    // A literal "-foo" becomes NOT literal "-foo": the inner escape survives.
    expect(encodeExcludeTag('-foo')).toBe('-\\-foo')
    expect(encodeExcludeTag('--foo')).toBe('-\\--foo')
  })
})

describe('search: library scope', () => {
  it('searches /items/top with server-side pagination and a Total-Results header', async () => {
    serveSearchPage(mock, { items: [searchHit()], total: 25 })
    const result = await provider.search(request({ query: 'flash', offset: 10, limit: 5 }))
    const sent = mock.requests[0]!
    expect(sent.pathname).toBe('/api/users/0/items/top')
    expect(sent.search.get('start')).toBe('10')
    expect(sent.search.get('limit')).toBe('5')
    expect(sent.search.get('q')).toBe('flash')
    expect(result).toMatchObject({
      scope: { kind: 'library' },
      total: 25,
      offset: 10,
      returned: 1,
      nextOffset: 11,
    })
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })

  it('searches My Publications through the publications scope', async () => {
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 3,
      path: '/api/users/0/publications/items/top',
    })
    const result = await provider.search(request({ scope: { kind: 'publications' } }))
    expect(result.scope).toEqual({ kind: 'publications', library: { type: 'user', id: 0 } })
    expect(mock.requests[0]!.pathname).toBe('/api/users/0/publications/items/top')
    expect(result.total).toBe(3)
    expect(result.items).toHaveLength(1)
  })

  it('omits nextOffset when the page reaches the reported total', async () => {
    serveSearchPage(mock, { items: [searchHit()], total: 1, serverId: null })
    const result = await provider.search(request({ offset: 0, limit: 10 }))
    expect(result.total).toBe(1)
    expect(result.nextOffset).toBeUndefined()
  })

  it('fails loud when Total-Results is missing or not a number', async () => {
    // Pagination honesty is uniform: without an honest total the call
    // fails instead of guessing one from the body length.
    serveJson(mock, /^\/api\/users\/0\/items(\/top)?$/, [searchHit()])
    await zoteroError(
      provider.search(request({})),
      'ZOTERO_UNEXPECTED',
      'Total-Results header for items top listing',
    )
    serveJson(mock, /^\/api\/users\/0\/items(\/top)?$/, [searchHit()], {
      'Total-Results': 'garbage',
    })
    await zoteroError(provider.search(request({})), 'ZOTERO_UNEXPECTED', 'Total-Results')
  })

  it('rejects an unsafe integer Total-Results value', async () => {
    serveJson(mock, /^\/api\/users\/0\/items(\/top)?$/, [searchHit()], {
      'Total-Results': '9007199254740992',
    })
    await zoteroError(provider.search(request({})), 'ZOTERO_UNEXPECTED', 'Total-Results')
  })

  it('keeps the scope provenance when the items response omits the server id', async () => {
    serveJson(mock, '/api/users/0/collections/COLL1234', COLLECTIONS[0], {
      'Zotero-Server-ID': SERVER_ID,
    })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      serverId: null,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })
})

describe('search: collection scope', () => {
  it('resolves a collection name and searches its top-level items', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Zotero-Server-ID': SERVER_ID })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    const result = await provider.search(
      request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
    expectRequestPaths(mock, [
      '/api/users/0/collections',
      '/api/users/0/collections/COLL1234/items/top',
    ])
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'LLM Papers',
    })
  })

  it('reuses a collection ref without re-listing all collections', async () => {
    serveJson(mock, '/api/users/0/collections/COLL1234', COLLECTIONS[0], {
      'Zotero-Server-ID': SERVER_ID,
    })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      serverId: null,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
    expectRequestPaths(mock, [
      '/api/users/0/collections/COLL1234',
      '/api/users/0/collections/COLL1234/items/top',
    ])
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'LLM Papers',
    })
  })

  it('fails with SCOPE_AMBIGUOUS listing candidate refs for multiple matches', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Total-Results': '3' })
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'llm papers' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'COLL1234',
    )
    expect(error.message).toContain('COLL5678')
  })

  it('fails with NOT_FOUND and near candidates when nothing matches', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Total-Results': '3' })
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'reason' } })),
      ZOTERO_NOT_FOUND,
      'Reasoning',
    )
    expect(error.message).toContain('"reason"')
  })

  it('fails with NOT_FOUND without candidates when nothing is even close', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Total-Results': '3' })
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'quantization' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('reports ambiguous saved searches with the saved-search wording', async () => {
    serveJson(mock, '/api/users/0/searches', [
      savedSearchRow({ key: 'SRCH1111', data: { name: 'unread' } }),
      savedSearchRow({ key: 'SRCH2222', data: { name: 'UNREAD' } }),
    ])
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'savedSearch', refOrName: 'Unread' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'saved search',
    )
    expect(error.message).toContain('SRCH1111')
    expect(error.message).toContain('SRCH2222')
  })

  it('resolves a collection name without server provenance on pre-10 listings', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Total-Results': '3' })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      serverId: null,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    const result = await provider.search(
      request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234',
      name: 'LLM Papers',
    })
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234')
  })

  it('reuses the cached scope listing across searches by name', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Total-Results': '3' })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      serverId: null,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(1)
  })

  it('does not share the scope listing cache across provider instances', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Total-Results': '3' })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      serverId: null,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    await makeProvider(mock).search(
      request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('treats a non-array items response as an empty result set', async () => {
    serveJson(mock, '/api/users/0/items/top', { key: ITEM_KEY }, { 'Total-Results': '0' })
    const result = await provider.search(request({}))
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.nextOffset).toBeUndefined()
  })

  it('treats a non-array scope listing as no matches', async () => {
    serveJson(mock, '/api/users/0/collections', { key: COLLECTION_KEY })
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('keeps the input ref provenance when the single-object response has no server id', async () => {
    serveJson(mock, '/api/users/0/collections/COLL1234', COLLECTIONS[0])
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      serverId: null,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'LLM Papers',
    })
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })
})

describe('search: saved search scope', () => {
  it('resolves a saved search by name and executes it with the additional filters', async () => {
    serveJson(mock, '/api/users/0/searches', SEARCHES, { 'Zotero-Server-ID': SERVER_ID })
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      path: '/api/users/0/searches/SRCH1234/items',
    })
    const result = await provider.search(
      request({
        scope: { kind: 'savedSearch', refOrName: 'Unread Papers' },
        mode: 'everything',
        query: 'attention',
      }),
    )
    expect(mock.requests[1]!.pathname).toBe('/api/users/0/searches/SRCH1234/items')
    expect(mock.requests[1]!.search.get('qmode')).toBe('everything')
    expect(mock.requests[1]!.search.get('q')).toBe('attention')
    expect(result.scope).toEqual({
      kind: 'savedSearch',
      ref: 'zotero://user/0/search/SRCH1234?server=S1',
      name: 'Unread Papers',
    })
  })
})

describe('search failures', () => {
  it('maps a missing collection to NOT_FOUND', async () => {
    serveStatus(mock, '/api/users/0/collections/COLL1234', 404, 'Not found')
    await zoteroError(
      provider.search(
        request({
          scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' },
        }),
      ),
      ZOTERO_NOT_FOUND,
    )
  })

  it('rejects non-zero user refs before any request happens', async () => {
    await zoteroError(
      provider.search(
        request({
          scope: { kind: 'collection', refOrName: 'zotero://user/123/collection/COLL1234' },
        }),
      ),
      'ZOTERO_INVALID_REF',
      'user/0',
    )
    expectRequestCount(mock, 0)
  })

  it('rejects mismatched library and ref libraries', async () => {
    await zoteroError(
      provider.search(
        request({
          library: { type: 'group', id: 42 },
          scope: { kind: 'collection', refOrName: 'zotero://group/51/collection/COLL1234' },
        }),
      ),
      'ZOTERO_INVALID_ARGUMENT',
      'Library mismatch',
    )
    expectRequestCount(mock, 0)
  })

  it('infers the group library from the scope ref when library is omitted', async () => {
    serveJson(
      mock,
      '/api/groups/42/collections/COLL1234',
      collectionRow({ data: { name: 'GCol' } }),
      {
        'Zotero-Server-ID': SERVER_ID,
      },
    )
    serveSearchPage(mock, {
      items: [],
      total: 0,
      serverId: null,
      path: '/api/groups/42/collections/COLL1234/items/top',
    })
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://group/42/collection/COLL1234' },
      }),
    )
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://group/42/collection/COLL1234?server=S1',
      name: 'GCol',
    })
  })
})
