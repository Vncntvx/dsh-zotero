import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZoteroHttpClient } from '../src/client.js'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZoteroError,
} from '../src/errors.js'
import { buildSearchParams, encodeLiteralTag, LocalApiProvider } from '../src/provider-local.js'
import type { ZoteroSearchRequest } from '../src/types.js'
import { MockZotero } from './helpers/mock-zotero.js'

let mock: MockZotero
let provider: LocalApiProvider

beforeEach(async () => {
  mock = await MockZotero.start()
  provider = new LocalApiProvider(new ZoteroHttpClient({ baseUrl: mock.baseUrl, timeoutMs: 5000, maxResponseBytes: 1024 * 1024 }))
})

afterEach(async () => {
  await mock.close()
})

function request(overrides: Partial<ZoteroSearchRequest> = {}): ZoteroSearchRequest {
  return {
    scope: { kind: 'library' },
    mode: 'metadata',
    sort: 'dateModified',
    direction: 'desc',
    offset: 0,
    limit: 10,
    ...overrides,
  }
}

async function zoteroError(promise: Promise<unknown>, code: string, messagePart?: string): Promise<ZoteroError> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  const zotero = thrown as ZoteroError
  expect(zotero.code).toBe(code)
  if (messagePart !== undefined) expect(zotero.message).toContain(messagePart)
  return zotero
}

const ITEM = {
  key: 'ABCD1234',
  version: 3,
  library: { type: 'user', id: 999, name: 'user', links: {} },
  links: { self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' } },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 1 },
  data: {
    key: 'ABCD1234',
    version: 3,
    itemType: 'conferencePaper',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    tags: [],
    collections: [],
    relations: {},
  },
}

const COLLECTIONS = [
  { key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } },
  { key: 'COLL5678', version: 1, data: { key: 'COLL5678', version: 1, name: 'Llm Papers' } },
  { key: 'COLL9012', version: 1, data: { key: 'COLL9012', version: 1, name: 'Reasoning' } },
]

const SEARCHES = [
  { key: 'SRCH1234', version: 1, data: { key: 'SRCH1234', version: 1, name: 'Unread Papers' } },
]

describe('buildSearchParams', () => {
  it('omits q/qmode for a metadata query and serializes every explicit filter', () => {
    const params = buildSearchParams(request({
      query: 'flash attention',
      itemTypes: ['journalArticle', 'conferencePaper'],
      tags: ['reviewed', '-draft'],
      sort: 'dateAdded',
      direction: 'asc',
      offset: 20,
      limit: 5,
    }))
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
})

describe('encodeLiteralTag', () => {
  it('escapes a leading dash so literal tags never negate', () => {
    expect(encodeLiteralTag('-draft')).toBe('\\-draft')
    expect(encodeLiteralTag('reviewed')).toBe('reviewed')
    expect(encodeLiteralTag('deep learning')).toBe('deep learning')
  })
})

describe('search: library scope', () => {
  it('searches /items/top with server-side pagination and a Total-Results header', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '25', 'Zotero-Server-ID': 'S1' })
    ))
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

  it('omits nextOffset on the final page and falls back to body length for total', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({ offset: 20, limit: 10 }))
    expect(result.total).toBe(1)
    expect(result.nextOffset).toBeUndefined()
  })

  it('falls back to body length when Total-Results is not a number', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([ITEM], { 'Total-Results': 'garbage' }))
    const result = await provider.search(request({}))
    expect(result.total).toBe(1)
  })

  it('keeps the scope provenance when the items response omits the server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => (
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
    }))
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })
})

describe('search: collection scope', () => {
  it('resolves a collection name and searches its top-level items', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    ))
    const result = await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => (
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1' })
    ))
    const result = await provider.search(request({
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
    }))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
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
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'llm papers' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'COLL1234',
    )
    expect(error.message).toContain('COLL5678')
  })

  it('fails with NOT_FOUND and near candidates when nothing matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'reason' } })),
      ZOTERO_NOT_FOUND,
      'Reasoning',
    )
    expect(error.message).toContain('"reason"')
  })

  it('fails with NOT_FOUND without candidates when nothing is even close', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'quantization' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('reports ambiguous saved searches with the saved-search wording', async () => {
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json([
      { key: 'SRCH1111', version: 1, data: { key: 'SRCH1111', version: 1, name: 'unread' } },
      { key: 'SRCH2222', version: 1, data: { key: 'SRCH2222', version: 1, name: 'UNREAD' } },
    ]))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'savedSearch', refOrName: 'Unread' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'saved search',
    )
    expect(error.message).toContain('SRCH1111')
    expect(error.message).toContain('SRCH2222')
  })

  it('resolves a collection name without server provenance on pre-10 listings', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234',
      name: 'LLM Papers',
    })
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234')
  })

  it('treats a non-array items response as an empty result set', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json({ key: 'ABCD1234' }))
    const result = await provider.search(request({}))
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.nextOffset).toBeUndefined()
  })

  it('treats a non-array scope listing as no matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json({ key: 'COLL1234' }))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('keeps the input ref provenance when the single-object response has no server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => helpers.json(COLLECTIONS[0]))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
    }))
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
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json(SEARCHES, { 'Zotero-Server-ID': 'S1' }))
    mock.route('GET', '/api/users/0/searches/SRCH1234/items', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    ))
    const result = await provider.search(request({
      scope: { kind: 'savedSearch', refOrName: 'Unread Papers' },
      mode: 'everything',
      query: 'attention',
    }))
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'))
    await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' } })),
      ZOTERO_NOT_FOUND,
    )
  })

  it('rejects group refs before any request happens', async () => {
    await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'zotero://group/42/collection/COLL1234' } })),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })
})
