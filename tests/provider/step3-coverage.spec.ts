import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  createProvider,
  setupProvider,
  teardownProvider,
  zoteroError,
  request,
} from '../helpers/provider-harness.js'
import { encodeLiteralTag, encodeExcludeTag, buildSearchParams } from '../../src/provider-local.js'
import { normalizeItemDetail } from '../../src/normalize.js'
import { parseRef } from '../../src/refs.js'
import { ZoteroService } from '../../src/service.js'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'

describe('step3: encode tag helpers (DRY, double-escape clarification)', () => {
  it('encodeLiteralTag escapes leading dash', () => {
    expect(encodeLiteralTag('-foo')).toBe('\\-foo')
    expect(encodeLiteralTag('foo')).toBe('foo')
    expect(encodeLiteralTag('--foo')).toBe('\\--foo')
    expect(encodeLiteralTag('')).toBe('')
    expect(encodeLiteralTag('-')).toBe('\\-')
  })
  it('encodeExcludeTag yields - + escaped literal ( -foo literal => -\\-foo )', () => {
    expect(encodeExcludeTag('foo')).toBe('-foo')
    expect(encodeExcludeTag('-foo')).toBe('-\\-foo')
    expect(encodeExcludeTag('--foo')).toBe('-\\--foo')
  })
  it('buildSearchParams serializes excludeTags with correct escaping', () => {
    const params = buildSearchParams({
      query: undefined,
      mode: 'metadata',
      scope: { kind: 'library' },
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 10,
      excludeTags: ['-foo', 'bar'],
    })
    expect(params.getAll('tag')).toEqual(['-\\-foo', '-bar'])
  })
  it('buildSearchParams handles tags any/all', () => {
    const any = buildSearchParams({
      query: undefined,
      mode: 'metadata',
      scope: { kind: 'library' },
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 10,
      tags: ['a', 'b'],
      tagMatch: 'any',
    })
    expect(any.get('tag')).toBe('a || b')
    const all = buildSearchParams({
      query: undefined,
      mode: 'metadata',
      scope: { kind: 'library' },
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 10,
      tags: ['a', 'b'],
      tagMatch: 'all',
    })
    expect(all.getAll('tag')).toEqual(['a', 'b'])
  })
})

