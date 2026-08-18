import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolResult,
} from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import { ZOTERO_NOT_RUNNING } from '../src/errors.js'
import { renderGet } from '../src/tools/get.js'
import { renderRetrieve } from '../src/tools/retrieve.js'
import { renderSearch } from '../src/tools/search.js'
import { MockZotero } from './helpers/mock-zotero.js'
import { CHILD_ROWS, ITEM } from './helpers/fixtures.js'

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

describe('zotero_search tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    const definition = ctx.tools.get('zotero_search')
    expect(definition).toBeDefined()
    expect(ctx.tools.schemas().some((schema) => schema.name === 'zotero_search')).toBe(true)
  })

  it('executes a library search and renders a compact list', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const result = await runTool('zotero_search', { query: 'flash attention', limit: 5 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(result.value).toEqual({
      scope: { kind: 'library' },
      items: [
        {
          ref: 'zotero://user/0/item/ABCD1234?server=S1',
          title: 'FlashAttention-2',
          creatorSummary: 'Dao, Tri',
          year: 2023,
          itemType: 'conferencePaper',
          bestAttachmentRef: undefined,
          bestAttachmentType: undefined,
          attachmentSize: undefined,
        },
      ],
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

  it('renders the merged-note notice only when noteMatches is present and positive', () => {
    const value = {
      scope: { kind: 'library' as const },
      items: [],
      total: 42,
      offset: 0,
      returned: 2,
      noteMatches: 2,
    }
    const withNotes = renderSearch({}, value)
    expect((withNotes[0] as { text: string }).text).toContain(
      '2 of the listed hits came from the client-side note-body scan',
    )
    const withoutNotes = renderSearch({}, { ...value, noteMatches: undefined })
    expect((withoutNotes[0] as { text: string }).text).not.toContain('note-body scan')
    const zeroNotes = renderSearch({}, { ...value, noteMatches: 0 })
    expect((zeroNotes[0] as { text: string }).text).not.toContain('note-body scan')
  })

  it('chains a resolved scope ref into the next page without re-resolving names', async () => {
    const collection = {
      key: 'COLL1234',
      version: 1,
      data: { key: 'COLL1234', version: 1, name: 'LLM Papers' },
    }
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([collection], { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(collection, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const first = await runTool('zotero_search', {
      scope: { kind: 'collection', refOrName: 'LLM Papers' },
    })
    expect(first.isError).toBe(false)
    if (first.isError) throw new Error('unreachable')
    const scope = (first.value as { scope: { kind: string; ref: string } }).scope
    expect(scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'LLM Papers',
    })
    await runTool('zotero_search', {
      scope: { kind: 'collection', refOrName: scope.ref },
      offset: 10,
    })
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
    expect((result.content[0] as { text: string }).text).toContain(
      'limit must be an integer between 1 and 20',
    )
  })

  it('rejects an empty scope refOrName and malformed item types', async () => {
    const emptyScope = await runTool('zotero_search', {
      scope: { kind: 'collection', refOrName: '  ' },
    })
    expect(emptyScope.isError).toBe(true)
    if (!emptyScope.isError) throw new Error('unreachable')
    expect((emptyScope.content[0] as { text: string }).text).toContain('scope.refOrName')

    const badType = await runTool('zotero_search', { itemTypes: ['-attachment'] })
    expect(badType.isError).toBe(true)
    if (!badType.isError) throw new Error('unreachable')
    expect((badType.content[0] as { text: string }).text).toContain('itemTypes')
  })

  it('announces further pages in the rendered output', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '25' }),
    )
    const result = await runTool('zotero_search', { limit: 5 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      'More results available: search again with offset 1',
    )
  })

  it('declares itself concurrency-safe', () => {
    const definition = ctx.tools.get('zotero_search')!
    expect(definition.isConcurrencySafe?.({})).toBe(true)
  })

  it('passes valid item types through and marks PDF attachments in the render', async () => {
    const withPdf = {
      ...ITEM,
      links: {
        self: {
          href: 'http://localhost:23119/api/users/0/items/ABCD1234',
          type: 'application/json',
        },
        attachment: {
          href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
          type: 'application/json',
          attachmentType: 'application/pdf',
        },
      },
    }
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([withPdf], { 'Total-Results': '1' }),
    )
    const result = await runTool('zotero_search', {
      itemTypes: ['journalArticle', 'conferencePaper'],
      query: 'x',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(mock.requests[0]!.search.get('itemType')).toBe('journalArticle || conferencePaper')
    expect((result.content[0] as { text: string }).text).toContain(' — PDF')
  })

  it('treats whitespace-only queries as omitted and rejects zero limits and blank tags', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
    const blankQuery = await runTool('zotero_search', { query: '   ' })
    expect(blankQuery.isError).toBe(false)
    expect(mock.requests[0]!.search.has('q')).toBe(false)

    const zeroLimit = await runTool('zotero_search', { limit: 0 })
    expect(zeroLimit.isError).toBe(true)
    if (!zeroLimit.isError) throw new Error('unreachable')
    expect((zeroLimit.content[0] as { text: string }).text).toContain(
      'limit must be an integer between 1 and 20',
    )

    const negativeOffset = await runTool('zotero_search', { offset: -1 })
    expect(negativeOffset.isError).toBe(true)
    if (!negativeOffset.isError) throw new Error('unreachable')
    expect((negativeOffset.content[0] as { text: string }).text).toContain(
      'offset must be a non-negative integer',
    )

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
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([bare], { 'Total-Results': '1' }),
    )
    const result = await runTool('zotero_search', { query: 'x' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe(
      'Found 1 of 1 results:\n1. zotero://user/0/item/ABCD1234 — FlashAttention-2 [conferencePaper]',
    )
  })
})

const GET_PARENT = {
  key: 'ABCD1234',
  version: 3,
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
    attachment: {
      href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
      type: 'application/json',
      attachmentType: 'application/pdf',
    },
  },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    publicationTitle: 'ICML',
    DOI: '10.1234/fa2',
    url: 'https://arxiv.org/abs/2307.08691',
    abstractNote: 'FlashAttention is fast.',
    tags: [{ tag: 'attention' }, { tag: 'efficient' }],
    collections: ['COLL1234', 'COLL9999'],
  },
}

describe('zotero_get tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    expect(ctx.tools.get('zotero_get')).toBeDefined()
    expect(ctx.tools.schemas().some((schema) => schema.name === 'zotero_get')).toBe(true)
  })

  it('reads metadata with a single request by default', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        {
          ...GET_PARENT,
          links: { self: GET_PARENT.links.self },
          data: { ...GET_PARENT.data, collections: [] },
        },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    const result = await runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(mock.requests.map((request) => request.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
    ])
    expect(result.value).toMatchObject({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      title: 'FlashAttention-2',
      year: 2023,
      collections: [],
      children: { total: 3 },
    })
    expect(result.content[0]?.type).toBe('text')
    expect((result.content[0] as { text: string }).text).toBe(
      [
        'zotero://user/0/item/ABCD1234?server=S1 — FlashAttention-2 (2023) [journalArticle]',
        'Creators: Tri Dao',
        'ICML · 2023-07-28 · DOI: 10.1234/fa2',
        'URL: https://arxiv.org/abs/2307.08691',
        'Tags: attention, efficient',
        'Abstract: FlashAttention is fast.',
        'Children: 3 total',
      ].join('\n'),
    )
  })

  it('renders a bare item without decorations', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        data: { itemType: 'journalArticle', title: 'Bare' },
      }),
    )
    const result = await runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe(
      'zotero://user/0/item/ABCD1234 — Bare [journalArticle]\nChildren: 0 total',
    )
  })

  it('includes children and collection names on request', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(GET_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(CHILD_ROWS),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([
        { key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } },
      ]),
    )
    const result = await runTool('zotero_get', {
      ref: 'zotero://user/0/item/ABCD1234',
      include: ['notes', 'annotations', 'attachments'],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(mock.requests.map((request) => request.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/collections',
    ])
    const value = result.value as {
      collections: { ref: string; name?: string }[]
      notes: { returned: number }
      annotations: { returned: number }
      attachments: { returned: number }
      bestAttachment: { title: string; contentType: string }
    }
    expect(value.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' },
      { ref: 'zotero://user/0/collection/COLL9999?server=S1' },
    ])
    expect(value.notes.returned).toBe(1)
    expect(value.annotations.returned).toBe(1)
    expect(value.attachments.returned).toBe(1)
    expect(value.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(
      'Children: 3 total (1 of 1 notes; 1 of 1 annotations; 1 of 1 attachments)',
    )
    expect(text).toContain('Collections: LLM Papers, zotero://user/0/collection/COLL9999?server=S1')
    expect(text).toContain(
      'Best attachment: zotero://user/0/attachment/WXYZ6789?server=S1 (application/pdf)',
    )
  })

  it('flags truncated abstracts and attachment content types without a label', async () => {
    const longAbstract = 'a'.repeat(3001)
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        ...GET_PARENT,
        links: {
          attachment: {
            href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
            type: 'application/json',
          },
        },
        data: {
          ...GET_PARENT.data,
          collections: [],
          creators: [],
          abstractNote: longAbstract,
          publicationTitle: '',
          DOI: '',
          url: '',
          date: '',
          tags: [],
        },
      }),
    )
    const result = await runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Abstract (truncated): ')
    expect(text).toContain('Best attachment: zotero://user/0/attachment/WXYZ6789 (unknown type)')
    expect(text).not.toContain('Creators:')
    expect(text).not.toContain('Tags:')
    expect(text).not.toContain('URL:')
  })

  it('rejects malformed and wrong-kind refs before any request', async () => {
    const malformed = await runTool('zotero_get', { ref: 'ABCD1234' })
    expect(malformed.isError).toBe(true)
    if (!malformed.isError) throw new Error('unreachable')
    expect((malformed.content[0] as { text: string }).text).toContain('Invalid Zotero reference')

    const wrongKind = await runTool('zotero_get', { ref: 'zotero://user/0/collection/COLL1234' })
    expect(wrongKind.isError).toBe(true)
    if (!wrongKind.isError) throw new Error('unreachable')
    expect((wrongKind.content[0] as { text: string }).text).toContain('Expected a item reference')

    expect(mock.requests).toEqual([])
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      ctx.tools.get('zotero_get')!.isConcurrencySafe?.({ ref: 'zotero://user/0/item/ABCD1234' }),
    ).toBe(true)
  })
})

