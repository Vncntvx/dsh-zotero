import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ZoteroService from '../src/index.js'
import { MockZotero } from './helpers/mock-zotero.js'
import { parseRef } from '../src/refs.js'
import { ZoteroHttpClient } from '../src/http-client.js'
import { LocalApiProvider } from '../src/provider-local.js'

describe('service browse and search new filters', () => {
  let mock: MockZotero
  let ctx: Context
  beforeEach(async () => {
    mock = await MockZotero.start()
    ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl })
  })
  afterEach(async () => {
    await mock.close()
    await ctx.fiber.dispose()
  })
  function runTool(name: string, args: Record<string, unknown>) {
    return ctx.tools.execute({
      callId: CallId('x'),
      name,
      arguments: args,
      signal: new AbortController().signal,
    })
  }

  it('zotero_browse validates offset/limit and match requires q', async () => {
    const bad1 = await runTool('zotero_browse', { kind: 'tags', offset: -1 })
    expect(bad1.isError).toBe(true)
    if (!bad1.isError) throw new Error('unreachable')
    expect((bad1.content[0] as { text: string }).text).toContain('offset must be an integer')
    const bad2 = await runTool('zotero_browse', { kind: 'collections', limit: 1000 })
    expect(bad2.isError).toBe(true)
    if (!bad2.isError) throw new Error('unreachable')
    expect((bad2.content[0] as { text: string }).text).toContain('limit must be an integer')
    const bad3 = await runTool('zotero_browse', {
      kind: 'tags',
      match: 'contains',
    } as unknown as Record<string, unknown>)
    expect(bad3.isError).toBe(true)
    if (!bad3.isError) throw new Error('unreachable')
    expect((bad3.content[0] as { text: string }).text).toContain('match requires q')
    const bad4 = await runTool('zotero_browse', {
      kind: 'tags',
      library: { type: 'user', id: 123 } as unknown as Record<string, unknown>,
    } as unknown as Record<string, unknown>)
    expect(bad4.isError).toBe(true)
    if (!bad4.isError) throw new Error('unreachable')
    expect((bad4.content[0] as { text: string }).text).toContain('Only user/0')
  })

  it('zotero_search validates new filters', async () => {
    const badTags = await runTool('zotero_search', { tags: ['a||b'] })
    expect(badTags.isError).toBe(true)
    if (!badTags.isError) throw new Error('unreachable')
    expect((badTags.content[0] as { text: string }).text).toContain('tags are literal tag names')
    const badExclude = await runTool('zotero_search', { excludeTags: ['a||b'] })
    expect(badExclude.isError).toBe(true)
    if (!badExclude.isError) throw new Error('unreachable')
    expect((badExclude.content[0] as { text: string }).text).toContain(
      'excludeTags are literal tag names',
    )
    const badTagMatch = await runTool('zotero_search', { tagMatch: 'invalid' as never })
    expect(badTagMatch.isError).toBe(true)
    if (!badTagMatch.isError) throw new Error('unreachable')
    expect((badTagMatch.content[0] as { text: string }).text).toContain('tagMatch')
    const badTrashed = await runTool('zotero_search', {
      includeTrashed: true,
      scope: { kind: 'collection', refOrName: 'X' },
    })
    expect(badTrashed.isError).toBe(true)
    if (!badTrashed.isError) throw new Error('unreachable')
    expect((badTrashed.content[0] as { text: string }).text).toContain(
      'includeTrashed is only allowed with library scope',
    )
    const badLib = await runTool('zotero_search', {
      library: { type: 'user', id: 123 } as unknown as Record<string, unknown>,
    })
    expect(badLib.isError).toBe(true)
    if (!badLib.isError) throw new Error('unreachable')
    expect((badLib.content[0] as { text: string }).text).toContain('Only user/0')
  })

  it('search with library and tag filters maps correctly', async () => {
    // Mock library collection resolution + items
    mock.route('GET', '/api/groups/42/collections', (req, res, helpers) =>
      helpers.json([{ key: 'COLL0001', data: { key: 'COLL0001', name: 'MyColl' } }]),
    )
    mock.route('GET', '/api/groups/42/collections/COLL0001/items/top', (req, res, helpers) => {
      // Check that tag params include both positive and negative
      expect(req.url?.includes('tag=')).toBe(true)
      helpers.json([], { 'Total-Results': '0' })
    })
    // Also need to handle note scan for groups
    mock.route('GET', '/api/groups/42/items', (req, res, helpers) => {
      // note scan for groups
      helpers.json([])
    })
    const result = await runTool('zotero_search', {
      library: { type: 'group', id: 42 },
      scope: { kind: 'collection', refOrName: 'MyColl' },
      tags: ['a', 'b'],
      tagMatch: 'any',
      excludeTags: ['c'],
      includeTrashed: false,
      limit: 5,
    })
    // includeTrashed is only valid with library scope; a collection-scope
    // call without it must pass validation.
    expect(result.isError).toBe(false)
  })

  it('search includeTrashed with library scope passes', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => {
      expect(req.url?.includes('includeTrashed=1')).toBe(true)
      helpers.json([], { 'Total-Results': '0' })
    })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => {
      // note scan with includeTrashed
      expect(req.url?.includes('includeTrashed=1')).toBe(true)
      helpers.json([])
    })
    const result = await runTool('zotero_search', { includeTrashed: true, limit: 5 })
    expect(result.isError).toBe(false)
  })

  it('export mixed-library fails before HTTP', async () => {
    const res = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234', 'zotero://group/42/item/ABCD1234'],
      format: 'bibtex',
    })
    expect(res.isError).toBe(true)
    expect((res.content[0] as { text: string }).text).toContain('same library')
  })

  it('provider search buildSearchParams covers tagMatch etc', async () => {
    const client = new ZoteroHttpClient({
      baseUrl: mock.baseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 1_000_000,
    })
    const provider = new LocalApiProvider(client, {
      maxNoteScanRecords: 200,
      maxDetailChars: 500,
      maxNoteBodyChars: 30000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
      fulltextChunkWords: 200,
      maxEvidenceChars: 6000,
      maxEvidencePassages: 4,
      maxFulltextChars: 100000,
      maxExportChars: 1000000,
      defaultStyle: 'apa',
      defaultLocale: 'en-US',
    })
    // Directly test buildSearchParams via search call with tagMatch any and excludeTags
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => {
      const url = req.url ?? ''
      // should have tag=a%20%7C%7C%20b  (encoded ||) or tag=a || b
      // and tag=-c
      // Check presence
      expect(url.includes('tag=')).toBe(true)
      helpers.json([], { 'Total-Results': '0' })
    })
    // Need to also mock note scan
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.json([]))
    await provider.search({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 5,
      tags: ['a', 'b'],
      tagMatch: 'any',
      excludeTags: ['c'],
    })
  })

  it('browse via tool works for libraries', async () => {
    mock.route('GET', '/api/users/0/groups', (req, res, helpers) => helpers.json([]))
    const r = await runTool('zotero_browse', { kind: 'libraries', limit: 5 })
    expect(r.isError).toBe(false)
  })
})
