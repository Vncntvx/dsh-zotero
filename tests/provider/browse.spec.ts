import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'
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

  it('rejects tag facets and mispairings at the provider boundary', async () => {
    await zoteroError(
      provider.browse({ kind: 'collections', q: 'x', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      'q/match are only valid when kind="tags"',
    )
    await zoteroError(
      provider.browse({
        kind: 'tags',
        scope: { kind: 'collection', refOrName: '' },
        offset: 0,
        limit: 5,
      }),
      ZOTERO_INVALID_ARGUMENT,
      'non-empty string',
    )
  })

  it('rejects the library parameter for the global kinds', async () => {
    await zoteroError(
      provider.browse({
        kind: 'libraries',
        offset: 0,
        limit: 5,
        library: { type: 'group', id: 1 },
      }),
      ZOTERO_INVALID_ARGUMENT,
      'library is not allowed',
    )
    await zoteroError(
      provider.browse({
        kind: 'itemTypes',
        offset: 0,
        limit: 5,
        library: { type: 'user', id: 0 },
      }),
      ZOTERO_INVALID_ARGUMENT,
      'library is not allowed',
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
  it('propagates a groups listing failure instead of degrading silently', async () => {
    mock.route('GET', '/api/users/0/groups', (req, res, helpers) => helpers.raw(500, {}, 'err'))
    await expect(provider.browse({ kind: 'libraries', offset: 0, limit: 5 })).rejects.toThrow()
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
  it('lists top-level collections server-side paged', async () => {
    const tops = [
      { key: 'COLL0001', data: { key: 'COLL0001', name: 'Root B' } },
      { key: 'COLL0002', data: { key: 'COLL0002', name: 'Root A' } },
    ]
    mock.route('GET', '/api/users/0/collections/top', (req, res, helpers, search) => {
      expect(search.get('start')).toBe('0')
      expect(search.get('limit')).toBe('10')
      helpers.json(tops, { 'Total-Results': '2', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    expect(result.total).toBe(2)
    expect(result.serverId).toBe('S1')
    // Page-local name sort keeps output deterministic.
    expect(result.items.map((item) => (item as { name: string }).name)).toEqual([
      'Root A',
      'Root B',
    ])
    // Top-level rows keep single-segment paths.
    expect((result.items[0] as unknown as { path: string[] }).path).toEqual(['Root A'])
  })

  it('paginates against the header total with nextOffset', async () => {
    const tops = Array.from({ length: 5 }, (_, i) => ({
      key: `COLL${String(i).padStart(4, '0')}`,
      data: { key: `COLL${String(i).padStart(4, '0')}`, name: `C${i}` },
    }))
    mock.route('GET', '/api/users/0/collections/top', (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      helpers.json(tops.slice(start, start + limit), { 'Total-Results': String(tops.length) })
    })
    const r = await provider.browse({ kind: 'collections', offset: 1, limit: 2 })
    expect(r.returned).toBe(2)
    expect(r.nextOffset).toBe(3)
  })

  it('navigates children via parentRef and builds breadcrumbs through ancestor GETs', async () => {
    mock.route(
      'GET',
      '/api/users/0/collections/COLL0001/collections',
      (req, res, helpers, search) => {
        expect(search.get('start')).toBe('0')
        helpers.json(
          [
            {
              key: 'COLL0002',
              data: { key: 'COLL0002', name: 'Child A', parentCollection: 'COLL0001' },
            },
            {
              key: 'COLL0003',
              data: { key: 'COLL0003', name: 'Child B', parentCollection: 'COLL0001' },
            },
          ],
          { 'Total-Results': '2', 'Zotero-Server-ID': 'S1' },
        )
      },
    )
    mock.route('GET', '/api/users/0/collections/COLL0001', (req, res, helpers) =>
      helpers.json(
        { key: 'COLL0001', data: { key: 'COLL0001', name: 'Root' } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    const result = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0001',
      offset: 0,
      limit: 10,
    })
    const rows = result.items as unknown as Array<{
      name: string
      path: string[]
      depth: number
      parentRef?: string
    }>
    expect(rows.map((row) => row.path)).toEqual([
      ['Root', 'Child A'],
      ['Root', 'Child B'],
    ])
    expect(rows.every((row) => row.depth === 1)).toBe(true)
    expect(
      rows.every((row) => row.parentRef === 'zotero://user/0/collection/COLL0001?server=S1'),
    ).toBe(true)
    // Both siblings share the parent: one cached ancestor GET serves both.
    expect(
      mock.requests.filter((r) => r.pathname === '/api/users/0/collections/COLL0001'),
    ).toHaveLength(1)
  })

  it('walks multi-level ancestors for deep breadcrumbs', async () => {
    mock.route('GET', '/api/users/0/collections/COLL0003/collections', (req, res, helpers) =>
      helpers.json(
        [
          {
            key: 'COLL0004',
            data: { key: 'COLL0004', name: 'Leaf', parentCollection: 'COLL0002' },
          },
        ],
        { 'Total-Results': '1' },
      ),
    )
    mock.route('GET', '/api/users/0/collections/COLL0002', (req, res, helpers) =>
      helpers.json({
        key: 'COLL0002',
        data: { key: 'COLL0002', name: 'Mid', parentCollection: 'COLL0001' },
      }),
    )
    mock.route('GET', '/api/users/0/collections/COLL0001', (req, res, helpers) =>
      helpers.json({ key: 'COLL0001', data: { key: 'COLL0001', name: 'Root' } }),
    )
    const result = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0003',
      offset: 0,
      limit: 10,
    })
    expect((result.items[0] as unknown as { path: string[] }).path).toEqual(['Root', 'Mid', 'Leaf'])
  })

  it('truncates breadcrumbs at a missing ancestor and guards self cycles', async () => {
    mock.route('GET', '/api/users/0/collections/COLL0009/collections', (req, res, helpers) =>
      helpers.json(
        [
          {
            key: 'COLL0010',
            data: { key: 'COLL0010', name: 'Orphan', parentCollection: 'MISSING1' },
          },
          {
            key: 'COLL0011',
            data: { key: 'COLL0011', name: 'Selfy', parentCollection: 'COLL0011' },
          },
        ],
        { 'Total-Results': '2' },
      ),
    )
    const result = await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0009',
      offset: 0,
      limit: 10,
    })
    const rows = result.items as unknown as Array<{ name: string; path: string[]; depth: number }>
    // MISSING1 404s: the phantom parent never enters the path (fail-closed).
    expect(rows.find((row) => row.name === 'Orphan')!.path).toEqual(['Orphan'])
    expect(rows.find((row) => row.name === 'Selfy')!.depth).toBe(0)
  })

  it('fails closed when parentRef library diverges from the request library', async () => {
    await zoteroError(
      provider.browse({
        kind: 'collections',
        library: { type: 'group', id: 42 },
        parentRef: 'zotero://user/0/collection/COLL0001',
        offset: 0,
        limit: 10,
      }),
      ZOTERO_INVALID_ARGUMENT,
      'Library mismatch',
    )
  })

  it('rejects parentRef for non-collections kinds', async () => {
    await zoteroError(
      provider.browse({
        kind: 'tags',
        parentRef: 'zotero://user/0/collection/COLL0001',
        offset: 0,
        limit: 10,
      }),
      ZOTERO_INVALID_ARGUMENT,
      'parentRef is only valid',
    )
  })

  it('propagates non-404 ancestor failures instead of truncating silently', async () => {
    mock.route('GET', '/api/users/0/collections/COLL0001/collections', (req, res, helpers) =>
      helpers.json(
        [
          {
            key: 'COLL0002',
            data: { key: 'COLL0002', name: 'Child', parentCollection: 'COLL0001' },
          },
        ],
        { 'Total-Results': '1' },
      ),
    )
    mock.route('GET', '/api/users/0/collections/COLL0001', (req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    await zoteroError(
      provider.browse({
        kind: 'collections',
        parentRef: 'zotero://user/0/collection/COLL0001',
        offset: 0,
        limit: 10,
      }),
      'ZOTERO_UNEXPECTED',
      'HTTP 500',
    )
  })

  it('supports group library', async () => {
    const cols = [{ key: 'COLL0001', data: { key: 'COLL0001', name: 'G Root' } }]
    mock.route('GET', '/api/groups/42/collections/top', (req, res, helpers) =>
      helpers.json(cols, { 'Total-Results': '1', 'Zotero-Server-ID': 'S2' }),
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

describe('browse: itemFields', () => {
  it('lists the fields and creator types valid for one item type', async () => {
    const seen: string[] = []
    mock.route('GET', '/api/itemTypeFields', (req, res, helpers, search) => {
      expect(search.get('itemType')).toBe('dataset')
      seen.push('fields')
      helpers.json([
        { field: 'repository', localized: 'Repository' },
        { field: 'versionNumber', localized: 'Version' },
      ])
    })
    mock.route('GET', '/api/itemTypeCreatorTypes', (req, res, helpers) => {
      seen.push('creators')
      helpers.json([{ creatorType: 'author', localized: 'Author' }])
    })
    const result = await provider.browse({
      kind: 'itemFields',
      itemType: 'dataset',
      offset: 0,
      limit: 10,
    })
    expect(seen).toEqual(['fields', 'creators'])
    expect(result.total).toBe(3)
    expect(result.items).toEqual([
      { field: 'repository', localized: 'Repository' },
      { field: 'versionNumber', localized: 'Version' },
      { creatorType: 'author', localized: 'Author' },
    ])
  })

  it('paginates itemFields against the merged row list', async () => {
    mock.route('GET', '/api/itemTypeFields', (req, res, helpers) =>
      helpers.json([{ field: 'a' }, { field: 'b' }]),
    )
    mock.route('GET', '/api/itemTypeCreatorTypes', (req, res, helpers) =>
      helpers.json([{ creatorType: 'author' }]),
    )
    const page = await provider.browse({
      kind: 'itemFields',
      itemType: 'journalArticle',
      offset: 0,
      limit: 2,
    })
    expect(page.returned).toBe(2)
    expect(page.nextOffset).toBe(2)
  })

  it('fails closed without a well-formed item type or with a library', async () => {
    await zoteroError(
      provider.browse({ kind: 'itemFields', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      'requires a Zotero item type name',
    )
    await zoteroError(
      provider.browse({ kind: 'itemFields', itemType: 'bad type!', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      'requires a Zotero item type name',
    )
    await zoteroError(
      provider.browse({
        kind: 'itemFields',
        itemType: 'dataset',
        library: { type: 'user', id: 0 },
        offset: 0,
        limit: 5,
      }),
      ZOTERO_INVALID_ARGUMENT,
      'library is not allowed',
    )
    await zoteroError(
      provider.browse({ kind: 'tags', itemType: 'dataset', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      'itemType is only valid when kind="itemFields"',
    )
    expect(mock.requests).toEqual([])
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
  it('paginates tags with exactly one request per page', async () => {
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
    // Each page is one server-paged request — never a whole-listing scan.
    expect(mock.requests.filter((req) => req.pathname === '/api/users/0/tags')).toHaveLength(1)
    await provider.browse({ kind: 'tags', offset: 4, limit: 2 })
    expect(mock.requests.filter((req) => req.pathname === '/api/users/0/tags')).toHaveLength(2)
  })
  it('fails closed when Total-Results header is missing', async () => {
    mock.route('GET', '/api/users/0/tags', (req, res, helpers) => helpers.json([{ tag: 'a' }]))
    await expect(provider.browse({ kind: 'tags', offset: 0, limit: 10 })).rejects.toThrow(
      'Total-Results',
    )
  })

  it('counts scoped tags over a collection resolved by ref, with item query params', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(
        { key: 'COLL1234', data: { key: 'COLL1234', name: 'LLM Papers' } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route(
      'GET',
      '/api/users/0/collections/COLL1234/items/top/tags',
      (req, res, helpers, search) => {
        expect(search.get('itemQ')).toBe('agent memory')
        expect(search.get('itemQMode')).toBe('titleCreatorYear')
        expect(search.get('start')).toBe('0')
        helpers.json(
          [
            { tag: 'long-term-memory', meta: { numItems: 31 } },
            { tag: 'benchmark', meta: { numItems: 9 } },
          ],
          { 'Total-Results': '2', 'Zotero-Server-ID': 'S1' },
        )
      },
    )
    const result = await provider.browse({
      kind: 'tags',
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' },
      itemQuery: 'agent memory',
      offset: 0,
      limit: 10,
    })
    expect(result.total).toBe(2)
    expect(result.serverId).toBe('S1')
    expect(result.items.map((item) => (item as { tag: string }).tag)).toEqual([
      'long-term-memory',
      'benchmark',
    ])
  })

  it('resolves a collection by name through the cached listing before the scoped tags call', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([{ key: 'COLL1234', data: { key: 'COLL1234', name: 'LLM Papers' } }], {
        'Zotero-Server-ID': 'S1',
      }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top/tags', (req, res, helpers) =>
      helpers.json([{ tag: 'rag' }], { 'Total-Results': '1' }),
    )
    const result = await provider.browse({
      kind: 'tags',
      scope: { kind: 'collection', refOrName: 'LLM Papers' },
      offset: 0,
      limit: 10,
    })
    expect(result.total).toBe(1)
  })

  it('maps library/publications scopes and the all item level to their endpoints', async () => {
    const routed: string[] = []
    const route = (matcher: string): void => {
      mock.route('GET', matcher, (req, res, helpers) => {
        routed.push(matcher)
        helpers.json([{ tag: 'x' }], { 'Total-Results': '1' })
      })
    }
    route('/api/users/0/items/top/tags')
    route('/api/users/0/items/tags')
    route('/api/users/0/publications/items/top/tags')
    route('/api/users/0/publications/items/tags')

    await provider.browse({ kind: 'tags', scope: { kind: 'library' }, offset: 0, limit: 5 })
    await provider.browse({
      kind: 'tags',
      scope: { kind: 'library' },
      itemLevel: 'all',
      offset: 0,
      limit: 5,
    })
    await provider.browse({ kind: 'tags', scope: { kind: 'publications' }, offset: 0, limit: 5 })
    await provider.browse({
      kind: 'tags',
      scope: { kind: 'publications' },
      itemLevel: 'all',
      offset: 0,
      limit: 5,
    })
    expect(routed).toEqual([
      '/api/users/0/items/top/tags',
      '/api/users/0/items/tags',
      '/api/users/0/publications/items/top/tags',
      '/api/users/0/publications/items/tags',
    ])
  })

  it('fails closed on facet params without a scope or on a non-tags kind', async () => {
    await zoteroError(
      provider.browse({ kind: 'tags', itemQuery: 'x', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      'require a scope',
    )
    await zoteroError(
      provider.browse({ kind: 'collections', scope: { kind: 'library' }, offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      'only valid when kind="tags"',
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