describe('zotero_attachment tool', () => {
  const FILE_ATTACHMENT = {
    key: 'WXYZ6789',
    version: 1,
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  }

  it('registers and exposes its schema to the assembly', () => {
    expect(ctx.tools.get('zotero_attachment')).toBeDefined()
    expect(ctx.tools.schemas().some((schema) => schema.name === 'zotero_attachment')).toBe(true)
  })

  it('resolves a file attachment to a verified on-disk path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
    try {
      const filePath = join(dir, 'paper.pdf')
      writeFileSync(filePath, '%PDF stub')
      mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
        helpers.json(FILE_ATTACHMENT),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
        helpers.text(pathToFileURL(filePath).href),
      )
      const result = await runTool('zotero_attachment', {
        ref: 'zotero://user/0/attachment/WXYZ6789',
      })
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('unreachable')
      expect(result.value).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
        kind: 'file',
        path: filePath,
      })
      expect((result.content[0] as { text: string }).text).toBe(
        `Full Text PDF (zotero://user/0/attachment/WXYZ6789) application/pdf → ${filePath}`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves an item ref to its best attachment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
    try {
      const filePath = join(dir, 'paper.pdf')
      writeFileSync(filePath, '%PDF stub')
      mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
        helpers.json({
          key: 'ABCD1234',
          version: 3,
          links: {
            attachment: {
              href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
              type: 'application/json',
              attachmentType: 'application/pdf',
            },
          },
          data: { itemType: 'journalArticle', title: 'FlashAttention-2' },
        }),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
        helpers.json(FILE_ATTACHMENT),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
        helpers.text(pathToFileURL(filePath).href),
      )
      const result = await runTool('zotero_attachment', { ref: 'zotero://user/0/item/ABCD1234' })
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('unreachable')
      expect(mock.requests.map((request) => request.pathname)).toEqual([
        '/api/users/0/items/ABCD1234',
        '/api/users/0/items/WXYZ6789',
        '/api/users/0/items/WXYZ6789/file/view/url',
      ])
      expect(result.value).toEqual({
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'Full Text PDF',
        contentType: 'application/pdf',
        kind: 'file',
        path: filePath,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves linked-URL attachments without a file request', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: {
          itemType: 'attachment',
          title: 'Preprint',
          contentType: 'application/pdf',
          linkMode: 'linked_url',
          url: 'https://arxiv.org/pdf/2307.08691',
        },
      }),
    )
    const result = await runTool('zotero_attachment', {
      ref: 'zotero://user/0/attachment/WXYZ6789',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(mock.requests).toHaveLength(1)
    expect(result.value).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: 'Preprint',
      contentType: 'application/pdf',
      kind: 'url',
      url: 'https://arxiv.org/pdf/2307.08691',
    })
    expect((result.content[0] as { text: string }).text).toBe(
      'Preprint (zotero://user/0/attachment/WXYZ6789) application/pdf → https://arxiv.org/pdf/2307.08691',
    )
  })

  it('renders untitled attachments by ref with an unknown-type label', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: { itemType: 'attachment', linkMode: 'linked_url', url: 'https://example.com/doc' },
      }),
    )
    const result = await runTool('zotero_attachment', {
      ref: 'zotero://user/0/attachment/WXYZ6789',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe(
      'zotero://user/0/attachment/WXYZ6789 unknown type → https://example.com/doc',
    )
  })

  it('surfaces a missing file as a typed error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
    try {
      mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
        helpers.json(FILE_ATTACHMENT),
      )
      mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
        helpers.text(pathToFileURL(join(dir, 'gone.pdf')).href),
      )
      const result = await runTool('zotero_attachment', {
        ref: 'zotero://user/0/attachment/WXYZ6789',
      })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toContain('missing from disk')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects malformed and wrong-kind refs before any request', async () => {
    const malformed = await runTool('zotero_attachment', { ref: 'not-a-ref' })
    expect(malformed.isError).toBe(true)
    if (!malformed.isError) throw new Error('unreachable')
    expect((malformed.content[0] as { text: string }).text).toContain('Invalid Zotero reference')

    const wrongKind = await runTool('zotero_attachment', {
      ref: 'zotero://user/0/collection/COLL1234',
    })
    expect(wrongKind.isError).toBe(true)
    if (!wrongKind.isError) throw new Error('unreachable')
    expect((wrongKind.content[0] as { text: string }).text).toContain(
      'Expected a item or attachment reference',
    )

    expect(mock.requests).toEqual([])
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      ctx.tools
        .get('zotero_attachment')!
        .isConcurrencySafe?.({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
    ).toBe(true)
  })
})

