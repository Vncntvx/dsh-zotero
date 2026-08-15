import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import { MockZotero } from './helpers/mock-zotero.js'

let mock: MockZotero
let ctx: Context
let callCounter = 0

beforeEach(async () => {
  mock = await MockZotero.start()
  ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl })
})

afterEach(async () => {
  await mock.close()
})

function runTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    callId: CallId(`tool-${++callCounter}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
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

describe('zotero_search tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    const definition = ctx.tools.get('zotero_search')
    expect(definition).toBeDefined()
    expect(ctx.tools.schemas().some((schema) => schema.name === 'zotero_search')).toBe(true)
  })

  it('executes a library search and renders a compact list', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    ))
    const result = await runTool('zotero_search', { query: 'flash attention', limit: 5 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(result.value).toEqual({
      scope: { kind: 'library' },
      items: [{
        ref: 'zotero://user/0/item/ABCD1234?server=S1',
        title: 'FlashAttention-2',
        creatorSummary: 'Dao, Tri',
        year: 2023,
        itemType: 'conferencePaper',
        bestAttachmentRef: undefined,
        bestAttachmentType: undefined,
        attachmentSize: undefined,
      }],
      total: 1,
      offset: 0,
      returned: 1,
      nextOffset: undefined,
    })
    expect(result.content[0]?.type).toBe('text')
    expect((result.content[0] as { text: string }).text).toBe(
      'Found 1 of 1 results:\n1. zotero://user/0/item/ABCD1234?server=S1 — FlashAttention-2 (2023) [conferencePaper] — Dao, Tri',
    )
  })

  it('chains a resolved scope ref into the next page without re-resolving names', async () => {
    const collection = { key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } }
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json([collection], { 'Zotero-Server-ID': 'S1' }))
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => helpers.json(collection, { 'Zotero-Server-ID': 'S1' }))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    ))
    const first = await runTool('zotero_search', { scope: { kind: 'collection', refOrName: 'LLM Papers' } })
    expect(first.isError).toBe(false)
    if (first.isError) throw new Error('unreachable')
    const scope = (first.value as { scope: { kind: string; ref: string } }).scope
    expect(scope).toEqual({ kind: 'collection', ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' })
    await runTool('zotero_search', { scope: { kind: 'collection', refOrName: scope.ref }, offset: 10 })
    // The ref page fetches only that collection (for its name) — the full
    // listing is never re-requested after the name has been resolved once.
    expect(mock.requests.map((request) => request.pathname)).toEqual([
      '/api/users/0/collections',
      '/api/users/0/collections/COLL1234/items/top',
      '/api/users/0/collections/COLL1234',
      '/api/users/0/collections/COLL1234/items/top',
    ])
  })

  it('rejects a "||"-containing tag with a typed argument error', async () => {
    const result = await runTool('zotero_search', { query: 'x', tags: ['reviewed', 'a||b'] })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain('literal tag names')
    expect(mock.requests).toEqual([])
  })

  it('rejects a limit above the configured maximum', async () => {
    const result = await runTool('zotero_search', { query: 'x', limit: 21 })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain('limit must be an integer between 1 and 20')
  })

  it('rejects an empty scope refOrName and malformed item types', async () => {
    const emptyScope = await runTool('zotero_search', { scope: { kind: 'collection', refOrName: '  ' } })
    expect(emptyScope.isError).toBe(true)
    if (!emptyScope.isError) throw new Error('unreachable')
    expect((emptyScope.content[0] as { text: string }).text).toContain('scope.refOrName')

    const badType = await runTool('zotero_search', { itemTypes: ['-attachment'] })
    expect(badType.isError).toBe(true)
    if (!badType.isError) throw new Error('unreachable')
    expect((badType.content[0] as { text: string }).text).toContain('itemTypes')
  })

  it('announces further pages in the rendered output', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '25' })
    ))
    const result = await runTool('zotero_search', { limit: 5 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain('More results available: search again with offset 1')
  })

  it('declares itself concurrency-safe', () => {
    const definition = ctx.tools.get('zotero_search')!
    expect(definition.isConcurrencySafe?.({})).toBe(true)
  })

  it('passes valid item types through and marks PDF attachments in the render', async () => {
    const withPdf = {
      ...ITEM,
      links: {
        self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
        attachment: { href: 'http://localhost:23119/api/users/0/items/WXYZ6789', type: 'application/json', attachmentType: 'application/pdf' },
      },
    }
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([withPdf], { 'Total-Results': '1' }))
    const result = await runTool('zotero_search', { itemTypes: ['journalArticle', 'conferencePaper'], query: 'x' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(mock.requests[0]!.search.get('itemType')).toBe('journalArticle || conferencePaper')
    expect((result.content[0] as { text: string }).text).toContain(' — PDF')
  })

  it('treats whitespace-only queries as omitted and rejects zero limits and blank tags', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([], { 'Total-Results': '0' }))
    const blankQuery = await runTool('zotero_search', { query: '   ' })
    expect(blankQuery.isError).toBe(false)
    expect(mock.requests[0]!.search.has('q')).toBe(false)

    const zeroLimit = await runTool('zotero_search', { limit: 0 })
    expect(zeroLimit.isError).toBe(true)
    if (!zeroLimit.isError) throw new Error('unreachable')
    expect((zeroLimit.content[0] as { text: string }).text).toContain('limit must be an integer between 1 and 20')

    const negativeOffset = await runTool('zotero_search', { offset: -1 })
    expect(negativeOffset.isError).toBe(true)
    if (!negativeOffset.isError) throw new Error('unreachable')
    expect((negativeOffset.content[0] as { text: string }).text).toContain('offset must be a non-negative integer')

    const blankTag = await runTool('zotero_search', { tags: ['   '] })
    expect(blankTag.isError).toBe(true)
    if (!blankTag.isError) throw new Error('unreachable')
    expect((blankTag.content[0] as { text: string }).text).toContain('literal tag names')
  })

  it('renders missing years and creators without decoration', async () => {
    const bare = {
      ...ITEM,
      meta: {},
      data: { ...ITEM.data, creators: [] },
    }
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([bare], { 'Total-Results': '1' }))
    const result = await runTool('zotero_search', { query: 'x' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe(
      'Found 1 of 1 results:\n1. zotero://user/0/item/ABCD1234 — FlashAttention-2 [conferencePaper]',
    )
  })
})
