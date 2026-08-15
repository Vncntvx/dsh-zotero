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
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../src/errors.js'
import { buildSearchParams, encodeLiteralTag, LocalApiProvider } from '../src/provider-local.js'
import { parseRef } from '../src/refs.js'
import type { LocalApiLimits } from '../src/provider-local.js'
import type {
  ZoteroExportRequest,
  ZoteroGetRequest,
  ZoteroRetrieveRequest,
  ZoteroSearchRequest,
} from '../src/types.js'
import { MockZotero } from './helpers/mock-zotero.js'

let mock: MockZotero
let provider: LocalApiProvider
let tempDir: string

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return new LocalApiProvider(
    new ZoteroHttpClient({ baseUrl: mock.baseUrl, timeoutMs: 5000, maxResponseBytes: 1024 * 1024 }),
    {
      maxNoteScanRecords: 200,
      maxDetailChars: 500,
      maxNoteBodyChars: 30_000,
      maxNoteChars: 2000,
      maxNoteRecords: 50,
      maxAnnotationRecords: 100,
      fulltextChunkWords: 200,
      maxEvidenceChars: 6000,
      maxEvidencePassages: 4,
      maxFulltextChars: 100_000,
      maxExportChars: 1_000_000,
      defaultStyle: 'apa',
      defaultLocale: 'en-US',
      ...limits,
    },
  )
}

beforeEach(async () => {
  mock = await MockZotero.start()
  provider = makeProvider()
  tempDir = mkdtempSync(join(tmpdir(), 'dsh-zotero-'))
})

afterEach(async () => {
  await mock.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function getRequest(include: ('notes' | 'annotations' | 'attachments')[] = []): ZoteroGetRequest {
  return { ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set(include) }
}

function retrieveRequest(overrides: Partial<ZoteroRetrieveRequest> = {}): ZoteroRetrieveRequest {
  return {
    ref: parseRef('zotero://user/0/item/ABCD1234'),
    query: 'flash attention',
    sources: ['annotation', 'note', 'abstract', 'fulltext'],
    passages: 4,
    ...overrides,
  }
}

function exportRequest(overrides: Partial<ZoteroExportRequest> = {}): ZoteroExportRequest {
  return {
    refs: [parseRef('zotero://user/0/item/ABCD1234'), parseRef('zotero://user/0/item/BBBB1234')],
    format: 'citation',
    ...overrides,
  }
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

async function zoteroError(
  promise: Promise<unknown>,
  code: string,
  messagePart?: string,
): Promise<ZoteroError> {
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
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
  },
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
    const params = buildSearchParams(
      request({
        query: 'flash attention',
        itemTypes: ['journalArticle', 'conferencePaper'],
        tags: ['reviewed', '-draft'],
        sort: 'dateAdded',
        direction: 'asc',
        offset: 20,
        limit: 5,
      }),
    )
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
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '25', 'Zotero-Server-ID': 'S1' }),
    )
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
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': 'garbage' }),
    )
    const result = await provider.search(request({}))
    expect(result.total).toBe(1)
  })

  it('keeps the scope provenance when the items response omits the server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM]),
    )
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
  })
})