const RETRIEVE_PARENT = {
  key: 'ABCD1234',
  version: 3,
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
    attachment: {
      href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
      type: 'application/json',
      attachmentType: 'application/pdf',
    },
  },
  meta: { parsedDate: '2023-07-28', numChildren: 1 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    abstractNote: 'FlashAttention speeds up transformer training.',
    collections: [],
  },
}

const RETRIEVE_CHILDREN = [
  {
    key: 'ANNO1111',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'flash attention avoids materializing the matrix',
      annotationSortIndex: '00001',
    },
  },
  {
    key: 'WXYZ6789',
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  },
]

describe('zotero_retrieve tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    expect(ctx.tools.get('zotero_retrieve')).toBeDefined()
    expect(ctx.tools.schemas().some((schema) => schema.name === 'zotero_retrieve')).toBe(true)
  })

  it('returns ranked evidence and coverage', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({
        content: 'Flash attention is fast. Attention is all you need.',
        indexedChars: 100,
        totalChars: 100,
      }),
    )
    const result = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'flash attention',
      passages: 3,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    const value = result.value as {
      evidence: { source: string; text: string }[]
      coverage: { complete: boolean }
      truncated: boolean
    }
    expect(value.evidence.length).toBeGreaterThan(0)
    expect(value.coverage.complete).toBe(true)
    expect(value.truncated).toBe(false)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('zotero://user/0/item/ABCD1234?server=S1')
    expect(text).toContain('fulltext')
  })

  it('rejects empty queries and out-of-range passage counts before any request', async () => {
    const empty = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: '   ',
    })
    expect(empty.isError).toBe(true)
    if (!empty.isError) throw new Error('unreachable')
    expect((empty.content[0] as { text: string }).text).toContain('query')

    const tooMany = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      passages: 5,
    })
    expect(tooMany.isError).toBe(true)
    if (!tooMany.isError) throw new Error('unreachable')
    expect((tooMany.content[0] as { text: string }).text).toContain('passages')

    expect(mock.requests).toEqual([])
  })

  it('rejects an empty sources list', async () => {
    const result = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      sources: [],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain('sources must list')
    expect(mock.requests).toEqual([])
  })

  it('rejects malformed refs before any request', async () => {
    const result = await runTool('zotero_retrieve', { ref: 'nope', query: 'x' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain('Invalid Zotero reference')
    expect(mock.requests).toEqual([])
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      ctx.tools
        .get('zotero_retrieve')!
        .isConcurrencySafe?.({ ref: 'zotero://user/0/item/ABCD1234', query: 'x' }),
    ).toBe(true)
  })
})

