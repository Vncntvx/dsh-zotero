import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ZoteroService from '../../src/index.js'
import { MockZotero } from '../helpers/mock-zotero.js'

let mock: MockZotero
let ctx: Context
let counter = 0

beforeEach(async () => {
  mock = await MockZotero.start()
  ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime as never, {} as never)
  await ctx.plugin(ZoteroService as never, { baseUrl: mock.baseUrl } as never)
})

afterEach(async () => {
  await mock.close()
})

function run(name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: CallId(`t-${++counter}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
}

describe('registry integration: zotero_get schema + render', () => {
  it('passes through tool validation with relations and renders them', async () => {
    const parent = {
      key: 'ABCD1234',
      version: 1,
      library: { type: 'user', id: 0 },
      links: {
        self: {
          href: 'http://localhost:23119/api/users/0/items/ABCD1234',
          type: 'application/json',
        },
      },
      meta: { creatorSummary: 'A', parsedDate: '2023-01-01', numChildren: 0 },
      data: {
        key: 'ABCD1234',
        itemType: 'journalArticle',
        title: 'T',
        creators: [],
        relations: {
          'dc:relation': ['http://zotero.org/users/0/items/BBBB1234'],
          'owl:sameAs': ['https://doi.org/10.1234/example'],
        },
      },
    }
    // Also need the target item to resolve? The normalizer will try to parse the relation URI and check library id.
    // For user/0 relation with id 0, it will create targetRef.
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(parent, { 'Zotero-Server-ID': 'S1' }),
    )
    const result = await run('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    // canonical output should contain relations and not be rejected by schema (additionalProperties:false)
    expect((result.value as { relations: unknown[] }).relations).toBeDefined()
    expect(
      (result.value as { relations: Array<{ predicate: string; targetRef?: string }> }).relations[0]
        ?.predicate,
    ).toBe('dc:relation')
    // render should contain Relations
    expect((result.content[0] as { text: string }).text).toContain('Relations:')
    expect((result.content[0] as { text: string }).text).toContain('dc:relation')
  })

  it('passes annotation parentRef through schema and preview', async () => {
    const parent = {
      key: 'ABCD1234',
      links: {
        self: {
          href: 'http://localhost:23119/api/users/0/items/ABCD1234',
          type: 'application/json',
        },
      },
      meta: { numChildren: 1 },
      data: { itemType: 'journalArticle', title: 'T', creators: [] },
    }
    const child = {
      key: 'ANN00001',
      data: {
        itemType: 'annotation',
        key: 'ANN00001',
        annotationType: 'highlight',
        annotationText: 'highlight text',
        parentItem: 'WXYZ6789',
        annotationPageLabel: '5',
      },
    }
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(parent))
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([child]),
    )
    const result = await run('zotero_get', {
      ref: 'zotero://user/0/item/ABCD1234',
      include: ['annotations'],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    const annotations = (result.value as { annotations: { items: Array<{ parentRef?: string }> } })
      .annotations
    expect(annotations.items[0]?.parentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    // meta should also contain parentRef in preview (via projectGetMeta)
    const meta = result.meta as Record<string, unknown>
    const preview = (meta['annotationsPreview'] as Array<{ parentRef?: string }>)?.[0]
    expect(preview?.parentRef).toBe('zotero://user/0/attachment/WXYZ6789')
  })
})

describe('registry integration: zotero_browse libraries Native identity', () => {
  it('renders group library with library=group/ID', async () => {
    mock.route('GET', '/api/users/0/groups', (req, res, helpers) =>
      helpers.json([{ id: 123456, name: 'Research Group' }], { 'Zotero-Server-ID': 'S1' }),
    )
    const result = await run('zotero_browse', { kind: 'libraries' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    // canonical should have library objects
    const items = (
      result.value as { items: Array<{ library: { type: string; id: number }; name: string }> }
    ).items
    expect(items.find((i) => i.library.type === 'group' && i.library.id === 123456)).toBeDefined()
    // Native render must contain group/123456 and library=group/123456
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Research Group — group/123456')
    expect(text).toContain('library=group/123456')
    expect(text).toContain('My Library — user/0')
    expect(text).toContain('library=user/0')
  })

  it('renders all items when limit >20 (no hidden slice)', async () => {
    const cols = Array.from({ length: 35 }, (_, i) => ({
      key: `COLL${String(i).padStart(4, '0')}`,
      data: { key: `COLL${String(i).padStart(4, '0')}`, name: `C${i}` },
    }))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(cols))
    const result = await run('zotero_browse', { kind: 'collections', limit: 35 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.value as { returned: number }).returned).toBe(35)
    const text = (result.content[0] as { text: string }).text
    // should contain 35 lines, not truncated to 20
    const lines = text.split('\n')
    // first line is "collections: 35 of 35", then 35 items, no "More:" because it's last page
    expect(lines.filter((l) => /^\d+\./.test(l)).length).toBe(35)
    expect(text).toContain('C34')
  })

  it('fails closed for q/match on non-tags via tool', async () => {
    const r = await run('zotero_browse', { kind: 'collections', q: 'foo' })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toContain(
      'q/match are only valid when kind="tags"',
    )
    const r2 = await run('zotero_browse', { kind: 'tags', match: 'contains' })
    expect(r2.isError).toBe(true)
  })
})

describe('registry integration: browse render exposes structured fields', () => {
  it('renders collection breadcrumbs instead of bare names', async () => {
    const cols = [
      { key: 'COLL0001', data: { key: 'COLL0001', name: 'Methods' } },
      { key: 'COLL0002', data: { key: 'COLL0002', name: 'RAG', parentCollection: 'COLL0001' } },
    ]
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(cols, { 'Zotero-Server-ID': 'S1' }),
    )
    const result = await run('zotero_browse', { kind: 'collections' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Methods / RAG — zotero://user/0/collection/COLL0002?server=S1')
    // The root keeps its single-segment path (its own name).
    expect(text).toContain('1. Methods — zotero://user/0/collection/COLL0001?server=S1')
  })

  it('renders tag counts, saved-search condition counts, and localized item types', async () => {
    mock.route('GET', '/api/users/0/tags', (req, res, helpers) =>
      helpers.json([{ tag: 'machine-learning', meta: { numItems: 84 } }], {
        'Total-Results': '1',
      }),
    )
    const tags = await run('zotero_browse', { kind: 'tags' })
    expect((tags.content[0] as { text: string }).text).toContain('machine-learning — 84 items')

    mock.route('GET', '/api/users/0/searches', (req, res, helpers) =>
      helpers.json(
        [
          {
            key: 'SRCH0001',
            data: {
              key: 'SRCH0001',
              name: 'Unread papers',
              conditions: [
                { condition: 'unread', operator: 'is', value: 'true' },
                { condition: 'itemType', operator: 'is', value: 'journalArticle' },
              ],
            },
          },
        ],
        { 'Total-Results': '1' },
      ),
    )
    const searches = await run('zotero_browse', { kind: 'savedSearches' })
    expect((searches.content[0] as { text: string }).text).toContain(
      'Unread papers — 2 conditions — zotero://user/0/search/SRCH0001',
    )

    mock.route('GET', '/api/itemTypes', (req, res, helpers) =>
      helpers.json([{ itemType: 'book', localized: 'Book' }]),
    )
    const types = await run('zotero_browse', { kind: 'itemTypes' })
    expect((types.content[0] as { text: string }).text).toContain('book (Book)')
  })

  it('rejects a whitespace-only q instead of silently dropping match', async () => {
    const result = await run('zotero_browse', { kind: 'tags', q: '   ', match: 'startsWith' })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      'q must be a non-empty string when provided',
    )
    expect(mock.requests.filter((entry) => entry.pathname === '/api/users/0/tags')).toEqual([])
  })
})

describe('registry integration: browseTags server pagination', () => {
  it('uses q/qmode and Total-Results via tool', async () => {
    const tags = [{ tag: 'alpha' }, { tag: 'beta' }, { tag: 'gamma' }]
    mock.route('GET', '/api/users/0/tags', (req, res, helpers, search) => {
      const q = search.get('q') ?? ''
      const qmode = search.get('qmode') ?? 'contains'
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '10')
      let filtered = tags
      if (q !== '') {
        const lower = q.toLowerCase()
        filtered = tags.filter((t) =>
          qmode === 'startsWith' ? t.tag.startsWith(lower) : t.tag.includes(lower),
        )
      }
      const slice = filtered.slice(start, start + limit)
      helpers.json(slice, { 'Total-Results': String(filtered.length) })
    })
    const r = await run('zotero_browse', { kind: 'tags', q: 'alp', match: 'contains', limit: 10 })
    expect(r.isError).toBe(false)
    if (r.isError) throw new Error('unreachable')
    expect((r.value as { total: number }).total).toBe(1)
    expect((r.content[0] as { text: string }).text).toContain('alpha')
    // verify the request actually sent qmode
    const lastReq = mock.requests[mock.requests.length - 1]!
    expect(lastReq.search.get('qmode')).toBe('contains')
  })
})