describe('search: collection scope', () => {
  it('resolves a collection name and searches its top-level items', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const result = await provider.search(
      request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(COLLECTIONS[0], { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1' }),
    )
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
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
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) =>
      helpers.json([
        { key: 'SRCH1111', version: 1, data: { key: 'SRCH1111', version: 1, name: 'unread' } },
        { key: 'SRCH2222', version: 1, data: { key: 'SRCH2222', version: 1, name: 'UNREAD' } },
      ]),
    )
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
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM]),
    )
    const result = await provider.search(
      request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234',
      name: 'LLM Papers',
    })
    expect(result.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234')
  })

  it('treats a non-array items response as an empty result set', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json({ key: 'ABCD1234' }),
    )
    const result = await provider.search(request({}))
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.nextOffset).toBeUndefined()
  })

  it('treats a non-array scope listing as no matches', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json({ key: 'COLL1234' }),
    )
    const error = await zoteroError(
      provider.search(request({ scope: { kind: 'collection', refOrName: 'LLM Papers' } })),
      ZOTERO_NOT_FOUND,
    )
    expect(error.message).not.toContain('Possible matches')
  })

  it('keeps the input ref provenance when the single-object response has no server id', async () => {
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(COLLECTIONS[0]),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([ITEM]),
    )
    const result = await provider.search(
      request({
        scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234?server=S1' },
      }),
    )
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
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) =>
      helpers.json(SEARCHES, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/searches/SRCH1234/items', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const result = await provider.search(
      request({
        scope: { kind: 'savedSearch', refOrName: 'Unread Papers' },
        mode: 'everything',
        query: 'attention',
      }),
    )
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
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    await zoteroError(
      provider.search(
        request({
          scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' },
        }),
      ),
      ZOTERO_NOT_FOUND,
    )
  })

  it('rejects group refs before any request happens', async () => {
    await zoteroError(
      provider.search(
        request({
          scope: { kind: 'collection', refOrName: 'zotero://group/42/collection/COLL1234' },
        }),
      ),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('search: note-content scan', () => {
  const NOTE_HIT = {
    key: 'NOTE1111',
    data: { itemType: 'note', note: 'cascade failure chains in infrastructure' },
  }
  const NOTE_OTHER = {
    key: 'NOTE2222',
    data: { itemType: 'note', note: 'something unrelated entirely' },
  }

  it('merges body-matched notes into the first page and counts them in total', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT, NOTE_OTHER])
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(request({ query: 'cascade infrastructure' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
    expect(result.total).toBe(2)
    expect(result.returned).toBe(2)
    expect(result.nextOffset).toBeUndefined()
    expect(mock.requests[1]!.search.get('itemType')).toBe('note')
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
  })

  it('synthesizes a title for the merged note and dedupes API-page overlap', async () => {
    const titled = {
      key: 'NOTE3333',
      data: { itemType: 'note', note: '数据计算 notes about cascade risk' },
    }
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([titled])
      else helpers.json([titled], { 'Total-Results': '1' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.title).toBe('数据计算 notes about cascade risk')
    expect(result.total).toBe(1)
  })

  it('skips the scan for later pages, saved searches, empty queries, and non-note type filters', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/searches', (req, res, helpers) => helpers.json(SEARCHES))
    mock.route('GET', '/api/users/0/searches/SRCH1234/items', (req, res, helpers) =>
      helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    await provider.search(request({ query: 'cascade', offset: 10 }))
    await provider.search(request({ query: 'cascade', itemTypes: ['journalArticle'] }))
    await provider.search(request({ query: '' }))
    await provider.search(
      request({ query: 'cascade', scope: { kind: 'savedSearch', refOrName: 'Unread Papers' } }),
    )
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toEqual([])
  })

  it('filters scanned notes by the resolved collection and literal tags', async () => {
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(COLLECTIONS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
    )
    const inCollection = {
      key: 'NOTE1111',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        collections: ['COLL1234'],
        tags: [{ tag: 'reviewed' }],
      },
    }
    const otherCollection = {
      key: 'NOTE2222',
      data: { itemType: 'note', note: 'cascade risk note', collections: ['OTHER123'] },
    }
    const missingTag = {
      key: 'NOTE3333',
      data: {
        itemType: 'note',
        note: 'cascade risk note',
        collections: ['COLL1234'],
        tags: [],
      },
    }
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([inCollection, otherCollection, missingTag])
      else helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: 'LLM Papers' },
        tags: ['reviewed'],
      }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
    expect(result.total).toBe(1)
  })

  it('stops the scan at the configured record cap', async () => {
    const capped = makeProvider({ maxNoteScanRecords: 2 })
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          { key: 'NOTE1111', data: { itemType: 'note', note: 'cascade one' } },
          { key: 'NOTE2222', data: { itemType: 'note', note: 'cascade two' } },
          { key: 'NOTE3333', data: { itemType: 'note', note: 'cascade three' } },
        ])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items).toHaveLength(2)
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
      'zotero://user/0/item/NOTE2222',
    ])
    expect(mock.requests[1]!.search.get('limit')).toBe('2')
  })

  it('treats an empty scan response as no note matches', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json({})
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(result.total).toBe(1)
  })

  it('skips non-note scan rows, tagless notes, and partial term matches', async () => {
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          { key: 'ATTACH1X', data: { itemType: 'attachment' } },
          { key: 'NOTE4444', data: { itemType: 'note', note: 'cascade without the second term' } },
        ])
      else helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
    })
    const result = await provider.search(
      request({ query: 'cascade infrastructure', tags: ['reviewed'] }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
  })

  it('pages the scan in batches up to the cap', async () => {
    const capped = makeProvider({ maxNoteScanRecords: 150 })
    const batch = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        key: `NOTE${String(i).padStart(4, '0')}`,
        data: { itemType: 'note', note: 'unrelated note body' },
      }))
    let scanPage = 0
    mock.route('GET', '/api/users/0/items/top', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        scanPage += 1
        helpers.json(scanPage === 1 ? batch(100) : batch(30))
      } else {
        helpers.json([ITEM], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' })
      }
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
    expect(mock.requests[2]!.search.get('start')).toBe('100')
    expect(mock.requests[2]!.search.get('limit')).toBe('50')
    expect(mock.requests).toHaveLength(3)
  })
})