describe('zotero_retrieve render', () => {
  function render(value: never): string {
    return (renderRetrieve({} as never, value)[0] as { text: string }).text
  }

  it('renders a minimal single abstract passage', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        { source: 'abstract', sourceRef: 'zotero://user/0/item/ABCD1234', text: 'abstract text' },
      ],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(text).toBe(
      [
        'Evidence for zotero://user/0/item/ABCD1234 (1 passage)',
        '',
        '[abstract] zotero://user/0/item/ABCD1234',
        'abstract text',
      ].join('\n'),
    )
  })

  it('renders coverage with chars, pages, unknown totals, and completeness', () => {
    const charsOnly = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 10, totalChars: 12, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(charsOnly).toContain('Indexing coverage: 10/12 chars')

    const pagesOnly = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedPages: 2, totalPages: 9, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(pagesOnly).toContain('Indexing coverage: , 2/9 pages')

    const unknownTotals = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 5, indexedPages: 3, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(unknownTotals).toContain('Indexing coverage: 5/? chars, 3/? pages')

    const complete = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 5, totalChars: 5, complete: true },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(complete).toContain('(complete)')
  })

  it('renders annotation page labels and comments', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        {
          source: 'annotation',
          sourceRef: 'zotero://user/0/item/ANNO1111',
          text: 'insight',
          comment: 'double-check',
          pageLabel: '7',
        },
      ],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(text).toContain('[annotation (page 7)] zotero://user/0/item/ANNO1111')
    expect(text).toContain('Comment: double-check')
  })

  it('renders chunk locators and skipped sources', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        {
          source: 'note',
          sourceRef: 'zotero://user/0/item/NOTE1111',
          text: 'later chunk',
          chunkIndex: 2,
          chunkCount: 3,
        },
      ],
      truncated: false,
      sourcesSkipped: ['fulltext'],
    } as never)
    expect(text).toContain('[note, chunk 3/3] zotero://user/0/item/NOTE1111')
    expect(text).toContain('Skipped unavailable sources: fulltext')
  })

  it('announces omitted evidence and the fulltext attachment', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      evidence: [],
      truncated: true,
      sourcesSkipped: [],
    } as never)
    expect(text).toContain('Full text: zotero://user/0/attachment/WXYZ6789')
    expect(text).toContain(
      'More evidence was available but omitted by the passage or character budget.',
    )
    expect(text).toContain('(0 passages)')
  })
})

