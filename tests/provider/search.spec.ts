/**
 * The `zotero_search` provider contract: query serialization, scope
 * resolution (library / collection / saved search), and the client-side
 * note-content scan merged into the first page.
 * @module tests/provider/search
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_NOT_FOUND, ZOTERO_SCOPE_AMBIGUOUS } from '../../src/errors.js'
import {
  buildSearchParams,
  encodeExcludeTag,
  encodeLiteralTag,
  type LocalApiLimits,
  type LocalApiProvider,
} from '../../src/provider-local.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { ITEM } from '../helpers/fixtures.js'
import {
  createProvider,
  request,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'

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

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
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
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '25', 'Zotero-Server-ID': 'S1' }),
    )
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
    mock.route('GET', '/api/users/0/publications/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '3', 'Zotero-Server-ID': 'S1' }),
    )
    const result = await provider.search(request({ scope: { kind: 'publications' } }))
    expect(result.scope).toEqual({ kind: 'publications', library: { type: 'user', id: 0 } })
    expect(mock.requests[0]!.pathname).toBe('/api/users/0/publications/items/top')
    expect(result.total).toBe(3)
    expect(result.items).toHaveLength(1)
  })

  it('omits nextOffset when the page reaches the reported total', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
    const result = await provider.search(request({ offset: 0, limit: 10 }))
    expect(result.total).toBe(1)
    expect(result.nextOffset).toBeUndefined()
  })

  it('fails loud when Total-Results is missing or not a number', async () => {
    // Pagination honesty is uniform: without an honest total the call
    // fails instead of guessing one from the body length.
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([ITEM]),
    )
    await zoteroError(
      provider.search(request({})),
      'ZOTERO_UNEXPECTED',
      'Total-Results header for items top listing',
    )
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': 'garbage' }),
    )
    await zoteroError(provider.search(request({})), 'ZOTERO_UNEXPECTED', 'Total-Results')
  })

  it('keeps the scope provenance when the items response omits the server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
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
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const result = await provider.search(
      request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
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
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Total-Results': '3' }),
    )
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'llm papers' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'COLL1234',
    )
    expect(error.message).toContain('COLL5678')
  })

  it('fails with NOT_FOUND and near candidates when nothing matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Total-Results': '3' }),
    )
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'reason' } })),
      ZOTERO_NOT_FOUND,
      'Reasoning',
    )
    expect(error.message).toContain('"reason"')
  })

  it('fails with NOT_FOUND without candidates when nothing is even close', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Total-Results': '3' }),
    )
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'quantization' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('reports ambiguous saved searches with the saved-search wording', async () => {
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) =>
      helpers.json([
        { key: 'SRCH1111', version: 1, data: { key: 'SRCH1111', version: 1, name: 'unread' } },
        { key: 'SRCH2222', version: 1, data: { key: 'SRCH2222', version: 1, name: 'UNREAD' } },
      ]),
    )
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'savedSearch', refOrName: 'Unread' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'saved search',
    )
    expect(error.message).toContain('SRCH1111')
    expect(error.message).toContain('SRCH2222')
  })

  it('resolves a collection name without server provenance on pre-10 listings', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Total-Results': '3' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
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
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Total-Results': '3' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
    await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(1)
  })

  it('does not share the scope listing cache across provider instances', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Total-Results': '3' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
    await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    await makeProvider().search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('treats a non-array items response as an empty result set', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json({ key: 'ABCD1234' }, { 'Total-Results': '0' }),
    )
    const result = await provider.search(request({}))
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.nextOffset).toBeUndefined()
  })

  it('treats a non-array scope listing as no matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json({ key: 'COLL1234' }),
    )
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('keeps the input ref provenance when the single-object response has no server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(COLLECTIONS[0]),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
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
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) =>
      helpers.json(SEARCHES, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/searches/SRCH1234/items', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
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
    expect(mock.requests).toEqual([])
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
    expect(mock.requests).toEqual([])
  })

  it('infers the group library from the scope ref when library is omitted', async () => {
    mock.route('GET', '/api/groups/42/collections/COLL1234', (req, res, helpers) =>
      helpers.json(
        { key: 'COLL1234', data: { key: 'COLL1234', name: 'GCol' } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/groups/42/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
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

describe('search: note-content scan', () => {
  const NOTE_HIT = {
    key: 'NOTE1111',
    data: { itemType: 'note', note: 'cascade failure chains in infrastructure' },
  }
  const NOTE_OTHER = {
    key: 'NOTE2222',
    data: { itemType: 'note', note: 'something unrelated entirely' },
  }

  it('lists body-matched notes as a first-page supplement beside the paged results', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT, NOTE_OTHER])
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(request({ query: 'cascade infrastructure' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    // The paged fields describe the primary hits only; the note match rides
    // in `supplemental` so pagination semantics stay exact.
    expect(result.total).toBe(1)
    expect(result.returned).toBe(1)
    expect(result.supplemental).toEqual({
      kind: 'noteBody',
      items: [expect.objectContaining({ ref: 'zotero://user/0/item/NOTE1111?server=S1' })],
      scanned: 2,
      truncated: false,
    })
    expect(result.nextOffset).toBeUndefined()
    expect(mock.requests[1]!.search.get('itemType')).toBe('note')
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
    expect(mock.requests[1]!.search.get('sort')).toBe('dateModified')
    expect(mock.requests[1]!.search.get('direction')).toBe('desc')
  })

  it('keeps the publications scan inside My Publications', async () => {
    mock.route('GET', '/api/users/0/publications/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/publications/items', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT])
      else helpers.json([])
    })
    const result = await provider.search(
      request({ query: 'cascade infrastructure', scope: { kind: 'publications' } }),
    )
    // The scan must hit the publications segment; the bare library prefix
    // would leak note matches from outside My Publications.
    expect(mock.requests[1]!.pathname).toBe('/api/users/0/publications/items')
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
  })

  it('synthesizes a title for the merged note and dedupes API-page overlap', async () => {
    const titled = {
      key: 'NOTE3333',
      data: { itemType: 'note', note: '数据计算 notes about cascade risk' },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([titled])
      else helpers.json([titled], { 'Total-Results': '1' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.title).toBe('数据计算 notes about cascade risk')
    expect(result.total).toBe(1)
    expect(result.supplemental).toBeUndefined()
  })

  it('skips the scan for later pages, saved searches, empty queries, and non-note type filters', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json(SEARCHES))
    mock.route('GET', '/api/users/0/searches/SRCH1234/items', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    await provider.search(request({ query: 'cascade', offset: 10 }))
    await provider.search(request({ query: 'cascade', itemTypes: ['journalArticle'] }))
    await provider.search(request({ query: '' }))
    await provider.search(
      request({ query: 'cascade', scope: { kind: 'savedSearch', refOrName: 'Unread Papers' } }),
    )
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toEqual([])
  })

  it('filters scanned notes by the resolved collection and literal tags', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    const inCollection = {
      key: 'NOTE1111',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        collections: ['COLL1234'],
        tags: [{ tag: 'reviewed' }],
      },
    }
    const otherCollection = {
      key: 'NOTE2222',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        collections: ['OTHER123'],
        tags: [{ tag: 'reviewed' }],
      },
    }
    const missingTag = {
      key: 'NOTE3333',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        collections: ['COLL1234'],
        tags: [],
      },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([inCollection, otherCollection, missingTag])
      else helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: 'LLM Papers' },
        tags: ['reviewed'],
      }),
    )
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
    expect(result.total).toBe(0)
    expect(result.returned).toBe(0)
  })

  it('resolves child-note collection membership through the parent item', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    // Zotero child notes carry no `collections` of their own — membership
    // belongs to the parent bibliographic item.
    const childIn = {
      key: 'NOTE1111',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        parentItem: 'PARE1111',
        collections: [],
      },
    }
    const childOtherCollection = {
      key: 'NOTE2222',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        parentItem: 'PARE2222',
        collections: [],
      },
    }
    const childParentMissing = {
      key: 'NOTE3333',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        parentItem: 'PARE3333',
        collections: [],
      },
    }
    const standaloneIn = {
      key: 'NOTE4444',
      data: { itemType: 'note', note: 'cascade risk note', collections: ['COLL1234'] },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([childIn, childOtherCollection, childParentMissing, standaloneIn])
      else if (search.get('itemKey') !== null) {
        // PARE3333 stays absent: an unfetchable parent (e.g. trashed) fails closed.
        helpers.json([
          { key: 'PARE1111', data: { collections: ['COLL1234'] } },
          { key: 'PARE2222', data: { collections: ['OTHER123'] } },
        ])
      } else helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
      'zotero://user/0/item/NOTE4444?server=S1',
    ])
    const parentFetch = mock.requests.find((entry) => entry.search.get('itemKey') !== null)
    expect(parentFetch?.search.get('itemKey')).toBe('PARE1111,PARE2222,PARE3333')
  })

  it('splits parent-membership lookups into itemKey batches of at most 50', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    // 60 matched child notes over 59 distinct parents — one parent shared by
    // two notes proves deduplication before batching.
    const notes = Array.from({ length: 60 }, (_, i) => ({
      key: `NOTE${String(i).padStart(4, '0')}`,
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        parentItem: `PARE${String(i % 59).padStart(4, '0')}`,
        collections: [],
      },
    }))
    const parentFetches: string[][] = []
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        helpers.json(notes)
        return
      }
      const itemKey = search.get('itemKey')
      if (itemKey !== null) {
        const keys = itemKey.split(',')
        parentFetches.push(keys)
        helpers.json(
          keys.map((key) => ({ key, data: { collections: ['COLL1234'] } })),
          { 'Zotero-Server-ID': 'S1' },
        )
        return
      }
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: 'LLM Papers' },
        limit: 60,
      }),
    )
    expect(result.supplemental?.items).toHaveLength(60)
    expect(parentFetches.map((keys) => keys.length).sort((a, b) => a - b)).toEqual([9, 50])
    const requested = parentFetches.flat()
    expect(new Set(requested).size).toBe(59)
    expect(requested).toContain('PARE0000')
    expect(requested).toContain('PARE0058')
  })

  it('stops the scan at the configured record cap', async () => {
    const capped = makeProvider({ maxNoteScanRecords: 2 })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          { key: 'NOTE1111', data: { itemType: 'note', note: 'cascade one' } },
          { key: 'NOTE2222', data: { itemType: 'note', note: 'cascade two' } },
          { key: 'NOTE3333', data: { itemType: 'note', note: 'cascade three' } },
        ])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
      'zotero://user/0/item/NOTE2222',
    ])
    expect(result.supplemental?.scanned).toBe(2)
    expect(result.supplemental?.truncated).toBe(true)
    expect(mock.requests[1]!.search.get('limit')).toBe('2')
  })

  it('treats an empty scan response as no note matches', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json({})
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(result.total).toBe(1)
  })

  it('skips non-note scan rows, tagless notes, and partial term matches', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          {
            key: 'ATTACH1X',
            data: {
              itemType: 'attachment',
              note: 'cascade infrastructure note',
              tags: [{ tag: 'reviewed' }],
            },
          },
          { key: 'NOTE4444', data: { itemType: 'note', note: 'cascade without the second term' } },
        ])
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({ query: 'cascade infrastructure', tags: ['reviewed'] }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
  })

  it('pages the scan in batches up to the cap', async () => {
    const capped = makeProvider({ maxNoteScanRecords: 150 })
    const batch = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        key: `NOTE${String(i).padStart(4, '0')}`,
        data: { itemType: 'note', note: 'unrelated note body' },
      }))
    let scanPage = 0
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        scanPage += 1
        helpers.json(scanPage === 1 ? batch(100) : batch(30))
      } else {
        helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
      }
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
    expect(mock.requests[2]!.search.get('start')).toBe('100')
    expect(mock.requests[2]!.search.get('limit')).toBe('50')
    expect(mock.requests).toHaveLength(3)
  })

  it('requires every query term in the note body without filter interference', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          { key: 'NOTE1111', data: { itemType: 'note', note: 'cascade without the second term' } },
        ])
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    // No tags or collection scope here: the only thing that can exclude the
    // note is the AND term matching itself.
    const result = await provider.search(request({ query: 'cascade infrastructure' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
  })

  it('matches note bodies case-insensitively', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          { key: 'NOTE1111', data: { itemType: 'note', note: 'Cascade Risk Assessment' } },
        ])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
    ])
  })

  it('scans note bodies when note is among the requested item types', async () => {
    const note = { key: 'NOTE1111', data: { itemType: 'note', note: 'cascade note body' } }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([note])
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({ query: 'cascade', itemTypes: ['journalArticle', 'note'] }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
  })

  it('skips the scan for punctuation-only and emoji-only queries', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const punctuated = await provider.search(request({ query: '---' }))
    const emoted = await provider.search(request({ query: '👾👾' }))
    expect(punctuated.items).toEqual([])
    expect(punctuated.supplemental).toBeUndefined()
    expect(emoted.items).toEqual([])
    expect(emoted.supplemental).toBeUndefined()
    // A query with no tokens would vacuously "match" every scanned note; the
    // scan stays off instead of flooding the page with irrelevant notes.
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toEqual([])
  })

  it('does not merge notes when the API page already fills the limit', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT])
      else helpers.json([ITEM, ITEM, ITEM], { 'Total-Results': '3' })
    })
    const result = await provider.search(request({ query: 'cascade', limit: 3 }))
    expect(result.items).toHaveLength(3)
    expect(result.supplemental).toBeUndefined()
    expect(result.returned).toBe(3)
    expect(result.total).toBe(3)
    // headroom == 0: a full primary page never runs the note scan at all
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toHaveLength(0)
  })

  it('caps note matches at the remaining limit headroom beside a partial primary page', async () => {
    const NOTE_HIT_2 = {
      key: 'NOTE2222',
      data: { itemType: 'note', note: 'cascade chains in infrastructure too' },
    }
    const NOTE_HIT_3 = {
      key: 'NOTE3333',
      data: { itemType: 'note', note: 'cascade infrastructure again' },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT, NOTE_HIT_2, NOTE_HIT_3])
      else helpers.json([ITEM], { 'Total-Results': '1' })
    })
    const result = await provider.search(request({ query: 'cascade', limit: 3 }))
    expect(result.items.map((entry) => entry.ref)).toEqual(['zotero://user/0/item/ABCD1234'])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
      'zotero://user/0/item/NOTE2222',
    ])
    expect(result.returned).toBe(1)
    expect(result.total).toBe(1)
  })

  it('re-fetches a scope listing once the TTL expires', async () => {
    const ttlProvider = createProvider(mock, {}, { scopeListingTtlMs: 30 })
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) =>
      search.get('itemType') === 'note'
        ? helpers.json([])
        : helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    const searchByName = () =>
      ttlProvider.search(
        request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
      )
    await searchByName()
    const first = mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections')
    expect(first).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    await searchByName()
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('re-checks the scope listing once before failing an unknown collection name', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    await zoteroError(
      provider.search(
        request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'Missing' } }),
      ),
      'ZOTERO_NOT_FOUND',
      'No collection',
    )
    // A name miss gets one fresh look in case the library changed since the
    // cached listing; the failure is only reported after that.
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('finds a collection created after the cached listing via the miss re-check', async () => {
    let created = false
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(
        created ? [{ key: 'COLL1234', data: { key: 'COLL1234', name: 'Brand New' } }] : COLLECTIONS,
        {
          'Zotero-Server-ID': 'S1',
        },
      ),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) =>
      search.get('itemType') === 'note'
        ? helpers.json([])
        : helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    await zoteroError(
      provider.search(
        request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'Brand New' } }),
      ),
      'ZOTERO_NOT_FOUND',
      'No collection',
    )
    created = true
    const result = await provider.search(
      request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'Brand New' } }),
    )
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'Brand New',
    })
  })
})
