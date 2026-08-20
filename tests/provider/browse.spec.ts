import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  createProvider,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { LocalApiProvider } from '../../src/provider-local.js'

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

function makeProvider(
  limits: Partial<import('../../src/provider-local.js').LocalApiLimits> = {},
): LocalApiProvider {
  return createProvider(mock, limits)
}

describe('browse: validation', () => {
  it('rejects bad offset/limit and unsupported kind', async () => {
    await zoteroError(
      provider.browse({ kind: 'collections', offset: -1, limit: 5 } as never),
      'ZOTERO_INVALID_ARGUMENT',
    )
    await zoteroError(
      provider.browse({ kind: 'collections', offset: 0, limit: 0 } as never),
      'ZOTERO_INVALID_ARGUMENT',
    )
    await zoteroError(
      provider.browse({ kind: 'collections', offset: 0, limit: 1000 } as never),
      'ZOTERO_INVALID_ARGUMENT',
    )
    await zoteroError(
      provider.browse({ kind: 'unsupported' as never, offset: 0, limit: 5 }),
      'ZOTERO_INVALID_ARGUMENT',
    )
  })
})

describe('browse: libraries', () => {
  it('returns personal + groups when available', async () => {
    mock.route('GET', '/api/users/0/groups', (req, res, helpers) =>
      helpers.json(
        [
          { id: 1, name: 'Group One' },
          { id: 2, name: 'Group Two', data: { name: 'Group Two' } },
        ],
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    const result = await provider.browse({ kind: 'libraries', offset: 0, limit: 10 })
    expect(result.kind).toBe('libraries')
    expect(result.total).toBe(3)
    expect(result.items.length).toBe(3)
    expect(result.serverId).toBe('S1')
  })
  it('falls back to personal when groups 404', async () => {
    mock.route('GET', '/api/users/0/groups', (req, res, helpers) =>
      helpers.raw(404, {}, 'not found'),
    )
    const result = await provider.browse({ kind: 'libraries', offset: 0, limit: 10 })
    expect(result.total).toBe(1)
  })
  it('paginates libraries', async () => {
    mock.route('GET', '/api/users/0/groups', (req, res, helpers) =>
      helpers.json([
        { id: 1, name: 'G1' },
        { id: 2, name: 'G2' },
        { id: 3, name: 'G3' },
      ]),
    )
    const r1 = await provider.browse({ kind: 'libraries', offset: 0, limit: 2 })
    expect(r1.returned).toBe(2)
    expect(r1.nextOffset).toBe(2)
    const r2 = await provider.browse({ kind: 'libraries', offset: 2, limit: 2 })
    expect(r2.returned).toBe(2)
  })
})

describe('browse: collections', () => {
  it('builds tree from single listing and handles parent', async () => {
    const cols = [
      { key: 'COLL0001', data: { key: 'COLL0001', name: 'Root', parentCollection: false } },
      { key: 'COLL0002', data: { key: 'COLL0002', name: 'Child', parentCollection: 'COLL0001' } },
      {
        key: 'COLL0003',
        data: { key: 'COLL0003', name: 'Grandchild', parentCollection: 'COLL0002' },
      },
    ]
    // first freshScopeListing and second raw both hit same endpoint; we route both
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(cols, { 'Zotero-Server-ID': 'S1' }),
    )
    const result = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    expect(result.total).toBe(3)
    const child = (
      result.items as unknown as Array<{
        ref: string
        parentRef?: string
        path: string[]
        depth: number
      }>
    ).find((i) => i.path.includes('Child'))!
    expect(child.parentRef).toBeTruthy()
    expect(child.depth).toBeGreaterThan(0)
  })
  it('handles missing parent and cycle tolerance', async () => {
    const cols = [
      { key: 'COLL0001', data: { key: 'COLL0001', name: 'A', parentCollection: 'MISSING1' } },
      { key: 'COLL0002', data: { key: 'COLL0002', name: 'B', parentCollection: 'COLL0002' } }, // self cycle
    ]
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(cols))
    const result = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    expect(result.total).toBe(2)
  })
  it('paginates collections', async () => {
    const cols = Array.from({ length: 5 }, (_, i) => ({
      key: `COLL${String(i).padStart(4, '0')}`,
      data: { key: `COLL${String(i).padStart(4, '0')}`, name: `C${i}` },
    }))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(cols))
    const r = await provider.browse({ kind: 'collections', offset: 1, limit: 2 })
    expect(r.returned).toBe(2)
    expect(r.nextOffset).toBe(3)
  })
  it('serves repeat browses from the TTL snapshot without a second full fetch', async () => {
    const cols = [
      { key: 'COLL0001', data: { key: 'COLL0001', name: 'Root' } },
      { key: 'COLL0002', data: { key: 'COLL0002', name: 'Child', parentCollection: 'COLL0001' } },
    ]
    let fetches = 0
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => {
      fetches += 1
      helpers.json(cols, { 'Zotero-Server-ID': 'S1' })
    })
    const first = await provider.browse({ kind: 'collections', offset: 0, limit: 1 })
    const second = await provider.browse({ kind: 'collections', offset: 1, limit: 1 })
    expect(fetches).toBe(1)
    expect(first.total).toBe(2)
    expect(second.items).toHaveLength(1)
    // The snapshot still yields full breadcrumbs on the cached pass.
    expect((second.items as unknown as Array<{ path: string[] }>).map((item) => item.path)).toEqual(
      [['Root', 'Child']],
    )
  })
  it('supports group library', async () => {
    const cols = [{ key: 'COLL0001', data: { key: 'COLL0001', name: 'G Root' } }]
    mock.route('GET', '/api/groups/42/collections', (req, res, helpers) =>
      helpers.json(cols, { 'Zotero-Server-ID': 'S2' }),
    )
    const result = await provider.browse({
      kind: 'collections',
      library: { type: 'group', id: 42 },
      offset: 0,
      limit: 10,
    })
    expect(result.library).toEqual({ type: 'group', id: 42 })
  })
})

