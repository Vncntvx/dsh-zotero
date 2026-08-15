import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZoteroHttpClient } from '../src/client.js'
import {
  ZOTERO_FILE_MISSING,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZoteroError,
} from '../src/errors.js'
import { buildSearchParams, encodeLiteralTag, LocalApiProvider } from '../src/provider-local.js'
import { parseRef } from '../src/refs.js'
import type { ZoteroGetRequest, ZoteroSearchRequest } from '../src/types.js'
import { MockZotero } from './helpers/mock-zotero.js'

let mock: MockZotero
let provider: LocalApiProvider
let tempDir: string

beforeEach(async () => {
  mock = await MockZotero.start()
  provider = new LocalApiProvider(new ZoteroHttpClient({ baseUrl: mock.baseUrl, timeoutMs: 5000, maxResponseBytes: 1024 * 1024 }), { maxDetailChars: 500 })
  tempDir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
})

afterEach(async () => {
  await mock.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function getRequest(include: ('notes' | 'annotations' | 'attachments')[] = []): ZoteroGetRequest {
  return { ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set(include) }
}

function request(overrides: Partial<ZoteroSearchRequest> = {}): ZoteroSearchRequest {
  return {
    scope: { kind: 'library' },
    mode: 'metadata',
    sort: 'dateModified',
    direction: 'desc',
    offset: 0,
    limit: 10,
    ...overrides,
  }
}

async function zoteroError(promise: Promise<unknown>, code: string, messagePart?: string): Promise<ZoteroError> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  const zotero = thrown as ZoteroError
  expect(zotero.code).toBe(code)
  if (messagePart !== undefined) expect(zotero.message).toContain(messagePart)
  return zotero
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
    const params = buildSearchParams(request({
      query: 'flash attention',
      itemTypes: ['journalArticle', 'conferencePaper'],
      tags: ['reviewed', '-draft'],
      sort: 'dateAdded',
      direction: 'asc',
      offset: 20,
      limit: 5,
    }))
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
})

describe('encodeLiteralTag', () => {
  it('escapes a leading dash so literal tags never negate', () => {
    expect(encodeLiteralTag('-draft')).toBe('\\-draft')
    expect(encodeLiteralTag('reviewed')).toBe('reviewed')
    expect(encodeLiteralTag('deep learning')).toBe('deep learning')
  })
})

describe('search: library scope', () => {
  it('searches /items/top with server-side pagination and a Total-Results header', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '25', 'Zotero-Server-ID': 'S1' })
    ))
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

  it('omits nextOffset on the final page and falls back to body length for total', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({ offset: 20, limit: 10 }))
    expect(result.total).toBe(1)
    expect(result.nextOffset).toBeUndefined()
  })

  it('falls back to body length when Total-Results is not a number', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json([ITEM], { 'Total-Results': 'garbage' }))
    const result = await provider.search(request({}))
    expect(result.total).toBe(1)
  })

  it('keeps the scope provenance when the items response omits the server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => (
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
    }))
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })
})

describe('search: collection scope', () => {
  it('resolves a collection name and searches its top-level items', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    ))
    const result = await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => (
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1' })
    ))
    const result = await provider.search(request({
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
    }))
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
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'llm papers' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'COLL1234',
    )
    expect(error.message).toContain('COLL5678')
  })

  it('fails with NOT_FOUND and near candidates when nothing matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'reason' } })),
      ZOTERO_NOT_FOUND,
      'Reasoning',
    )
    expect(error.message).toContain('"reason"')
  })

  it('fails with NOT_FOUND without candidates when nothing is even close', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'quantization' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('reports ambiguous saved searches with the saved-search wording', async () => {
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json([
      { key: 'SRCH1111', version: 1, data: { key: 'SRCH1111', version: 1, name: 'unread' } },
      { key: 'SRCH2222', version: 1, data: { key: 'SRCH2222', version: 1, name: 'UNREAD' } },
    ]))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'savedSearch', refOrName: 'Unread' } })),
      ZOTERO_SCOPE_AMBIGUOUS,
      'saved search',
    )
    expect(error.message).toContain('SRCH1111')
    expect(error.message).toContain('SRCH2222')
  })

  it('resolves a collection name without server provenance on pre-10 listings', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(COLLECTIONS))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }))
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234',
      name: 'LLM Papers',
    })
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234')
  })

  it('treats a non-array items response as an empty result set', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) => helpers.json({ key: 'ABCD1234' }))
    const result = await provider.search(request({}))
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.nextOffset).toBeUndefined()
  })

  it('treats a non-array scope listing as no matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json({ key: 'COLL1234' }))
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('keeps the input ref provenance when the single-object response has no server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => helpers.json(COLLECTIONS[0]))
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) => helpers.json([ITEM]))
    const result = await provider.search(request({
      scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
    }))
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
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json(SEARCHES, { 'Zotero-Server-ID': 'S1' }))
    mock.route('GET', '/api/users/0/searches/SRCH1234/items', (req, res, helpers) => (
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    ))
    const result = await provider.search(request({
      scope: { kind: 'savedSearch', refOrName: 'Unread Papers' },
      mode: 'everything',
      query: 'attention',
    }))
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) => helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'))
    await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' } })),
      ZOTERO_NOT_FOUND,
    )
  })

  it('rejects group refs before any request happens', async () => {
    await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'zotero://group/42/collection/COLL1234' } })),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })
})