describe('step3: browseTags pagination (fix 100 truncation)', () => {
  let mock: MockZotero
  let provider: ReturnType<typeof createProvider>
  beforeEach(async () => {
    const h = await setupProvider({ maxBrowseResults: 200 })
    mock = h.mock as unknown as MockZotero
    provider = h.provider
    // stash harness for teardown
    ;(globalThis as unknown as Record<string, unknown>).__h = h
  })
  afterEach(async () => {
    await teardownProvider((globalThis as unknown as Record<string, unknown>).__h as never)
  })

  it('paginates via server-side start/limit and Total-Results', async () => {
    const allTags = Array.from({ length: 150 }, (_, i) => ({
      tag: `t${String(i).padStart(3, '0')}`,
      meta: { numItems: 150 - i },
    }))
    mock.route('GET', '/api/users/0/tags', (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '100')
      const slice = allTags.slice(start, start + limit)
      helpers.json(slice, { 'Zotero-Server-ID': 'S-tags', 'Total-Results': String(allTags.length) })
    })
    const page1 = await provider.browse({ kind: 'tags', offset: 0, limit: 100 })
    expect(page1.total).toBe(150)
    expect(page1.returned).toBe(100)
    expect(page1.nextOffset).toBe(100)
    expect(page1.serverId).toBe('S-tags')
    expect(mock.requests.filter((r) => r.pathname === '/api/users/0/tags')).toHaveLength(1)
    const page2 = await provider.browse({ kind: 'tags', offset: 100, limit: 100 })
    expect(page2.returned).toBe(50)
    expect(page2.total).toBe(150)
    expect(page2.items[0]).toEqual(expect.objectContaining({ tag: 't100' }))
    expect(mock.requests.filter((r) => r.pathname === '/api/users/0/tags')).toHaveLength(2)
  })

  it('q filter with contains vs startsWith via server qmode', async () => {
    const allTags = [{ tag: 'alpha' }, { tag: 'beta' }, { tag: 'alphabeta' }, { tag: 'AlphaBeta2' }]
    mock.route('GET', '/api/users/0/tags', (req, res, helpers, search) => {
      const q = search.get('q') ?? ''
      const qmode = search.get('qmode') ?? 'contains'
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      let filtered = allTags
      if (q !== '') {
        const lower = q.toLowerCase()
        filtered = allTags.filter((t) =>
          qmode === 'startsWith'
            ? t.tag.toLowerCase().startsWith(lower)
            : t.tag.toLowerCase().includes(lower),
        )
      }
      const slice = filtered.slice(start, start + limit)
      helpers.json(slice, { 'Total-Results': String(filtered.length) })
    })
    const contains = await provider.browse({
      kind: 'tags',
      q: 'alpha',
      match: 'contains',
      offset: 0,
      limit: 10,
    })
    expect(contains.total).toBe(3) // alpha, alphabeta, AlphaBeta2
    const starts = await provider.browse({
      kind: 'tags',
      q: 'alpha',
      match: 'startsWith',
      offset: 0,
      limit: 10,
    })
    expect(starts.total).toBe(3) // same but filtered startsWith includes alpha* only; all 3 start with alpha lowercased
    const startsBeta = await provider.browse({
      kind: 'tags',
      q: 'beta',
      match: 'startsWith',
      offset: 0,
      limit: 10,
    })
    expect(startsBeta.total).toBe(1)
  })

  it('single request per page, no full scan', async () => {
    const tags = [{ tag: 'a' }, { tag: 'b' }]
    let call = 0
    mock.route('GET', '/api/users/0/tags', (req, res, helpers, search) => {
      call++
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      const slice = tags.slice(start, start + limit)
      helpers.json(slice, { 'Total-Results': String(tags.length) })
    })
    const r = await provider.browse({ kind: 'tags', offset: 0, limit: 10 })
    expect(r.total).toBe(2)
    expect(r.returned).toBe(2)
    expect(call).toBe(1)
  })
})