describe('zotero_get render', () => {
  function render(value: never): string {
    return (renderGet({} as never, value)[0] as { text: string }).text
  }

  it('renders the note body with a truncation marker for note items', () => {
    const truncated = render({
      ref: 'zotero://user/0/item/NOTE1111',
      itemType: 'note',
      title: '',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      noteBody: { text: 'first line of the note', truncated: true },
    } as never)
    expect(truncated).toContain('Note (truncated): first line of the note')

    const full = render({
      ref: 'zotero://user/0/item/NOTE2222',
      itemType: 'note',
      title: '',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      noteBody: { text: 'short note', truncated: false },
    } as never)
    expect(full).toContain('Note: short note')
  })
})

describe('zotero_export tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    expect(ctx.tools.get('zotero_export')).toBeDefined()
    expect(ctx.tools.schemas().some((schema) => schema.name === 'zotero_export')).toBe(true)
  })

  it('exports paired citations ordered as requested', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'BBBB1234', citation: '<span>B, 2021</span>' },
        { key: 'ABCD1234', citation: '<span>A, 2023</span>' },
      ]),
    )
    const result = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234', 'zotero://user/0/item/BBBB1234'],
      format: 'citation',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(result.value).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '<span>A, 2023</span>' },
        { ref: 'zotero://user/0/item/BBBB1234', text: '<span>B, 2021</span>' },
      ],
    })
    expect((result.content[0] as { text: string }).text).toBe(
      [
        'zotero://user/0/item/ABCD1234: <span>A, 2023</span>',
        'zotero://user/0/item/BBBB1234: <span>B, 2021</span>',
      ].join('\n'),
    )
  })

  it('passes explicit style and locale through to the export', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ key: 'ABCD1234', citation: 'x' }]),
    )
    const result = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation',
      style: 'chicago-note-bibliography',
      locale: 'de-DE',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(mock.requests[0]!.search.get('style')).toBe('chicago-note-bibliography')
    expect(mock.requests[0]!.search.get('locale')).toBe('de-DE')
    expect(result.value).toEqual({
      format: 'citation',
      style: 'chicago-note-bibliography',
      locale: 'de-DE',
      citations: [{ ref: 'zotero://user/0/item/ABCD1234', text: 'x' }],
    })
  })

  it('renders opaque bibliography text verbatim', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('entry-a\nentry-b'))
    const result = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'bibliography',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toBe('entry-a\nentry-b')
  })

  it('itemizes each translator document with its batch citation key and title', async () => {
    const batchText =
      '@article{batchPan2022,\n  title = {Carbon price forecasting},\n}\n\n' +
      '@article{batchZheng2025,\n  title = {Insight into heterogeneous risks},\n}\n'
    const secondStart = batchText.indexOf('@article{batchZheng2025,')
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(batchText)
        return
      }
      // The single-item context generates different citation keys; the
      // mapping pairs the entries by content regardless.
      helpers.text(
        keys[0] === 'ABCD1234'
          ? '@article{singlePan2022,\n  title = {Carbon price forecasting},\n}\n'
          : '@article{singleZheng2025,\n  title = {Insight into heterogeneous risks},\n}\n',
      )
    })
    const result = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234', 'zotero://user/0/item/BBBB1234'],
      format: 'bibtex',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(result.value).toEqual({
      format: 'bibtex',
      text: batchText,
      items: [
        {
          ref: 'zotero://user/0/item/ABCD1234',
          key: 'batchPan2022',
          title: 'Carbon price forecasting',
          start: 0,
          end: secondStart,
        },
        {
          ref: 'zotero://user/0/item/BBBB1234',
          key: 'batchZheng2025',
          title: 'Insight into heterogeneous risks',
          start: secondStart,
          end: batchText.length,
        },
      ],
    })
    // The model-visible render stays the merged body, not the itemization.
    expect((result.content[0] as { text: string }).text).toBe(batchText)
  })

  it('rejects empty ref lists, malformed refs, and blank styles before any request', async () => {
    const empty = await runTool('zotero_export', { refs: [], format: 'bibtex' })
    expect(empty.isError).toBe(true)
    if (!empty.isError) throw new Error('unreachable')
    expect((empty.content[0] as { text: string }).text).toContain('refs')

    const malformed = await runTool('zotero_export', { refs: ['nope'], format: 'bibtex' })
    expect(malformed.isError).toBe(true)
    if (!malformed.isError) throw new Error('unreachable')
    expect((malformed.content[0] as { text: string }).text).toContain('Invalid Zotero reference')

    const blankStyle = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation',
      style: '  ',
    })
    expect(blankStyle.isError).toBe(true)
    if (!blankStyle.isError) throw new Error('unreachable')
    expect((blankStyle.content[0] as { text: string }).text).toContain('style')

    const blankLocale = await runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation',
      locale: '  ',
    })
    expect(blankLocale.isError).toBe(true)
    if (!blankLocale.isError) throw new Error('unreachable')
    expect((blankLocale.content[0] as { text: string }).text).toContain('locale')

    expect(mock.requests).toEqual([])
  })

  it('rejects ref lists above the configured export cap before any request', async () => {
    const refs = Array.from(
      { length: 1001 },
      (_, i) => `zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`,
    )
    const result = await runTool('zotero_export', { refs, format: 'bibtex' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain('export in batches')
    expect(mock.requests).toEqual([])
  })

  it('accepts exactly the capped ref count', async () => {
    const refs = Array.from(
      { length: 50 },
      (_, i) => `zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`,
    )
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.json((search.get('itemKey') ?? '').split(',').map((key) => ({ key, citation: 'x' }))),
    )
    const result = await runTool('zotero_export', { refs, format: 'citation' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect((result.value as { citations: unknown[] }).citations).toHaveLength(50)
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      ctx.tools
        .get('zotero_export')!
        .isConcurrencySafe?.({ refs: ['zotero://user/0/item/ABCD1234'], format: 'bibtex' }),
    ).toBe(true)
  })
})