const PARENT = {
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
    tags: [{ tag: 'attention' }],
    collections: ['COLL1234'],
  },
}

const CHILD_ROWS = [
  { key: 'NOTE1111', data: { itemType: 'note', note: 'my note' } },
  {
    key: 'ANNO1111',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'insight',
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

describe('getItem', () => {
  it('fetches only the parent when nothing is included', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        { ...PARENT, data: { ...PARENT.data, collections: [] } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
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
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(CHILD_ROWS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([
        { key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } },
      ]),
    )
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
      items: [
        { ref: 'zotero://user/0/item/NOTE1111?server=S1', text: 'my note', truncated: false },
      ],
    })
    expect(detail.annotations!.total).toBe(1)
    expect(detail.attachments!.items[0]!.title).toBe('Full Text PDF')
    expect(detail.bestAttachment!.title).toBe('Full Text PDF')
  })

  it('skips the collections listing for items without collections', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } }),
    )
    await provider.getItem(getRequest())
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
  })

  it('leaves collection names off when the listing lacks them', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(PARENT))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([
        { key: 'COLL9999', version: 1, data: { key: 'COLL9999', version: 1, name: 'Other' } },
      ]),
    )
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })

  it('treats a non-array children response as no children', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json({ key: 'NOTE1111' }),
    )
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes).toEqual({ total: 0, returned: 0, items: [] })
  })

  it('applies the configured note and annotation record caps', async () => {
    const notes = Array.from({ length: 7 }, (_, i) => ({
      key: `NOTE${String(i).padStart(4, '0')}`,
      data: { itemType: 'note', note: `note ${i}` },
    }))
    const annotations = Array.from({ length: 3 }, (_, i) => ({
      key: `ANNO${String(i).padStart(4, '0')}`,
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: `a ${i}`,
        annotationSortIndex: String(i).padStart(5, '0'),
      },
    }))
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        { ...PARENT, data: { ...PARENT.data, collections: [] } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([...notes, ...annotations], { 'Zotero-Server-ID': 'S1' }),
    )
    const capped = makeProvider({ maxNoteRecords: 2, maxAnnotationRecords: 1, maxNoteChars: 5 })
    const detail = await capped.getItem(getRequest(['notes', 'annotations']))
    expect(detail.notes).toMatchObject({ total: 7, returned: 2 })
    expect(detail.notes!.items[0]).toMatchObject({ text: 'note ', truncated: true })
    expect(detail.annotations).toMatchObject({ total: 3, returned: 1 })
  })

  it('rejects non-item refs before any request happens', async () => {
    await zoteroError(
      provider.getItem({
        ref: parseRef('zotero://user/0/attachment/WXYZ6789'),
        include: new Set(),
      }),
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
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  }

  it('resolves an imported file through /file/view/url and verifies it on disk', async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(pathToFileURL(filePath).href),
    )
    const location = await provider.getAttachmentLocation(
      parseRef('zotero://user/0/attachment/WXYZ6789'),
    )
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
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(missing),
    )
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
      data: {
        itemType: 'attachment',
        title: 'Preprint',
        contentType: 'application/pdf',
        linkMode: 'linked_url',
        url: 'https://arxiv.org/pdf/2307.08691',
      },
    }
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(linked))
    const location = await provider.getAttachmentLocation(
      parseRef('zotero://user/0/attachment/WXYZ6789'),
    )
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
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: { itemType: 'note', note: 'not a file' },
      }),
    )
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'not an attachment',
    )
    expect(error.message).toContain('note')
    expect(mock.requests).toHaveLength(1)
  })

  it('fails with NO_ATTACHMENT when /file/view/url reports no usable location', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('false'),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'no usable file location',
    )
  })

  it('passes non-file URLs through as url locations', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('https://example.com/paper.pdf'),
    )
    const location = await provider.getAttachmentLocation(
      parseRef('zotero://user/0/attachment/WXYZ6789'),
    )
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
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json({ key: 'COLL1234' }),
    )
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
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
  meta: { parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    abstractNote:
      'FlashAttention speeds up transformer training by reordering attention computation.',
    collections: [],
  },
}

