import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'
import {
  ITEM_FIELDS_ITEM_TYPE_MESSAGE,
  ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE,
  ITEM_TYPE_SCOPE_MESSAGE,
  MATCH_REQUIRES_Q_MESSAGE,
  OFFSET_NON_NEGATIVE_MESSAGE,
  PARENT_REF_SCOPE_MESSAGE,
  Q_MATCH_SCOPE_MESSAGE,
  SCOPE_FACET_KIND_MESSAGE,
  SCOPE_NAME_MESSAGE,
  browseLimitMessage,
  libraryNotAllowedMessage,
  parentLibraryMismatchMessage,
  unsupportedBrowseKindMessage,
} from '../../src/local/browse-domain.js'
import { LocalApiProvider } from '../../src/local/provider.js'
import {
  createProvider,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, zoteroError } from '../helpers/server/assert.js'
import { COLLECTION_KEY, GROUP_LIBRARY, apiPath, collectionRef } from '../helpers/server/keys.js'
import { collectionRow, savedSearchRow, versionHeaders } from '../helpers/server/objects.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'

let mock: ProviderHarness['mock']
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
  limits: Partial<import('../../src/local/limits.js').LocalApiLimits> = {},
): LocalApiProvider {
  return createProvider(mock, limits)
}

describe('browse: validation', () => {
  it('rejects bad offset/limit and unsupported kind', async () => {
    await zoteroError(
      provider.browse({ kind: 'collections', offset: -1, limit: 5 } as never),
      'ZOTERO_INVALID_ARGUMENT',
      OFFSET_NON_NEGATIVE_MESSAGE,
    )
    await zoteroError(
      provider.browse({ kind: 'collections', offset: 0, limit: 0 } as never),
      'ZOTERO_INVALID_ARGUMENT',
      browseLimitMessage(50),
    )
    await zoteroError(
      provider.browse({ kind: 'collections', offset: 0, limit: 1000 } as never),
      'ZOTERO_INVALID_ARGUMENT',
      browseLimitMessage(50),
    )
    await zoteroError(
      provider.browse({ kind: 'unsupported' as never, offset: 0, limit: 5 }),
      'ZOTERO_INVALID_ARGUMENT',
      unsupportedBrowseKindMessage('unsupported'),
    )
  })

  it('rejects tag facets and mispairings at the provider boundary', async () => {
    await zoteroError(
      provider.browse({ kind: 'collections', q: 'x', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      Q_MATCH_SCOPE_MESSAGE,
    )
    await zoteroError(
      provider.browse({ kind: 'tags', match: 'contains', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      MATCH_REQUIRES_Q_MESSAGE,
    )
    await zoteroError(
      provider.browse({
        kind: 'tags',
        scope: { kind: 'collection', refOrName: '' },
        offset: 0,
        limit: 5,
      }),
      ZOTERO_INVALID_ARGUMENT,
      SCOPE_NAME_MESSAGE,
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
      libraryNotAllowedMessage('libraries'),
    )
    await zoteroError(
      provider.browse({
        kind: 'itemTypes',
        offset: 0,
        limit: 5,
        library: { type: 'user', id: 0 },
      }),
      ZOTERO_INVALID_ARGUMENT,
      libraryNotAllowedMessage('itemTypes'),
    )
  })
})

describe('browse: libraries', () => {
  it('returns personal + groups when available', async () => {
    serveJson(
      mock,
      `${apiPath()}/groups`,
      [
        { id: 1, name: 'Group One' },
        { id: 2, name: 'Group Two', data: { name: 'Group Two' } },
      ],
      versionHeaders('S1'),
    )
    const result = await provider.browse({ kind: 'libraries', offset: 0, limit: 10 })
    expect(result.kind).toBe('libraries')
    expect(result.total).toBe(3)
    expect(result.items.length).toBe(3)
    expect(result.serverId).toBe('S1')
  })
  it('falls back to personal when groups 404', async () => {
    serveStatus(mock, `${apiPath()}/groups`, 404, 'not found')
    const result = await provider.browse({ kind: 'libraries', offset: 0, limit: 10 })
    expect(result.total).toBe(1)
  })
  it('propagates a groups listing failure instead of degrading silently', async () => {
    serveStatus(mock, `${apiPath()}/groups`, 500, 'err')
    await expect(provider.browse({ kind: 'libraries', offset: 0, limit: 5 })).rejects.toThrow()
  })
  it('paginates libraries', async () => {
    serveJson(mock, `${apiPath()}/groups`, [
      { id: 1, name: 'G1' },
      { id: 2, name: 'G2' },
      { id: 3, name: 'G3' },
    ])
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
      collectionRow({ key: 'COLL0001', data: { name: 'Root B' } }),
      collectionRow({ key: 'COLL0002', data: { name: 'Root A' } }),
    ]
    mock.route('GET', `${apiPath()}/collections/top`, (req, res, helpers, search) => {
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
    const tops = Array.from({ length: 5 }, (_, i) =>
      collectionRow({ key: `COLL${String(i).padStart(4, '0')}`, data: { name: `C${i}` } }),
    )
    mock.route('GET', `${apiPath()}/collections/top`, (req, res, helpers, search) => {
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
      `${apiPath()}/collections/COLL0001/collections`,
      (req, res, helpers, search) => {
        expect(search.get('start')).toBe('0')
        helpers.json(
          [
            collectionRow({
              key: 'COLL0002',
              data: { name: 'Child A', parentCollection: 'COLL0001' },
            }),
            collectionRow({
              key: 'COLL0003',
              data: { name: 'Child B', parentCollection: 'COLL0001' },
            }),
          ],
          { 'Total-Results': '2', 'Zotero-Server-ID': 'S1' },
        )
      },
    )
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0001`,
      collectionRow({ key: 'COLL0001', data: { name: 'Root' } }),
      versionHeaders('S1'),
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
      mock.requests.filter((r) => r.pathname === `${apiPath()}/collections/COLL0001`),
    ).toHaveLength(1)
  })

  it('walks multi-level ancestors for deep breadcrumbs', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0003/collections`,
      [
        collectionRow({
          key: 'COLL0004',
          data: { name: 'Leaf', parentCollection: 'COLL0002' },
        }),
      ],
      { 'Total-Results': '1' },
    )
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0002`,
      collectionRow({ key: 'COLL0002', data: { name: 'Mid', parentCollection: 'COLL0001' } }),
    )
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0001`,
      collectionRow({ key: 'COLL0001', data: { name: 'Root' } }),
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
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0009/collections`,
      [
        collectionRow({
          key: 'COLL0010',
          data: { name: 'Orphan', parentCollection: 'MISSING1' },
        }),
        collectionRow({
          key: 'COLL0011',
          data: { name: 'Selfy', parentCollection: 'COLL0011' },
        }),
      ],
      { 'Total-Results': '2' },
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

  it('caches a phantom parent 404 so a later page does not re-fetch it', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0009/collections`,
      [
        collectionRow({
          key: 'COLL0010',
          data: { name: 'Orphan', parentCollection: 'MISSING1' },
        }),
      ],
      { 'Total-Results': '1' },
    )
    await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0009',
      offset: 0,
      limit: 10,
    })
    await provider.browse({
      kind: 'collections',
      parentRef: 'zotero://user/0/collection/COLL0009',
      offset: 0,
      limit: 10,
    })
    expect(
      mock.requests.filter((request) => request.pathname === `${apiPath()}/collections/MISSING1`),
    ).toHaveLength(1)
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
      parentLibraryMismatchMessage({ type: 'user', id: 0 }, { type: 'group', id: 42 }),
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
      PARENT_REF_SCOPE_MESSAGE,
    )
  })

  it('propagates non-404 ancestor failures instead of truncating silently', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/COLL0001/collections`,
      [collectionRow({ key: 'COLL0002', data: { name: 'Child', parentCollection: 'COLL0001' } })],
      { 'Total-Results': '1' },
    )
    serveStatus(mock, `${apiPath()}/collections/COLL0001`, 500, 'boom')
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
    const cols = [collectionRow({ key: 'COLL0001', data: { name: 'G Root' } })]
    serveJson(mock, `${apiPath(GROUP_LIBRARY)}/collections/top`, cols, {
      'Total-Results': '1',
      'Zotero-Server-ID': 'S2',
    })
    const result = await provider.browse({
      kind: 'collections',
      library: { type: 'group', id: 42 },
      offset: 0,
      limit: 10,
    })
    expect(result.library).toEqual(GROUP_LIBRARY)
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
    serveJson(mock, '/api/itemTypeFields', [{ field: 'a' }, { field: 'b' }])
    serveJson(mock, '/api/itemTypeCreatorTypes', [{ creatorType: 'author' }])
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
      ITEM_FIELDS_ITEM_TYPE_MESSAGE,
    )
    await zoteroError(
      provider.browse({ kind: 'itemFields', itemType: 'bad type!', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      ITEM_FIELDS_ITEM_TYPE_MESSAGE,
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
      libraryNotAllowedMessage('itemFields'),
    )
    await zoteroError(
      provider.browse({ kind: 'tags', itemType: 'dataset', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      ITEM_TYPE_SCOPE_MESSAGE,
    )
    expectRequestCount(mock, 0)
  })
})

describe('browse: savedSearches', () => {
  const searches = [
    savedSearchRow({
      key: 'SRCH0001',
      data: { name: 'Unread', conditions: [{ condition: 'unread' }] },
    }),
    savedSearchRow({ key: 'SRCH0002', data: { name: 'Recent' } }),
    savedSearchRow({ key: 'SRCH0003', data: { name: 'Pinned' } }),
  ]
  function routeSearches() {
    mock.route('GET', `${apiPath()}/searches`, (req, res, helpers, search) => {
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
    serveJson(mock, `${apiPath()}/searches`, searches)
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
    mock.route('GET', `${apiPath()}/tags`, (req, res, helpers, search) => {
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
    mock.route('GET', `${apiPath()}/tags`, (req, res, helpers, search) => {
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
    expect(mock.requests.filter((req) => req.pathname === `${apiPath()}/tags`)).toHaveLength(1)
    await provider.browse({ kind: 'tags', offset: 4, limit: 2 })
    expect(mock.requests.filter((req) => req.pathname === `${apiPath()}/tags`)).toHaveLength(2)
  })
  it('fails closed when Total-Results header is missing', async () => {
    serveJson(mock, `${apiPath()}/tags`, [{ tag: 'a' }])
    await expect(provider.browse({ kind: 'tags', offset: 0, limit: 10 })).rejects.toThrow(
      'Total-Results',
    )
  })

  it('counts scoped tags over a collection resolved by ref, with item query params', async () => {
    serveJson(
      mock,
      `${apiPath()}/collections/${COLLECTION_KEY}`,
      collectionRow(),
      versionHeaders('S1'),
    )
    mock.route(
      'GET',
      `${apiPath()}/collections/${COLLECTION_KEY}/items/top/tags`,
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
      scope: { kind: 'collection', refOrName: collectionRef() },
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
    serveJson(mock, `${apiPath()}/collections`, [collectionRow()], versionHeaders('S1'))
    serveJson(mock, `${apiPath()}/collections/${COLLECTION_KEY}/items/top/tags`, [{ tag: 'rag' }], {
      'Total-Results': '1',
    })
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
    route(`${apiPath()}/items/top/tags`)
    route(`${apiPath()}/items/tags`)
    route(`${apiPath()}/publications/items/top/tags`)
    route(`${apiPath()}/publications/items/tags`)

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
      `${apiPath()}/items/top/tags`,
      `${apiPath()}/items/tags`,
      `${apiPath()}/publications/items/top/tags`,
      `${apiPath()}/publications/items/tags`,
    ])
  })

  it('fails closed on facet params without a scope or on a non-tags kind', async () => {
    await zoteroError(
      provider.browse({ kind: 'tags', itemQuery: 'x', offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE,
    )
    await zoteroError(
      provider.browse({ kind: 'collections', scope: { kind: 'library' }, offset: 0, limit: 5 }),
      ZOTERO_INVALID_ARGUMENT,
      SCOPE_FACET_KIND_MESSAGE,
    )
  })
})

describe('browse: itemTypes', () => {
  it('lists item types', async () => {
    const types = [{ itemType: 'book', localized: 'Book' }, { itemType: 'journalArticle' }]
    serveJson(mock, '/api/itemTypes', types)
    const result = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 10 })
    expect(result.total).toBe(2)
  })
  it('paginates itemTypes', async () => {
    const types = Array.from({ length: 5 }, (_, i) => ({ itemType: `type${i}` }))
    serveJson(mock, '/api/itemTypes', types)
    const r = await provider.browse({ kind: 'itemTypes', offset: 0, limit: 2 })
    expect(r.returned).toBe(2)
  })
})
