import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE,
  MATCH_REQUIRES_Q_MESSAGE,
  OFFSET_NON_NEGATIVE_MESSAGE,
  Q_MATCH_SCOPE_MESSAGE,
  SCOPE_FACET_KIND_MESSAGE,
  SCOPE_NAME_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  browseLimitMessage,
  libraryNotAllowedMessage,
  unsupportedBrowseKindMessage,
} from '../../src/errors.js'
import { LocalApiProvider } from '../../src/local/provider.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { zoteroError } from '../helpers/server/assert.js'
import { COLLECTION_KEY, apiPath, collectionRef } from '../helpers/server/keys.js'
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
  it('reads the exact group shape Zotero serializes', async () => {
    // Ground truth: `Zotero.Group.prototype.toResponseJSON` under the local
    // API's `includeGroupDetails` emits
    // `{ id, version, links, meta, data: { id, version, name, description } }`
    // (Zotero 10 app/omni.ja → xpcom/data/group.js). The id rides the top
    // level; the name only the inner `data` block, which is the level this
    // fixture exercises — the serializer never puts `name` at the top.
    serveJson(
      mock,
      `${apiPath()}/groups`,
      [
        {
          id: 42,
          version: 17,
          links: { self: { href: 'http://127.0.0.1:23119/api/groups/42' } },
          meta: { numItems: 3 },
          data: { id: 42, version: 17, name: 'Research Group', description: 'Lab library' },
        },
      ],
      versionHeaders('S1'),
    )
    const result = await provider.browse({ kind: 'libraries', offset: 0, limit: 10 })
    expect(result.kind).toBe('libraries')
    expect(result.total).toBe(2)
    const group = (
      result.items as Array<{ library: { type: string; id: number }; name: string }>
    ).find((item) => item.library.type === 'group')
    expect(group).toBeDefined()
    expect(group!.library).toEqual({ type: 'group', id: 42 })
    expect(group!.name).toBe('Research Group')
  })
  it('skips a group row whose shape it does not recognize', async () => {
    // A row carrying only the JS-side property spelling (`groupID`) is not a
    // wire shape: it is skipped rather than guessed at, so an API change
    // surfaces as a missing library instead of a mislabelled one.
    serveJson(
      mock,
      `${apiPath()}/groups`,
      [{ groupID: 7, groupName: 'Mystery Group' }],
      versionHeaders('S1'),
    )
    const result = await provider.browse({ kind: 'libraries', offset: 0, limit: 10 })
    expect(result.total).toBe(1)
    expect(result.items.length).toBe(1)
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

describe('browse: savedSearches', () => {
  const searches = [
    savedSearchRow({
      key: 'SRCH0001',
      data: { name: 'Unread', conditions: [{ condition: 'unread', operator: 'true', value: '' }] },
    }),
    savedSearchRow({ key: 'SRCH0002', data: { name: 'Recent' } }),
    savedSearchRow({ key: 'SRCH0003', data: { name: 'Pinned' } }),
  ]
  function routeSearches() {
    mock.route('GET', `${apiPath()}/searches`, (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      helpers.json(searches.slice(start, start + limit), {
        ...versionHeaders('S1', 1),
        'Total-Results': String(searches.length),
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
  it('does not silently drop malformed condition rows', async () => {
    serveJson(
      mock,
      `${apiPath()}/searches`,
      [savedSearchRow({ data: { name: 'Broken', conditions: [{ condition: 'unread' }] } })],
      { 'Last-Modified-Version': '1', 'Total-Results': '1' },
    )
    await expect(provider.browse({ kind: 'savedSearches', offset: 0, limit: 10 })).rejects.toThrow(
      'malformed saved-search conditions',
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
      helpers.json(slice, {
        'Last-Modified-Version': '1',
        'Total-Results': String(filtered.length),
      })
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
      helpers.json(slice, { 'Last-Modified-Version': '1', 'Total-Results': String(tags.length) })
    })
    const r = await provider.browse({ kind: 'tags', offset: 2, limit: 2 })
    expect(r.returned).toBe(2)
    expect(r.total).toBe(5)
    expect(r.nextOffset).toBe(4)
    // Each page is one server-paged request: never a whole-listing scan.
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
          { 'Last-Modified-Version': '1', 'Total-Results': '2', 'Zotero-Server-ID': 'S1' },
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
      'Last-Modified-Version': '1',
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
        helpers.json([{ tag: 'x' }], { 'Last-Modified-Version': '1', 'Total-Results': '1' })
      })
    }
    route(`${apiPath()}/items/top/tags`)
    route(`${apiPath()}/items/tags`)
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
      `${apiPath()}/publications/items/tags`,
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