const RETRIEVE_CHILDREN = [
  {
    key: 'ANNO1111',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'see the tiling figure for details',
      annotationComment: 'compare with figure 3',
      annotationPageLabel: '7',
      annotationSortIndex: '00001',
    },
  },
  { key: 'NOTE1111', data: { itemType: 'note', note: 'read this for the tiling strategy' } },
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

const FULLTEXT_PAYLOAD = {
  content:
    'Flash attention speeds up transformer training. Attention is all you need. Farming crops in the spring.',
  indexedPages: 10,
  totalPages: 12,
  indexedChars: 1000,
  totalChars: 1200,
}

describe('retrieve', () => {
  it('ranks evidence across sources and reports fulltext coverage', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest())
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/WXYZ6789/fulltext',
    ])
    expect(result.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789?server=S1')
    expect(result.coverage).toEqual({
      indexedPages: 10,
      totalPages: 12,
      indexedChars: 1000,
      totalChars: 1200,
      complete: false,
    })
    expect(result.truncated).toBe(false)
    const annotationEvidence = result.evidence.find((entry) => entry.source === 'annotation')!
    expect(annotationEvidence.comment).toBe('compare with figure 3')
    expect(annotationEvidence.pageLabel).toBe('7')
    const sources = result.evidence.map((entry) => entry.source)
    expect(sources).toContain('annotation')
    expect(sources).toContain('note')
    expect(sources).toContain('abstract')
    expect(sources).toContain('fulltext')
    // The fulltext chunk carries more query-term hits than any other passage.
    expect(result.evidence[0]!.source).toBe('fulltext')
    expect(result.evidence[0]!.text).toContain('Flash attention')
  })

  it('fetches lazily per source: abstract-only evidence needs just the parent', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 1 }))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
    expect(result.evidence.map((entry) => entry.source)).toEqual(['abstract'])
    expect(result.attachmentRef).toBeUndefined()
  })

  it('picks a PDF child when the parent has no attachment link', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
  })

  it('degrades an unindexed fulltext response to sourcesSkipped', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'No indexed full text'),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'] }))
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
    expect(result.truncated).toBe(false)
  })

  it('caps evidence by passage count and reports truncation', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest({ passages: 1 }))
    expect(result.evidence).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('caps evidence by the character budget', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 20 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await narrow.retrieve(retrieveRequest())
    expect(result.evidence.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      20,
    )
    expect(result.truncated).toBe(true)
  })

  it('chunks fulltext at the configured passage word count', async () => {
    const narrow = makeProvider({ fulltextChunkWords: 2 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await narrow.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 20 }))
    // Evidence comes back BM25-ranked, so chunk order is relevance order, not
    // source order; each chunk is still a verbatim span of the original text.
    const chunks = result.evidence.filter((entry) => entry.source === 'fulltext')
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.split(/\s+/).filter((part) => part !== '').length).toBeLessThanOrEqual(2)
      expect(FULLTEXT_PAYLOAD.content).toContain(chunk.text)
    }
  })

  it('rejects non-item refs before any request happens', async () => {
    await zoteroError(
      provider.retrieve(retrieveRequest({ ref: parseRef('zotero://user/0/attachment/WXYZ6789') })),
      'ZOTERO_INVALID_REF',
      'Expected a item reference',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('retrieve edge cases', () => {
  it('gathers note-only evidence without annotation sources', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['note'], passages: 2 }))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
    ])
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
  })

  it('degrades to sourcesSkipped when no PDF child exists for fulltext', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'only a note' } }]),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'] }))
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('passes non-404 fulltext failures through unchanged', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    await zoteroError(
      provider.retrieve(retrieveRequest({ sources: ['fulltext'] })),
      ZOTERO_UNEXPECTED,
      'HTTP 500',
    )
  })
})