const PARENT = {
  key: 'ABCD1234',
  version: 3,
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
    attachment: { href: 'http://localhost:23119/api/users/0/items/WXYZ6789', type: 'application/json', attachmentType: 'application/pdf' },
  },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    publicationTitle: 'ICML',
    tags: [{ tag: 'attention' }],
    collections: ['COLL1234'],
  },
}

const CHILD_ROWS = [
  { key: 'NOTE1111', data: { itemType: 'note', note: 'my note' } },
  { key: 'ANNO1111', data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'insight', annotationSortIndex: '00001' } },
  { key: 'WXYZ6789', data: { itemType: 'attachment', title: 'Full Text PDF', contentType: 'application/pdf', linkMode: 'imported_file' } },
]

describe('getItem', () => {
  it('fetches only the parent when nothing is included', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => (
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } }, { 'Zotero-Server-ID': 'S1' })
    ))
    const detail = await provider.getItem(getRequest())
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
    expect(detail.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(detail.children.total).toBe(3)
    expect(detail.notes).toBeUndefined()
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: '',
      contentType: 'application/pdf',
    })
  })

  it('fetches children lazily and resolves collection names once', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => (
      helpers.json(PARENT, { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) => (
      helpers.json(CHILD_ROWS, { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => (
      helpers.json([{ key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } }])
    ))
    const detail = await provider.getItem(getRequest(['notes', 'annotations', 'attachments']))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/collections',
    ])
    expect(detail.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' },
    ])
    expect(detail.notes).toEqual({
      total: 1,
      returned: 1,
      items: [{ ref: 'zotero://user/0/item/NOTE1111?server=S1', text: 'my note', truncated: false }],
    })
    expect(detail.annotations!.total).toBe(1)
    expect(detail.attachments!.items[0]!.title).toBe('Full Text PDF')
    expect(detail.bestAttachment!.title).toBe('Full Text PDF')
  })

  it('skips the collections listing for items without collections', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => (
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } })
    ))
    await provider.getItem(getRequest())
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
  })

  it('leaves collection names off when the listing lacks them', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(PARENT))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => (
      helpers.json([{ key: 'COLL9999', version: 1, data: { key: 'COLL9999', version: 1, name: 'Other' } }])
    ))
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })

  it('treats a non-array children response as no children', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => (
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } })
    ))
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) => helpers.json({ key: 'NOTE1111' }))
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes).toEqual({ total: 0, returned: 0, items: [] })
  })

  it('rejects non-item refs before any request happens', async () => {
    await zoteroError(
      provider.getItem({ ref: parseRef('zotero://user/0/attachment/WXYZ6789'), include: new Set() }),
      'ZOTERO_INVALID_REF',
      'Expected a item reference',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('getAttachmentLocation', () => {
  const FILE_ATTACHMENT = {
    key: 'WXYZ6789',
    version: 1,
    data: { itemType: 'attachment', title: 'Full Text PDF', contentType: 'application/pdf', linkMode: 'imported_file' },
  }

  it('resolves an imported file through /file/view/url and verifies it on disk', async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => (
      helpers.json(FILE_ATTACHMENT, { 'Zotero-Server-ID': 'S1' })
    ))
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) => (
      helpers.text(pathToFileURL(filePath).href)
    ))
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789'))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      kind: 'file',
      path: filePath,
    })
  })

  it('fails with FILE_MISSING when the reported file is gone', async () => {
    const missing = pathToFileURL(join(tempDir, 'gone.pdf')).href
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(FILE_ATTACHMENT))
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) => helpers.text(missing))
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_FILE_MISSING,
      'missing from disk',
    )
    expect(error.message).toContain('gone.pdf')
  })

  it('serves linked-URL attachments from data.url without touching /file/view/url', async () => {
    const linked = {
      key: 'WXYZ6789',
      version: 1,
      data: { itemType: 'attachment', title: 'Preprint', contentType: 'application/pdf', linkMode: 'linked_url', url: 'https://arxiv.org/pdf/2307.08691' },
    }
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(linked))
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789'))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/WXYZ6789'])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: 'Preprint',
      contentType: 'application/pdf',
      kind: 'url',
      url: 'https://arxiv.org/pdf/2307.08691',
    })
  })

  it('fails with NO_ATTACHMENT when a linked-URL attachment reports no URL', async () => {
    const linked = {
      key: 'WXYZ6789',
      version: 1,
      data: { itemType: 'attachment', title: 'Preprint', linkMode: 'linked_url' },
    }
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(linked))
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'reported none',
    )
  })

  it('fails with NO_ATTACHMENT when the referenced object is not an attachment', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json({
      key: 'WXYZ6789',
      version: 1,
      data: { itemType: 'note', note: 'not a file' },
    }))
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'not an attachment',
    )
    expect(error.message).toContain('note')
    expect(mock.requests).toHaveLength(1)
  })

  it('fails with NO_ATTACHMENT when /file/view/url reports no usable location', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(FILE_ATTACHMENT))
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) => helpers.text('false'))
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'no usable file location',
    )
  })

  it('passes non-file URLs through as url locations', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(FILE_ATTACHMENT))
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) => helpers.text('https://example.com/paper.pdf'))
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789'))
    expect(location.kind).toBe('url')
    expect((location as { url: string }).url).toBe('https://example.com/paper.pdf')
  })

  it('rejects group refs before any request happens', async () => {
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://group/42/attachment/WXYZ6789')),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('getItem collections edge cases', () => {
  it('treats a non-array collections listing as no names', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(PARENT))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json({ key: 'COLL1234' }))
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })
})