describe('tool presentation', () => {
  function definition(name: string): ToolDefinition {
    const tool = ctx.tools.get(name)
    if (tool === undefined) throw new Error(`tool ${name} not registered`)
    return tool
  }

  it('declares a pending card for every tool', () => {
    expect(
      definition('zotero_search').presentCall!({ query: 'attention', scope: { kind: 'library' } }),
    ).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'Search Zotero library',
      rawInput: 'attention',
    })
    expect(definition('zotero_search').presentCall!({})).toMatchObject({ rawInput: '(browse)' })
    expect(definition('zotero_get').presentCall!({ ref: 'zotero://user/0/item/ABCD1234' })).toEqual(
      {
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero item',
        rawInput: 'zotero://user/0/item/ABCD1234',
      },
    )
    expect(
      definition('zotero_attachment').presentCall!({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
    ).toEqual({
      card: 'generic',
      kind: 'read',
      title: 'Resolve Zotero attachment',
      rawInput: 'zotero://user/0/attachment/WXYZ6789',
    })
    expect(
      definition('zotero_retrieve').presentCall!({
        ref: 'zotero://user/0/item/ABCD1234',
        query: 'tiling',
      }),
    ).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'Retrieve Zotero evidence',
      rawInput: 'tiling',
    })
    expect(
      definition('zotero_export').presentCall!({
        refs: ['zotero://user/0/item/ABCD1234'],
        format: 'bibliography',
      }),
    ).toEqual({
      card: 'generic',
      title: 'Export Zotero citations',
      rawInput: '1 refs · bibliography',
    })
  })

  it('projects replayable search page facts and renders the completed card', () => {
    const tool = definition('zotero_search')
    const value = {
      scope: { kind: 'library' as const },
      items: [],
      total: 42,
      offset: 0,
      returned: 10,
      nextOffset: 10,
    }
    expect(tool.output.presentationMeta!({}, value)).toEqual({
      returned: 10,
      total: 42,
      nextOffset: 10,
      displayed: 0,
      omitted: 10,
      noteMatches: null,
      items: [],
    })
    // A final page omits nextOffset; the projector records it as null so the
    // projection stays lossless JSON.
    expect(
      tool.output.presentationMeta!(
        {},
        { scope: { kind: 'library' }, items: [], total: 42, offset: 0, returned: 10 },
      ),
    ).toEqual({
      returned: 10,
      total: 42,
      nextOffset: null,
      displayed: 0,
      omitted: 10,
      noteMatches: null,
      items: [],
    })
    const result: ToolResult = {
      content: [{ type: 'text', text: 'x' }],
      isError: false,
      meta: { returned: 10, total: 42, nextOffset: null },
    }
    expect(tool.presentResult!({}, result)).toEqual({
      card: 'generic',
      title: 'Zotero search: found 10 of 42 results',
    })
  })

  it('falls back to the generic card on failed calls and absent metadata', () => {
    const tool = definition('zotero_search')
    expect(
      tool.presentResult!(
        {},
        {
          content: [{ type: 'text', text: 'Error: x' }],
          isError: true,
          meta: { returned: 1, total: 1, nextOffset: null },
        },
      ),
    ).toBeUndefined()
    expect(
      tool.presentResult!({}, { content: [{ type: 'text', text: 'x' }], isError: false }),
    ).toBeUndefined()
    expect(
      tool.presentResult!(
        {},
        { content: [{ type: 'text', text: 'x' }], isError: false, meta: 'junk' },
      ),
    ).toBeUndefined()
    expect(
      tool.presentResult!(
        {},
        {
          content: [{ type: 'text', text: 'x' }],
          isError: false,
          meta: { returned: 'x', total: 42 },
        },
      ),
    ).toBeUndefined()
  })
})