describe('retrieve tolerances', () => {
  it('reports page-only coverage when the payload lacks char counts', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({
        content: 'flash attention everywhere',
        indexedPages: 2,
        totalPages: 5,
      }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.coverage).toEqual({ indexedPages: 2, totalPages: 5, complete: false })
  })

  it('treats a non-array children response as no annotation or note evidence', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json({ key: 'NOTE1111' }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['note'], passages: 2 }))
    expect(result.evidence).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('omits abstract evidence when the parent has no abstract', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        ...RETRIEVE_PARENT,
        data: { ...RETRIEVE_PARENT.data, abstractNote: undefined },
      }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 2 }))
    expect(result.evidence).toEqual([])
  })

  it('omits abstract evidence when the abstract is empty', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, data: { ...RETRIEVE_PARENT.data, abstractNote: '' } }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 2 }))
    expect(result.evidence).toEqual([])
  })

  it('treats a stringless fulltext content as no chunks', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({ content: 42 }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 2 }))
    expect(result.evidence).toEqual([])
    expect(result.coverage).toEqual({ complete: false })
  })
})

describe('note-first-class paths', () => {
  it('treats a note item own body as its note source without fetching children', async () => {
    mock.route('GET', '/api/users/0/items/NOTE9999', (req, res, helpers) =>
      helpers.json({
        key: 'NOTE9999',
        data: {
          itemType: 'note',
          note: '<p>cascade failure chains</p><p>infrastructure interdependency</p>',
        },
      }),
    )
    const result = await provider.retrieve(
      retrieveRequest({
        ref: parseRef('zotero://user/0/item/NOTE9999'),
        query: 'cascade',
        sources: ['note'],
        passages: 4,
      }),
    )
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/NOTE9999'])
    expect(result.evidence).toEqual([
      {
        source: 'note',
        sourceRef: 'zotero://user/0/item/NOTE9999',
        text: 'cascade failure chains\ninfrastructure interdependency',
        chunkIndex: 0,
        chunkCount: 1,
      },
    ])
    expect(result.sourcesSkipped).toEqual([])
  })

  it('recognizes a note item from the top-level itemType fallback', async () => {
    mock.route('GET', '/api/users/0/items/NOTE9999', (req, res, helpers) =>
      helpers.json({ key: 'NOTE9999', itemType: 'note', data: { note: 'own body words' } }),
    )
    const result = await provider.retrieve(
      retrieveRequest({
        ref: parseRef('zotero://user/0/item/NOTE9999'),
        query: 'body',
        sources: ['note'],
        passages: 2,
      }),
    )
    expect(result.evidence.map((entry) => entry.text)).toEqual(['own body words'])
  })

  it('contributes every chunk of a long child note with locators', async () => {
    const narrow = makeProvider({ fulltextChunkWords: 2 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        { key: 'NOTE1111', data: { itemType: 'note', note: 'alpha beta gamma delta epsilon' } },
      ]),
    )
    const result = await narrow.retrieve(retrieveRequest({ sources: ['note'], passages: 10 }))
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note', 'note', 'note'])
    expect(result.evidence.map((entry) => entry.text)).toEqual([
      'alpha beta',
      'gamma delta',
      'epsilon',
    ])
    expect(result.evidence.map((entry) => entry.chunkIndex)).toEqual([0, 1, 2])
    expect(result.evidence.map((entry) => entry.chunkCount)).toEqual([3, 3, 3])
    expect(
      result.evidence.every((entry) => entry.sourceRef === 'zotero://user/0/item/NOTE1111'),
    ).toBe(true)
  })

  it('skips an unavailable fulltext source while keeping note evidence', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'tiling strategy note' } }]),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['note', 'fulltext'] }))
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('returns the note body for note items under the configured budget', async () => {
    const narrow = makeProvider({ maxNoteBodyChars: 8 })
    mock.route('GET', '/api/users/0/items/NOTE9999', (req, res, helpers) =>
      helpers.json({
        key: 'NOTE9999',
        data: { itemType: 'note', note: '<p>first line</p><p>second line long</p>' },
      }),
    )
    const detail = await narrow.getItem({
      ref: parseRef('zotero://user/0/item/NOTE9999'),
      include: new Set(),
    })
    expect(detail.itemType).toBe('note')
    expect(detail.noteBody).toEqual({ text: 'first li', truncated: true })
  })

  it('carries the parent ref on child note records', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        {
          key: 'NOTE1111',
          data: { itemType: 'note', note: 'child note', parentItem: 'ABCD1234' },
        },
      ]),
    )
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes!.items[0]).toMatchObject({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      parentRef: 'zotero://user/0/item/ABCD1234?server=S1',
    })
  })
})