describe('browse: savedSearches', () => {
  const searches = [
    {
      key: 'SRCH0001',
      data: { key: 'SRCH0001', name: 'Unread', conditions: [{ condition: 'unread' }] },
    },
    { key: 'SRCH0002', data: { key: 'SRCH0002', name: 'Recent' } },
    { key: 'SRCH0003', data: { key: 'SRCH0003', name: 'Pinned' } },
  ]
  function routeSearches() {
    mock.route('GET', '/api/users/0/searches', (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      helpers.json(searches.slice(start, start + limit), {
        'Total-Results': String(searches.length),
        'Zotero-Server-ID': 'S1',
      })
    })
  }
  it('returns saved searches with conditions from a server-paged window', async () => {
    routeSearches()
    const result = await provider.browse({ kind: 'savedSearches', offset: 0, limit: 2 })
    expect(result.total).toBe(3)
    expect(result.items).toHaveLength(2)
    expect(mock.requests[0]!.search.get('start')).toBe('0')
    expect(mock.requests[0]!.search.get('limit')).toBe('2')
    const unread = (result.items as unknown as Array<{ name: string; conditions?: unknown }>).find(
      (i) => i.name === 'Unread',
    )
    expect(unread?.conditions).toBeTruthy()
  })
  it('paginates saved searches with nextOffset against the header total', async () => {
    routeSearches()
    const r1 = await provider.browse({ kind: 'savedSearches', offset: 0, limit: 2 })
    expect(r1.returned).toBe(2)
    expect(r1.nextOffset).toBe(2)
    const r2 = await provider.browse({ kind: 'savedSearches', offset: 2, limit: 2 })
    expect(r2.returned).toBe(1)
    expect(r2.nextOffset).toBeUndefined()
    expect(mock.requests[1]!.search.get('start')).toBe('2')
  })
  it('fails closed when Total-Results header is missing', async () => {
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json(searches))
    await expect(provider.browse({ kind: 'savedSearches', offset: 0, limit: 10 })).rejects.toThrow(
      'Total-Results',
    )
  })
})

describe('browse: tags', () => {
  it('lists tags and filters by q', async () => {
    const allTags = [
      { tag: 'alpha', meta: { numItems: 5 } },
      { tag: 'beta' },
      { tag: 'alphabeta', numItems: 2 },
    ]
    mock.route('GET', '/api/users/0/tags', (req, res, helpers, search) => {
      const q = search.get('q') ?? ''
      const qmode = search.get('qmode') ?? 'contains'
      let filtered = allTags
      if (q !== '') {
        const lower = q.toLowerCase()
        filtered = allTags.filter((t) =>
          qmode === 'startsWith'
            ? t.tag.toLowerCase().startsWith(lower)
            : t.tag.toLowerCase().includes(lower),
        )
      }
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      const slice = filtered.slice(start, start + limit)
      helpers.json(slice, { 'Total-Results': String(filtered.length) })
    })
    const all = await provider.browse({ kind: 'tags', offset: 0, limit: 10 })
    expect(all.total).toBe(3)
    const filtered = await provider.browse({
      kind: 'tags',
      q: 'alpha',
      match: 'contains',
      offset: 0,
      limit: 10,
    })
    expect(filtered.total).toBe(2)
    const starts = await provider.browse({
      kind: 'tags',
      q: 'alp',
      match: 'startsWith',
      offset: 0,
      limit: 10,
    })
    expect(starts.total).toBe(2)
  })
  it('paginates tags', async () => {
    const tags = Array.from({ length: 5 }, (_, i) => ({ tag: `t${i}` }))
    mock.route('GET', '/api/users/0/tags', (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      const slice = tags.slice(start, start + limit)
      helpers.json(slice, { 'Total-Results': String(tags.length) })
    })
    const r = await provider.browse({ kind: 'tags', offset: 2, limit: 2 })
    expect(r.returned).toBe(2)
    expect(r.total).toBe(5)
    expect(r.nextOffset).toBe(4)
  })
  it('fails closed when Total-Results header is missing', async () => {
    mock.route('GET', '/api/users/0/tags', (req, res, helpers) => helpers.json([{ tag: 'a' }]))
    await expect(provider.browse({ kind: 'tags', offset: 0, limit: 10 })).rejects.toThrow(
      'Total-Results',
    )
  })
})

describe('browse: itemTypes', () => {
  it('lists item types', async () => {
    const types = [{ itemType: 'book', localized: 'Book' }, { itemType: 'journalArticle' }]
    mock.route('GET', '/api/itemTypes', (req, res, helpers) => helpers.json(types))
    const result = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 10 })
    expect(result.total).toBe(2)
  })
  it('paginates itemTypes', async () => {
    const types = Array.from({ length: 5 }, (_, i) => ({ itemType: `type${i}` }))
    mock.route('GET', '/api/itemTypes', (req, res, helpers) => helpers.json(types))
    const r = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 2 })
    expect(r.returned).toBe(2)
  })
})