describe('connectivity failure ask', () => {
  it('asks the user once and retries the request when Zotero is unreachable', async () => {
    const down = await MockZotero.start()
    const downUrl = down.baseUrl
    await down.close()

    const askCtx = new Context()
    await askCtx.plugin(SystemPrompt, {})
    await askCtx.plugin(ToolRuntime, {})
    await askCtx.plugin(UserQuestionService)
    const questions = askCtx.get('userQuestions')!
    const asked: unknown[] = []
    questions.registerProvider({
      ask: async (request) => {
        asked.push(request)
        return {
          answers: [{ id: 'zotero-failure', selected: ['I started Zotero, retry (Recommended)'] }],
        }
      },
    })
    await askCtx.plugin(ZoteroService, { baseUrl: downUrl })

    const result = await askCtx.tools.execute({
      callId: CallId('tool-ask-connectivity'),
      name: 'zotero_search',
      arguments: { query: 'flash attention', limit: 5 },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    // The retry hit the same unreachable instance and surfaced the typed
    // error; the user was asked exactly once, never looped.
    expect((result.content[0] as { text: string }).text).toContain('not running')
    expect(asked).toHaveLength(1)
    const request = asked[0] as { questions: { id: string; options: { label: string }[] }[] }
    expect(request.questions[0]!.id).toBe('zotero-failure')
    expect(request.questions[0]!.options![0]!.label).toBe('I started Zotero, retry (Recommended)')
  })
})
