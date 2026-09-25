/**
 * The `zotero_search` client-side note-body scan: the `itemType=note` listing
 * the provider reads after a metadata search, the folding and term matching it
 * applies locally, the collection and tag filters it re-checks against the
 * scan rows, the parent-membership lookups that resolve child notes, and the
 * headroom, cap, and pagination rules that bound it.
 *
 * These tests drive one route that answers two different bodies depending on
 * the query params — the primary listing or the note scan — so their handlers
 * are the subject, not an installer's option.
 * @module tests/local/search-scan
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { INCLUDE_TRASHED_SCOPE_MESSAGE } from '../../src/local/search-domain.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  createProvider,
  request,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount } from '../helpers/server/assert.js'
import { SERVER_ID } from '../helpers/server/keys.js'
import { attachment, collectionRow, item, noteRow, searchHit } from '../helpers/server/objects.js'
import { serveJson, serveSearchPage } from '../helpers/server/serve.js'
import { COLLECTIONS, SEARCHES, makeProvider } from './search-helpers.js'

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

describe('search: note-content scan', () => {
  const NOTE_HIT = noteRow({ data: { note: 'cascade failure chains in infrastructure' } })
  const NOTE_OTHER = noteRow({ key: 'NOTE2222', data: { note: 'something unrelated entirely' } })

  it('lists body-matched notes as a first-page supplement beside the paged results', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT, NOTE_OTHER])
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(request({ query: 'cascade infrastructure' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    // The paged fields describe the primary hits only; the note match rides
    // in `supplemental` so pagination semantics stay exact.
    expect(result.total).toBe(1)
    expect(result.returned).toBe(1)
    expect(result.supplemental).toEqual({
      kind: 'noteBody',
      items: [expect.objectContaining({ ref: 'zotero://user/0/item/NOTE1111?server=S1' })],
      scanned: 2,
      truncated: false,
    })
    expect(result.nextOffset).toBeUndefined()
    expect(mock.requests[1]!.search.get('itemType')).toBe('note')
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
    expect(mock.requests[1]!.search.get('sort')).toBe('dateModified')
    expect(mock.requests[1]!.search.get('direction')).toBe('desc')
  })

  it('matches the note scan with the same folding the server searches with', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        helpers.json([
          noteRow({ key: 'NOTE3333', data: { note: 'the café serves a séance study group' } }),
        ])
      } else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    // Unaccented query, accented note: the server-side search matches that
    // pair, so the client-side scan must not be the one that misses it.
    const result = await provider.search(request({ query: 'cafe seance' }))
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE3333?server=S1',
    ])
  })

  it('does not treat a query token as a note-text substring', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        helpers.json([noteRow({ data: { note: 'The concatenate function' } })])
      } else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })

    const result = await provider.search(request({ query: 'cat' }))
    expect(result.supplemental).toBeUndefined()
  })

  it('applies the literal tag filters to the note scan', async () => {
    const scanRows = [
      noteRow({
        key: 'NOTE5555',
        data: {
          note: 'cascade infrastructure notes',
          tags: [{ tag: 'reviewed' }, { tag: 'draft' }],
        },
      }),
      noteRow({
        key: 'NOTE6666',
        data: { note: 'cascade infrastructure notes', tags: [{ tag: 'draft' }] },
      }),
      noteRow({ key: 'NOTE7777', data: { note: 'cascade infrastructure notes', tags: [] } }),
    ]
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json(scanRows)
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const refsOf = (result: { supplemental?: { items: { ref: string }[] } }): string[] =>
      result.supplemental?.items.map((entry) => entry.ref) ?? []
    const scanRefs = (key: string): string => `zotero://user/0/item/${key}?server=S1`

    // `any`: one matching tag is enough, so both tagged notes pass.
    const any = await provider.search(
      request({ query: 'cascade infrastructure', tags: ['reviewed', 'draft'], tagMatch: 'any' }),
    )
    expect(refsOf(any)).toEqual([scanRefs('NOTE5555'), scanRefs('NOTE6666')])

    // excludeTags drops the notes carrying the tag; the untagged one stays.
    const excluded = await provider.search(
      request({ query: 'cascade infrastructure', excludeTags: ['draft'] }),
    )
    expect(refsOf(excluded)).toEqual([scanRefs('NOTE7777')])
  })

  it('scans trashed notes when includeTrashed asks for them', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        helpers.json([noteRow({ key: 'NOTE8888', data: { note: 'cascade trashed' } })])
      } else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(request({ query: 'cascade', includeTrashed: true }))
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE8888?server=S1',
    ])
    // The scan must read the trash too, or a trashed note the primary search
    // was told to include could never surface.
    const scan = mock.requests.find((entry) => entry.search.get('itemType') === 'note')
    expect(scan?.search.get('includeTrashed')).toBe('1')
    // And the primary listing itself must ask for the trash: a scan that
    // included it while the listing did not would list items the caller asked
    // for exactly once, in neither result.
    const primary = mock.requests.find((entry) => entry.search.get('itemType') === null)
    expect(primary?.search.get('includeTrashed')).toBe('1')
  })

  it('refuses includeTrashed outside a library scope', async () => {
    await zoteroError(
      provider.search(
        request({
          query: 'x',
          includeTrashed: true,
          scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL1234' },
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      INCLUDE_TRASHED_SCOPE_MESSAGE,
    )
    expectRequestCount(mock, 0)
  })

  it('keeps the publications scan inside My Publications', async () => {
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      path: '/api/users/0/publications/items/top',
    })
    mock.route('GET', '/api/users/0/publications/items', (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT])
      else helpers.json([])
    })
    const result = await provider.search(
      request({ query: 'cascade infrastructure', scope: { kind: 'publications' } }),
    )
    // The scan must hit the publications segment; the bare library prefix
    // would leak note matches from outside My Publications.
    expect(mock.requests[1]!.pathname).toBe('/api/users/0/publications/items')
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
  })

  it('synthesizes a title for the merged note and dedupes API-page overlap', async () => {
    const titled = noteRow({ key: 'NOTE3333', data: { note: '数据计算 notes about cascade risk' } })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([titled])
      else helpers.json([titled], { 'Total-Results': '1' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.title).toBe('数据计算 notes about cascade risk')
    expect(result.total).toBe(1)
    expect(result.supplemental).toBeUndefined()
  })

  it('skips the scan for later pages, saved searches, empty queries, and non-note type filters', async () => {
    serveSearchPage(mock, { items: [searchHit()], total: 1 })
    serveJson(mock, '/api/users/0/searches', SEARCHES)
    serveSearchPage(mock, {
      items: [searchHit()],
      total: 1,
      path: '/api/users/0/searches/SRCH1234/items',
    })
    await provider.search(request({ query: 'cascade', offset: 10 }))
    await provider.search(request({ query: 'cascade', itemTypes: ['journalArticle'] }))
    await provider.search(request({ query: '' }))
    await provider.search(
      request({ query: 'cascade', scope: { kind: 'savedSearch', refOrName: 'Unread Papers' } }),
    )
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toEqual([])
  })

  it('filters scanned notes by the resolved collection and literal tags', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Zotero-Server-ID': SERVER_ID })
    serveSearchPage(mock, {
      items: [],
      total: 0,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    const inCollection = noteRow({
      data: {
        note: 'cascade risk note',
        collections: ['COLL1234'],
        tags: [{ tag: 'reviewed' }],
      },
    })
    const otherCollection = noteRow({
      key: 'NOTE2222',
      data: {
        note: 'cascade risk note',
        collections: ['OTHER123'],
        tags: [{ tag: 'reviewed' }],
      },
    })
    const missingTag = noteRow({
      key: 'NOTE3333',
      data: { note: 'cascade risk note', collections: ['COLL1234'], tags: [] },
    })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([inCollection, otherCollection, missingTag])
      else helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: 'LLM Papers' },
        tags: ['reviewed'],
      }),
    )
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
    expect(result.total).toBe(0)
    expect(result.returned).toBe(0)
  })

  it('resolves child-note collection membership through the parent item', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Zotero-Server-ID': SERVER_ID })
    serveSearchPage(mock, {
      items: [],
      total: 0,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    // Zotero child notes carry no `collections` of their own — membership
    // belongs to the parent bibliographic item.
    const childIn = noteRow({
      data: { note: 'cascade risk note', parentItem: 'PARE1111', collections: [] },
    })
    const childOtherCollection = noteRow({
      key: 'NOTE2222',
      data: { note: 'cascade risk note', parentItem: 'PARE2222', collections: [] },
    })
    const childParentMissing = noteRow({
      key: 'NOTE3333',
      data: { note: 'cascade risk note', parentItem: 'PARE3333', collections: [] },
    })
    const standaloneIn = noteRow({
      key: 'NOTE4444',
      data: { note: 'cascade risk note', collections: ['COLL1234'] },
    })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([childIn, childOtherCollection, childParentMissing, standaloneIn])
      else if (search.get('itemKey') !== null) {
        // PARE3333 stays absent: an unfetchable parent (e.g. trashed) fails closed.
        // A row with no key names no parent at all and is ignored.
        helpers.json([
          item({ key: 'PARE1111', data: { collections: ['COLL1234'] } }),
          item({ key: 'PARE2222', data: { collections: ['OTHER123'] } }),
          { data: { collections: ['COLL1234'] } },
        ])
      } else helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(
      request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
    )
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
      'zotero://user/0/item/NOTE4444?server=S1',
    ])
    const parentFetch = mock.requests.find((entry) => entry.search.get('itemKey') !== null)
    expect(parentFetch?.search.get('itemKey')).toBe('PARE1111,PARE2222,PARE3333')
  })

  it('splits parent-membership lookups into itemKey batches of at most 50', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Zotero-Server-ID': SERVER_ID })
    serveSearchPage(mock, {
      items: [],
      total: 0,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    // 60 matched child notes over 59 distinct parents — one parent shared by
    // two notes proves deduplication before batching.
    const notes = Array.from({ length: 60 }, (_, i) =>
      noteRow({
        key: `NOTE${String(i).padStart(4, '0')}`,
        data: {
          note: 'cascade risk note',
          parentItem: `PARE${String(i % 59).padStart(4, '0')}`,
          collections: [],
        },
      }),
    )
    const parentFetches: string[][] = []
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        helpers.json(notes)
        return
      }
      const itemKey = search.get('itemKey')
      if (itemKey !== null) {
        const keys = itemKey.split(',')
        parentFetches.push(keys)
        helpers.json(
          keys.map((key) => item({ key, data: { collections: ['COLL1234'] } })),
          { 'Zotero-Server-ID': SERVER_ID },
        )
        return
      }
      helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(
      request({
        query: 'cascade',
        scope: { kind: 'collection', refOrName: 'LLM Papers' },
        limit: 60,
      }),
    )
    expect(result.supplemental?.items).toHaveLength(60)
    expect(parentFetches.map((keys) => keys.length).sort((a, b) => a - b)).toEqual([9, 50])
    const requested = parentFetches.flat()
    expect(new Set(requested).size).toBe(59)
    expect(requested).toContain('PARE0000')
    expect(requested).toContain('PARE0058')
  })

  it('stops the scan at the configured record cap', async () => {
    const capped = makeProvider(mock, { maxNoteScanRecords: 2 })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          noteRow({ data: { note: 'cascade one' } }),
          noteRow({ key: 'NOTE2222', data: { note: 'cascade two' } }),
          noteRow({ key: 'NOTE3333', data: { note: 'cascade three' } }),
        ])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
      'zotero://user/0/item/NOTE2222',
    ])
    expect(result.supplemental?.scanned).toBe(2)
    expect(result.supplemental?.truncated).toBe(true)
    expect(mock.requests[1]!.search.get('limit')).toBe('2')
  })

  it('treats an empty scan response as no note matches', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json({})
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(result.total).toBe(1)
  })

  it('skips non-note scan rows, tagless notes, and partial term matches', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          attachment({
            key: 'ATTACH1X',
            data: { note: 'cascade infrastructure note', tags: [{ tag: 'reviewed' }] },
          }),
          noteRow({ key: 'NOTE4444', data: { note: 'cascade without the second term' } }),
        ])
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(
      request({ query: 'cascade infrastructure', tags: ['reviewed'] }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
  })

  it('pages the scan in batches up to the cap', async () => {
    const capped = makeProvider(mock, { maxNoteScanRecords: 150 })
    const batch = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        noteRow({
          key: `NOTE${String(i).padStart(4, '0')}`,
          data: { note: 'unrelated note body' },
        }),
      )
    let scanPage = 0
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        scanPage += 1
        helpers.json(scanPage === 1 ? batch(100) : batch(30))
      } else {
        helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
      }
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
    expect(mock.requests[2]!.search.get('start')).toBe('100')
    expect(mock.requests[2]!.search.get('limit')).toBe('50')
    expectRequestCount(mock, 3)
  })

  it('requires every query term in the note body without filter interference', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([noteRow({ data: { note: 'cascade without the second term' } })])
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    // No tags or collection scope here: the only thing that can exclude the
    // note is the AND term matching itself.
    const result = await provider.search(request({ query: 'cascade infrastructure' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
  })

  it('matches note bodies case-insensitively', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([noteRow({ data: { note: 'Cascade Risk Assessment' } })])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
    ])
  })

  it('scans note bodies when note is among the requested item types', async () => {
    const note = noteRow({ data: { note: 'cascade note body' } })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([note])
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(
      request({ query: 'cascade', itemTypes: ['journalArticle', 'note'] }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111?server=S1',
    ])
  })

  it('skips the scan for punctuation-only and emoji-only queries', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const punctuated = await provider.search(request({ query: '---' }))
    const emoted = await provider.search(request({ query: '👾👾' }))
    expect(punctuated.items).toEqual([])
    expect(punctuated.supplemental).toBeUndefined()
    expect(emoted.items).toEqual([])
    expect(emoted.supplemental).toBeUndefined()
    // A query with no tokens would vacuously "match" every scanned note; the
    // scan stays off instead of flooding the page with irrelevant notes.
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toEqual([])
  })

  it('does not merge notes when the API page already fills the limit', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT])
      else helpers.json([searchHit(), searchHit(), searchHit()], { 'Total-Results': '3' })
    })
    const result = await provider.search(request({ query: 'cascade', limit: 3 }))
    expect(result.items).toHaveLength(3)
    expect(result.supplemental).toBeUndefined()
    expect(result.returned).toBe(3)
    expect(result.total).toBe(3)
    // headroom == 0: a full primary page never runs the note scan at all
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toHaveLength(0)
  })

  it('caps note matches at the remaining limit headroom beside a partial primary page', async () => {
    const NOTE_HIT_2 = noteRow({
      key: 'NOTE2222',
      data: { note: 'cascade chains in infrastructure too' },
    })
    const NOTE_HIT_3 = noteRow({ key: 'NOTE3333', data: { note: 'cascade infrastructure again' } })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([NOTE_HIT, NOTE_HIT_2, NOTE_HIT_3])
      else helpers.json([searchHit()], { 'Total-Results': '1' })
    })
    const result = await provider.search(request({ query: 'cascade', limit: 3 }))
    expect(result.items.map((entry) => entry.ref)).toEqual(['zotero://user/0/item/ABCD1234'])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
      'zotero://user/0/item/NOTE2222',
    ])
    expect(result.returned).toBe(1)
    expect(result.total).toBe(1)
  })

  it('re-fetches a scope listing once the TTL expires', async () => {
    const ttlProvider = createProvider(mock, {}, { scopeListingTtlMs: 30 })
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Zotero-Server-ID': SERVER_ID })
    serveSearchPage(mock, {
      items: [],
      total: 0,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) =>
      search.get('itemType') === 'note'
        ? helpers.json([])
        : helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': SERVER_ID }),
    )
    const searchByName = () =>
      ttlProvider.search(
        request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'LLM Papers' } }),
      )
    await searchByName()
    const first = mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections')
    expect(first).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    await searchByName()
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('re-checks the scope listing once before failing an unknown collection name', async () => {
    serveJson(mock, '/api/users/0/collections', COLLECTIONS, { 'Zotero-Server-ID': SERVER_ID })
    await zoteroError(
      provider.search(
        request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'Missing' } }),
      ),
      'ZOTERO_NOT_FOUND',
      'No collection',
    )
    // A name miss gets one fresh look in case the library changed since the
    // cached listing; the failure is only reported after that.
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(2)
  })

  it('finds a collection created after the cached listing via the miss re-check', async () => {
    let created = false
    // The listing answers per request: the first read (a miss) and the
    // re-check after `created` flips must see different bodies.
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json(created ? [collectionRow({ data: { name: 'Brand New' } })] : COLLECTIONS, {
        'Zotero-Server-ID': SERVER_ID,
      }),
    )
    serveSearchPage(mock, {
      items: [],
      total: 0,
      path: '/api/users/0/collections/COLL1234/items/top',
    })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) =>
      search.get('itemType') === 'note'
        ? helpers.json([])
        : helpers.json([], { 'Total-Results': '0', 'Zotero-Server-ID': SERVER_ID }),
    )
    await zoteroError(
      provider.search(
        request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'Brand New' } }),
      ),
      'ZOTERO_NOT_FOUND',
      'No collection',
    )
    created = true
    const result = await provider.search(
      request({ query: 'cascade', scope: { kind: 'collection', refOrName: 'Brand New' } }),
    )
    expect(result.scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'Brand New',
    })
  })
})