describe('export', () => {
  it('pairs per-item citations with requested refs in one request', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'BBBB1234', citation: '<span>B, 2021</span>' },
        { key: 'ABCD1234', citation: '<span>A, 2023</span>' },
      ]),
    )
    const result = await provider.export(
      exportRequest({ style: 'chicago-note-bibliography', locale: 'fr-FR' }),
    )
    const sent = mock.requests[0]!
    expect(sent.pathname).toBe('/api/users/0/items')
    expect(sent.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    expect(sent.search.get('include')).toBe('citation')
    expect(sent.search.get('style')).toBe('chicago-note-bibliography')
    expect(sent.search.get('locale')).toBe('fr-FR')
    expect(result).toEqual({
      format: 'citation',
      style: 'chicago-note-bibliography',
      locale: 'fr-FR',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '<span>A, 2023</span>' },
        { ref: 'zotero://user/0/item/BBBB1234', text: '<span>B, 2021</span>' },
      ],
    })
  })

  it('applies the configured defaults for style and locale', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: 'x' },
        { key: 'BBBB1234', citation: 'y' },
      ]),
    )
    const result = await provider.export(exportRequest())
    const sent = mock.requests[0]!
    expect(sent.search.get('style')).toBe('apa')
    expect(sent.search.get('locale')).toBe('en-US')
    if (result.format !== 'citation') throw new Error('unreachable')
    expect(result.style).toBe('apa')
    expect(result.locale).toBe('en-US')
  })

  it('fails with NOT_FOUND when a requested key is missing from the citation response', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ key: 'ABCD1234', citation: 'x' }]),
    )
    await zoteroError(provider.export(exportRequest()), ZOTERO_NOT_FOUND, 'BBBB1234')
  })

  it('fetches a joined bibliography with format=bib', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.text('<div class="csl-entry">A</div>\n<div class="csl-entry">B</div>'),
    )
    const result = await provider.export(exportRequest({ format: 'bibliography' }))
    const sent = mock.requests[0]!
    expect(sent.search.get('format')).toBe('bib')
    expect(sent.search.get('style')).toBe('apa')
    expect(sent.search.get('locale')).toBe('en-US')
    expect(result).toEqual({
      format: 'bibliography',
      style: 'apa',
      locale: 'en-US',
      text: '<div class="csl-entry">A</div>\n<div class="csl-entry">B</div>',
    })
  })

  it('passes translator export bodies through with the format parameter', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.text(`exported-as-${search.get('format')}`),
    )
    for (const format of ['bibtex', 'biblatex', 'ris', 'csljson'] as const) {
      const result = await provider.export(exportRequest({ format }))
      expect(mock.requests[mock.requests.length - 1]!.search.get('format')).toBe(format)
      expect(result).toEqual({ format, text: `exported-as-${format}` })
    }
  })

  it('fails with OUTPUT_TOO_LARGE instead of truncating oversized exports', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('01234567890'))
    await zoteroError(
      narrow.export(exportRequest({ format: 'bibtex' })),
      'ZOTERO_OUTPUT_TOO_LARGE',
      'exceeds',
    )
  })

  it('applies the output cap to citation pairs too', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: '01234567890' },
        { key: 'BBBB1234', citation: 'short' },
      ]),
    )
    await zoteroError(narrow.export(exportRequest()), 'ZOTERO_OUTPUT_TOO_LARGE')
  })

  it("sends the first ref's server provenance on the export request", async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: 'x' },
        { key: 'BBBB1234', citation: 'y' },
      ]),
    )
    await provider.export(
      exportRequest({
        refs: [
          parseRef('zotero://user/0/item/ABCD1234?server=S1'),
          parseRef('zotero://user/0/item/BBBB1234'),
        ],
      }),
    )
    expect(mock.requests[0]!.headers['zotero-server-id']).toBe('S1')
  })

  it('rejects non-item and group refs before any request happens', async () => {
    await zoteroError(
      provider.export(exportRequest({ refs: [parseRef('zotero://user/0/attachment/WXYZ6789')] })),
      'ZOTERO_INVALID_REF',
      'Expected a item reference',
    )
    await zoteroError(
      provider.export(exportRequest({ refs: [parseRef('zotero://group/42/item/ABCD1234')] })),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('export tolerances', () => {
  it('treats a non-array citation response as missing items', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json({ key: 'ABCD1234' }),
    )
    await zoteroError(provider.export(exportRequest()), ZOTERO_NOT_FOUND, 'ABCD1234')
  })

  it('fails loud on a citation row without a valid key', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ citation: 'x' }]),
    )
    await zoteroError(
      provider.export(exportRequest()),
      ZOTERO_UNEXPECTED,
      'without a valid object key',
    )
  })

  it('tolerates rows without a citation string', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ key: 'ABCD1234' }, { key: 'BBBB1234', citation: 'y' }]),
    )
    const result = await provider.export(exportRequest())
    expect(result).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '' },
        { ref: 'zotero://user/0/item/BBBB1234', text: 'y' },
      ],
    })
  })
})

describe('getAttachmentLocation via item refs', () => {
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

  it("resolves an item ref through Zotero's best-attachment link", async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        {
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
        },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(pathToFileURL(filePath).href),
    )
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234'))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      kind: 'file',
      path: filePath,
    })
  })

  it('falls back to a PDF child when the item has no attachment link', async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: { itemType: 'journalArticle', title: 'T' },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } },
        {
          key: 'WXYZ6789',
          data: {
            itemType: 'attachment',
            title: 'Full Text PDF',
            contentType: 'application/pdf',
            linkMode: 'imported_file',
          },
        },
      ]),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(pathToFileURL(filePath).href),
    )
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234'))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location.kind).toBe('file')
  })

  it('fails with NO_ATTACHMENT when the item has no attachment', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: { itemType: 'journalArticle', title: 'T' },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'only a note' } }]),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234')),
      ZOTERO_NO_ATTACHMENT,
      'no attachment',
    )
  })

  it('fails with NO_ATTACHMENT on a non-array children fallback', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: { itemType: 'journalArticle', title: 'T' },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json({ key: 'NOTE1111' }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234')),
      ZOTERO_NO_ATTACHMENT,
    )
  })
})