describe('step3: browseCollections single GET and parent fail-closed', () => {
  let mock: MockZotero
  let provider: ReturnType<typeof createProvider>
  let harness: Awaited<ReturnType<typeof setupProvider>>
  beforeEach(async () => {
    harness = await setupProvider()
    mock = harness.mock
    provider = harness.provider
  })
  afterEach(async () => {
    await teardownProvider(harness)
  })

  it('single page derives entries and emits parentRef straight from the row', async () => {
    mock.route('GET', '/api/users/0/collections/top', (req, res, helpers) =>
      helpers.json(
        [
          { key: 'COLL0001', data: { key: 'COLL0001', name: 'Root' } },
          {
            key: 'COLL0002',
            data: { key: 'COLL0002', name: 'Child', parentCollection: 'COLL0001' },
          },
        ],
        { 'Total-Results': '2', 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/collections/COLL0001', (req, res, helpers) =>
      helpers.json({ key: 'COLL0001', data: { key: 'COLL0001', name: 'Root' } }),
    )
    const result = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    expect(mock.requests.filter((r) => r.pathname === '/api/users/0/collections/top')).toHaveLength(
      1,
    )
    const rows = result.items as unknown as Array<{
      path: string[]
      parentRef?: string
      depth: number
      name: string
    }>
    const child = rows.find((i) => i.name === 'Child')!
    // The row itself declares the parent, so parentRef is emitted even though
    // the breadcrumb walk only proves the name via the ancestor GET.
    expect(child.parentRef).toBe('zotero://user/0/collection/COLL0001?server=S1')
    expect(child.path).toEqual(['Root', 'Child'])
    expect(child.depth).toBe(1)
    const root = rows.find((i) => i.name === 'Root')!
    expect(root.parentRef).toBeUndefined()
    expect(root.path).toEqual(['Root'])
  })

  it('handles a self-referential parent without looping (20)', async () => {
    mock.route('GET', '/api/users/0/collections/top', (req, res, helpers) =>
      helpers.json(
        [
          {
            key: 'COLL0001',
            data: { key: 'COLL0001', name: 'Self', parentCollection: 'COLL0001' },
          },
        ],
        { 'Total-Results': '1' },
      ),
    )
    const r = await provider.browse({ kind: 'collections', offset: 0, limit: 10 })
    expect(r.total).toBe(1)
    expect((r.items[0] as unknown as { depth: number }).depth).toBe(0)
  })
})

describe('step3: browseSavedSearches single GET', () => {
  let harness: Awaited<ReturnType<typeof setupProvider>>
  beforeEach(async () => {
    harness = await setupProvider()
  })
  afterEach(async () => {
    await teardownProvider(harness)
  })
  it('single GET and conditions mapping', async () => {
    const searches = [
      { key: 'SRCH0001', data: { key: 'SRCH0001', name: 'A', conditions: [{ a: 1 }] } },
      { key: 'SRCH0002', data: { key: 'SRCH0002', name: 'B' } },
    ]
    harness.mock.route('GET', '/api/users/0/searches', (req, res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      helpers.json(searches.slice(start, start + limit), {
        'Total-Results': String(searches.length),
        'Zotero-Server-ID': 'S2',
      })
    })
    const r = await harness.provider.browse({ kind: 'savedSearches', offset: 0, limit: 10 })
    expect(
      harness.mock.requests.filter((x) => x.pathname === '/api/users/0/searches'),
    ).toHaveLength(1)
    expect(r.serverId).toBe('S2')
    expect((r.items as unknown as Array<{ conditions?: unknown }>)[0]!.conditions).toEqual([
      { a: 1 },
    ])
  })
})

describe('step3: browse fail-closed library param', () => {
  let harness: Awaited<ReturnType<typeof setupProvider>>
  beforeEach(async () => {
    harness = await setupProvider()
  })
  afterEach(async () => {
    await teardownProvider(harness)
  })
  it('provider throws for libraries/itemTypes with library', async () => {
    await zoteroError(
      harness.provider.browse({
        kind: 'libraries',
        offset: 0,
        limit: 5,
        library: { type: 'group', id: 1 },
      }),
      'ZOTERO_INVALID_ARGUMENT',
      'library is not allowed',
    )
    await zoteroError(
      harness.provider.browse({
        kind: 'itemTypes',
        offset: 0,
        limit: 5,
        library: { type: 'user', id: 0 },
      }),
      'ZOTERO_INVALID_ARGUMENT',
    )
  })
  it('tool layer throws via execute', async () => {
    const ctx = new Context()
    const mock = harness.mock
    await ctx.plugin(SystemPrompt, {})
    const ToolRuntime = (await import('@deepseek-ai/dsh-tools')).default as unknown as never
    await ctx.plugin(ToolRuntime as never, {} as never)
    await ctx.plugin(ZoteroService as never, { baseUrl: mock.baseUrl } as never)
    const run = (args: Record<string, unknown>) =>
      ctx.tools.execute({
        callId: CallId('t1'),
        name: 'zotero_browse',
        arguments: args,
        signal: new AbortController().signal,
      })
    const r = await run({ kind: 'libraries', library: { type: 'group', id: 1 } })
    expect(r.isError).toBe(true)
    const r2 = await run({ kind: 'tags', match: 'contains' })
    expect(r2.isError).toBe(true)
  })
})

describe('step3: resolveScope group inference', () => {
  let harness: Awaited<ReturnType<typeof setupProvider>>
  beforeEach(async () => {
    harness = await setupProvider()
    // collections for group
    harness.mock.route('GET', '/api/groups/42/collections/COLL1234', (req, res, helpers) =>
      helpers.json(
        { key: 'COLL1234', data: { key: 'COLL1234', name: 'GCol' } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    harness.mock.route(
      'GET',
      '/api/groups/42/collections/COLL1234/items/top',
      (req, res, helpers) => helpers.json([], { 'Total-Results': '0' }),
    )
    harness.mock.route('GET', /^\/api\/groups\/42\/items/, (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
    harness.mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json({ key: 'COLL1234', data: { key: 'COLL1234', name: 'PCol' } }),
    )
    harness.mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
  })
  afterEach(async () => {
    await teardownProvider(harness)
  })
  it('infers group library from ref when library omitted', async () => {
    const result = await harness.provider.search(
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
  it('mismatch when explicit library diverges', async () => {
    await zoteroError(
      harness.provider.search(
        request({
          scope: { kind: 'collection', refOrName: 'zotero://group/42/collection/COLL1234' },
          library: { type: 'user', id: 0 },
        }),
      ),
      'ZOTERO_INVALID_ARGUMENT',
      'Library mismatch',
    )
  })
})

describe('step3: normalize libraryID compatibility', () => {
  it('handles libraryID string and libraryId variants', () => {
    const base = {
      key: 'ABCD1234',
      data: {
        itemType: 'journalArticle',
        title: 'T',
        relations: { 'dc:relation': ['http://zotero.org/users/123/items/BBBB1234'] },
      },
    }
    const cases: Array<{ parent: Record<string, unknown>; expectedHasRef: boolean }> = [
      { parent: { ...base, library: { type: 'user', id: 123 } }, expectedHasRef: true },
      { parent: { ...base, library: { libraryID: 123 } }, expectedHasRef: true },
      { parent: { ...base, library: { libraryId: 123 } }, expectedHasRef: true },
      { parent: { ...base, library: { id: '123' as unknown as number } }, expectedHasRef: true },
      {
        parent: { ...base, library: { libraryID: '123' as unknown as number } },
        expectedHasRef: true,
      },
      { parent: { ...base, libraryID: 123 }, expectedHasRef: true },
      { parent: { ...base, libraryId: 123 }, expectedHasRef: true },
      { parent: { ...base, library: { type: 'user', id: 999 } }, expectedHasRef: false },
      { parent: { ...base }, expectedHasRef: false },
    ]
    for (const c of cases) {
      const d = normalizeItemDetail({
        parent: c.parent as unknown as never,
        library: { type: 'user', id: 0 },
        include: new Set(),
        maxAbstractChars: 100,
        maxNoteBodyChars: 100,
        maxNoteChars: 100,
        maxNoteRecords: 10,
        maxAnnotationRecords: 10,
      })
      if (c.expectedHasRef)
        expect(d.relations?.[0]?.targetRef).toBe('zotero://user/0/item/BBBB1234')
      else expect(d.relations?.[0]?.targetRef).toBeUndefined()
    }
  })
  it('group relation still maps when same group', () => {
    const d = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'book',
          title: 'T',
          relations: { 'dc:relation': ['http://zotero.org/groups/5/items/BBBB1234'] },
        },
      },
      library: { type: 'group', id: 5 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d.relations?.[0]?.targetRef).toBe('zotero://group/5/item/BBBB1234')
  })
})

describe('step3: service browse capability guard', () => {
  it('throws when provider lacks browse capability', async () => {
    const mock = await MockZotero.start()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime as never, {} as never)
    await ctx.plugin(ZoteroService as never, { baseUrl: mock.baseUrl } as never)
    const zotero = ctx.get('zotero') as unknown as {
      providers: Map<string, unknown>
      config: { provider: string }
    }
    const fake = {
      id: 'local',
      capabilities: new Set(['search']),
      status: async () => ({ connected: true, diagnosis: 'ok', providerId: 'local' }),
    }
    zotero.providers.set('local', fake)
    const service = ctx.get('zotero') as unknown as ZoteroService
    await expect(service.browse({ kind: 'libraries', offset: 0, limit: 5 })).rejects.toThrow()
    await mock.close()
  })
  it('throws when provider declares browse but missing method', async () => {
    const mock = await MockZotero.start()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime as never, {} as never)
    await ctx.plugin(ZoteroService as never, { baseUrl: mock.baseUrl } as never)
    const zotero = ctx.get('zotero') as unknown as {
      providers: Map<string, unknown>
      config: { provider: string }
    }
    const fake = {
      id: 'local',
      capabilities: new Set(['browse']),
      status: async () => ({ connected: true, diagnosis: 'ok', providerId: 'local' }),
    }
    zotero.providers.set('local', fake)
    const service = ctx.get('zotero') as unknown as ZoteroService
    await expect(service.browse({ kind: 'libraries', offset: 0, limit: 5 })).rejects.toThrow(
      'browse not supported',
    )
    await mock.close()
  })
})

describe('step3: browse tool edge branches', () => {
  it('parseLibrary errors and assertIntInRange', async () => {
    const mock = await MockZotero.start()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime as never, {} as never)
    await ctx.plugin(ZoteroService as never, { baseUrl: mock.baseUrl } as never)
    const run = (args: Record<string, unknown>) =>
      ctx.tools.execute({
        callId: CallId('t2'),
        name: 'zotero_browse',
        arguments: args,
        signal: new AbortController().signal,
      })
    const cases = [
      { args: { kind: 'libraries', library: { type: 'bad', id: 0 } }, contains: 'library.type' },
      { args: { kind: 'tags', library: { type: 'user', id: 'x' } }, contains: 'library.id' },
      { args: { kind: 'tags', library: { type: 'user', id: 1 } }, contains: 'Only user/0' },
      {
        args: { kind: 'tags', library: { type: 'group', id: 0 } },
        contains: 'group id must be positive',
      },
      { args: { kind: 'tags', offset: -1 }, contains: 'offset' },
      { args: { kind: 'tags', limit: 9999 }, contains: 'limit' },
      { args: { kind: 'unsupported' }, contains: 'kind' },
    ]
    for (const c of cases) {
      const r = await run(c.args as never)
      expect(r.isError).toBe(true)
      expect((r.content[0] as { text: string }).text).toContain(c.contains)
    }
    await mock.close()
  })
})

describe('step3: remaining branches', () => {
  it('normalize relations predicate value is number -> empty targets', () => {
    const d = normalizeItemDetail({
      parent: {
        key: 'ABCD1234',
        data: {
          itemType: 'book',
          title: 'T',
          relations: { 'dc:relation': 42 as unknown as string },
        },
      },
      library: { type: 'user', id: 0 },
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
    })
    expect(d.relations).toBeUndefined()
  })
  it('refs assertSupportedLocalRef unknown library type', async () => {
    const { requireSupportedLocalRef } = await import('../../src/refs.js')
    expect(() =>
      requireSupportedLocalRef({
        library: { type: 'unknown' as unknown as 'user', id: 0 },
        kind: 'item',
        key: 'ABCD1234',
      }),
    ).toThrow()
  })
  it('browse render and presentCall branches', async () => {
    const { renderBrowse, buildRequest } = await import('../../src/tools/browse.js')
    const { buildRequest: buildSearchRequest } = await import('../../src/tools/search.js')
    // renderBrowse with and without nextOffset and with various item shapes
    const out1 = renderBrowse(
      { kind: 'tags', offset: 0, limit: 10 } as never,
      {
        kind: 'tags',
        total: 2,
        returned: 2,
        offset: 0,
        items: [{ tag: 'a' }, { itemType: 'book' }],
      } as never,
    )
    expect((out1[0] as { text: string }).text).toContain('a')
    // Fallback shapes: a library row without a name, a collection row without
    // a ref, and an unknown row with neither name nor ref.
    const fallbacks = renderBrowse(
      { kind: 'libraries', offset: 0, limit: 10 } as never,
      {
        kind: 'libraries',
        total: 3,
        returned: 3,
        offset: 0,
        nextOffset: undefined,
        items: [
          { library: { type: 'group', id: 9 } },
          { path: ['Root'] },
          { conditions: [{ condition: 'unread' }] },
        ],
      } as never,
    )
    const fallbackText = (fallbacks[0] as { text: string }).text
    expect(fallbackText).toContain('group/9 — group/9')
    expect(fallbackText).toContain('1.'.length ? 'Root' : 'Root')
    expect(fallbackText).not.toContain('undefined')
    // itemFields row shapes with and without localized labels
    const outFields = renderBrowse(
      { kind: 'itemFields', offset: 0, limit: 10 } as never,
      {
        kind: 'itemFields',
        total: 3,
        returned: 3,
        offset: 0,
        items: [
          { field: 'repository', localized: 'Repository' },
          { field: 'archive' },
          { creatorType: 'author' },
        ],
      } as never,
    )
    const fieldsText = (outFields[0] as { text: string }).text
    expect(fieldsText).toContain('field repository (Repository)')
    expect(fieldsText).toContain('field archive')
    expect(fieldsText).toContain('creatorType author')
    // buildRequest scope mapping for every tagScope value
    const scoped = buildRequest(
      {
        kind: 'tags',
        offset: 0,
        limit: 5,
        tagScope: 'collection',
        tagCollection: 'zotero://user/0/collection/COLL0001',
        itemLevel: 'all',
        itemQuery: 'memory',
        itemQueryMode: 'everything',
      } as never,
      { maxBrowseResults: 50 },
    )
    expect(scoped.scope).toEqual({
      kind: 'collection',
      refOrName: 'zotero://user/0/collection/COLL0001',
    })
    expect(scoped.itemLevel).toBe('all')
    expect(scoped.itemQuery).toBe('memory')
    expect(scoped.itemQueryMode).toBe('everything')
    const publications = buildRequest(
      { kind: 'tags', offset: 0, limit: 5, tagScope: 'publications' } as never,
      { maxBrowseResults: 50 },
    )
    expect(publications.scope).toEqual({ kind: 'publications' })
    const libraryScope = buildRequest(
      { kind: 'tags', offset: 0, limit: 5, tagScope: 'library' } as never,
      { maxBrowseResults: 50 },
    )
    expect(libraryScope.scope).toEqual({ kind: 'library' })
    const out2 = renderBrowse(
      { kind: 'tags', offset: 0, limit: 10 } as never,
      {
        kind: 'tags',
        total: 10,
        returned: 2,
        offset: 0,
        nextOffset: 2,
        items: [{ ref: 'zotero://user/0/item/ABCD1234' }],
      } as never,
    )
    expect((out2[0] as { text: string }).text).toContain('More: browse again')
    // buildRequest branches: match without q
    expect(() =>
      buildRequest({ kind: 'tags', offset: 0, limit: 5, match: 'contains' } as never, {
        maxBrowseResults: 50,
      }),
    ).toThrow()
    // unsupported kind and non-integer library id
    expect(() =>
      buildRequest({ kind: 'shelves', offset: 0, limit: 5 } as never, { maxBrowseResults: 50 }),
    ).toThrow('Unsupported browse kind')
    const { parseLibrary } = await import('../../src/tools/browse.js')
    expect(() => parseLibrary({ type: 'user', id: 0.5 })).toThrow('library.id must be integer')
    expect(() => parseLibrary({ type: 'shelves', id: 1 })).toThrow(
      'library.type must be user or group',
    )
    // search buildRequest branches: tagMatch invalid, includeTrashed with collection, library type invalid, id not integer, user id non-zero, group id <=0
    const cfg = { maxSearchResults: 20 } as unknown as import('../../src/config.js').ResolvedConfig
    expect(() => buildSearchRequest({ tagMatch: 'bad' } as never, cfg)).toThrow()
    expect(() =>
      buildSearchRequest(
        { includeTrashed: true, scope: { kind: 'collection', refOrName: 'x' } } as never,
        cfg,
      ),
    ).toThrow()
    expect(() => buildSearchRequest({ library: { type: 'bad', id: 0 } } as never, cfg)).toThrow()
    expect(() =>
      buildSearchRequest({ library: { type: 'user', id: 'x' as unknown as number } } as never, cfg),
    ).toThrow()
    expect(() => buildSearchRequest({ library: { type: 'user', id: 1 } } as never, cfg)).toThrow()
    expect(() => buildSearchRequest({ library: { type: 'group', id: 0 } } as never, cfg)).toThrow()
    // also hit assertIntInRange via buildRequest with bad offset/limit
    expect(() =>
      buildRequest({ kind: 'tags', offset: -1, limit: 5 } as never, { maxBrowseResults: 50 }),
    ).toThrow()
    expect(() =>
      buildRequest({ kind: 'tags', offset: 0, limit: 0 } as never, { maxBrowseResults: 50 }),
    ).toThrow()
  })
  it('reducer library fallback (150) both branches', async () => {
    const { buildSourceWorkspace } = await import('../../src/client/sources/reducer.js')
    const wsInvalid = buildSourceWorkspace(
      [
        {
          callId: '1',
          state: 'success',
          kind: 'search',
          args: {
            scope: { kind: 'library' },
            library: { type: 'invalid', id: 'x' } as unknown as never,
          },
          result: {
            scope: { kind: 'library', library: { type: 'user', id: 0 } },
            items: [],
            total: 0,
            offset: 0,
            returned: 0,
          },
          meta: null,
        } as never,
      ],
      undefined,
    )
    expect(wsInvalid).toBeDefined()
    const wsValid = buildSourceWorkspace(
      [
        {
          callId: '2',
          state: 'success',
          kind: 'search',
          args: { scope: { kind: 'library' }, library: { type: 'group', id: 5 } },
          result: {
            scope: { kind: 'library', library: { type: 'user', id: 0 } },
            items: [],
            total: 0,
            offset: 0,
            returned: 0,
          },
          meta: null,
        } as never,
      ],
      undefined,
    )
    expect(wsValid).toBeDefined()
  })
  it('browse libraries 500 error throws (1508)', async () => {
    const h = await setupProvider()
    h.mock.route('GET', '/api/users/0/groups', (req, res, helpers) => helpers.raw(500, {}, 'err'))
    await expect(h.provider.browse({ kind: 'libraries', offset: 0, limit: 5 })).rejects.toThrow()
    await teardownProvider(h)
  })
  it('noteRowMatches with tag filters via search', async () => {
    const h = await setupProvider()
    // API returns 1 item, note scan will fetch note with tags
    const NOTE_WITH_TAGS = {
      key: 'NOTE9999',
      data: {
        itemType: 'note',
        note: '<p>cascade note</p>',
        tags: [{ tag: 'a' }, { tag: 'b' }],
        parentItem: 'ABCD1234',
      },
    }
    h.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_WITH_TAGS])
      else
        helpers.json(
          [
            {
              key: 'ABCD1234',
              data: { itemType: 'journalArticle', title: 'T' },
              meta: { parsedDate: '2023-01-01' },
            },
          ],
          { 'Total-Results': '1' },
        )
    })
    // tags all: note has a,b so should match
    const r1 = await h.provider.search(
      request({ query: 'cascade', tags: ['a', 'b'], tagMatch: 'all', limit: 5 }),
    )
    expect(r1.items.length).toBeGreaterThanOrEqual(1)
    // tags any: note has a so should match
    const r2 = await h.provider.search(
      request({ query: 'cascade', tags: ['a'], tagMatch: 'any', limit: 5 }),
    )
    expect(r2.supplemental).toBeDefined()
    // excludeTags: note has b, exclude b => should not match
    const r3 = await h.provider.search(request({ query: 'cascade', excludeTags: ['b'], limit: 5 }))
    expect(r3.supplemental).toBeUndefined()
    await teardownProvider(h)
  })
})
