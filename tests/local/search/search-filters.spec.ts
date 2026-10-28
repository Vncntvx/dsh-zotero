/**
 * Exact panel filters run over the filtered-search index: the first request
 * for a filter definition scans the whole candidate stream once (concurrently
 * by page), and later pages of the same definition slice the stored
 * candidates and fetch rows in batched `itemKey=` reads — never one probe per
 * candidate, and never a rescan per page.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../../src/http-client.js'
import { ZOTERO_UNEXPECTED } from '../../../src/errors.js'
import { runSearch } from '../../../src/local/search-domain.js'
import { createSearchIndexCaches } from '../../../src/local/search-index.js'
import { ScopeDirectory } from '../../../src/local/scope-directory.js'
import { PROVIDER_LIMITS, request } from '../../helpers/provider-harness.js'
import type { ZoteroSearchOptions } from '../../../src/types.js'
import { attachment, searchHit } from '../../helpers/server/objects.js'

const LISTING_PAGE = 100

function setup(total = 250) {
  const rows = Array.from({ length: total }, (_, i) =>
    searchHit({
      key: `ITEM${String(i).padStart(4, '0')}`,
      // Exactly three 2023 candidates, one of which carries an attachment.
      data: { title: `Paper ${i}`, date: i >= 100 && i <= 102 ? '2023' : '2020' },
      meta: { parsedDate: i >= 100 && i <= 102 ? '2023' : '2020' },
    }),
  )
  // Two candidates carry attachments; every other candidate has none.
  const attachmentRows = [
    attachment({ key: 'ATTA0001', data: { parentItem: 'ITEM0101' } }),
    attachment({ key: 'ATTA0002', data: { parentItem: 'ITEM0050' } }),
  ]
  // Version knobs per wire surface: the candidate listing, the batched row
  // reads, and the attachment walk report their own Last-Modified-Version, so
  // a test can drift one of them against the stored index.
  const listingVersion = { current: 7 }
  const batchVersion = { current: 7 }
  const walkVersion = { current: 7 }
  const getJson = vi.fn(
    async (
      path: string,
      params?: URLSearchParams,
      options?: { serverId?: string; signal?: AbortSignal },
    ) => {
      options?.signal?.throwIfAborted()
      if (path.endsWith('/children')) {
        throw new Error('exact filters must not probe /children per candidate')
      }
      const headers = new Headers({
        'Total-Results': '0',
        'Zotero-Server-ID': 'S1',
        'Last-Modified-Version': '7',
      })
      // The attachment index walk: one paginated `/items?itemType=attachment`.
      if (path.endsWith('/items') && params?.get('itemType') === 'attachment') {
        const start = Number(params.get('start') ?? 0)
        const limit = Number(params.get('limit') ?? LISTING_PAGE)
        headers.set('Total-Results', String(attachmentRows.length))
        headers.set('Last-Modified-Version', String(walkVersion.current))
        return { json: attachmentRows.slice(start, start + limit), headers }
      }
      // The batched row fetch for one stored-index page.
      const itemKey = params?.get('itemKey')
      if (itemKey !== null && itemKey !== undefined && itemKey !== '') {
        const keys = itemKey.split(',')
        expect(params?.get('limit')).toBe('50')
        headers.set('Total-Results', String(keys.length))
        headers.set('Last-Modified-Version', String(batchVersion.current))
        return { json: rows.filter((row) => keys.includes(String(row.key))), headers }
      }
      // The candidate listing itself.
      const start = Number(params?.get('start') ?? 0)
      const limit = Number(params?.get('limit') ?? LISTING_PAGE)
      headers.set('Total-Results', String(total))
      headers.set('Last-Modified-Version', String(listingVersion.current))
      return { json: rows.slice(start, start + limit), headers }
    },
  )
  const client = { getJson } as unknown as ZoteroHttpClient
  const directory = new ScopeDirectory(
    client,
    () => 60_000,
    () => 2,
  )
  // One cache set per provider: the spec's `search` calls share it, exactly
  // like the single `LocalApiProvider` instance the panel talks to.
  const searchCaches = createSearchIndexCaches()
  const listingStarts = (): (string | undefined)[] =>
    getJson.mock.calls
      .filter(([path]) => path.endsWith('/items/top'))
      .map((call) => call[1]?.get('start') ?? undefined)
  const attachmentWalks = (): number =>
    getJson.mock.calls.filter(
      ([path, params]) => path.endsWith('/items') && params?.get('itemType') === 'attachment',
    ).length
  return {
    getJson,
    listingStarts,
    attachmentWalks,
    listingVersion,
    batchVersion,
    walkVersion,
    rows,
    attachmentRows,
    search: (
      overrides: Parameters<typeof request>[0] & Partial<ZoteroSearchOptions> = {},
      signal?: AbortSignal,
    ) => {
      const { includeSupplemental, cacheGeneration, ...rest } = overrides
      return runSearch(
        { client, limits: PROVIDER_LIMITS, searchCaches },
        directory,
        request(rest),
        signal,
        {
          // The panel always opts out of the note supplement; tests that
          // exercise the refusal pass `includeSupplemental: true` explicitly.
          includeSupplemental: includeSupplemental ?? false,
          ...(cacheGeneration !== undefined ? { cacheGeneration } : {}),
        },
      )
    },
  }
}

describe('exact panel filters', () => {
  it.each(['refresh', 'version drift'] as const)(
    'refreshes attachment presence after %s',
    async (trigger) => {
      const world = setup()
      const query = { yearFrom: 2023, hasAttachment: false, limit: 1 }
      const first = await world.search(query)
      expect(first.total).toBe(2)
      world.attachmentRows.push(attachment({ key: 'ATTA0003', data: { parentItem: 'ITEM0100' } }))
      if (trigger === 'version drift') {
        const original = world.getJson.getMockImplementation()!
        world.getJson.mockImplementation(async (...args) => {
          const response = await original(...args)
          response.headers.set('Last-Modified-Version', '8')
          return response
        })
      }
      const result = await world.search({
        ...query,
        ...(trigger === 'refresh' ? { cacheGeneration: 1 } : {}),
      })
      expect(result.total).toBe(1)
      expect(result.items[0]?.ref).toContain('ITEM0102')
      expect(
        world.getJson.mock.calls.filter(([, params]) => params?.get('itemType') === 'attachment'),
      ).toHaveLength(2)
    },
  )

  it('refuses attachment facts from a different library revision than the candidate scan', async () => {
    const world = setup()
    const original = world.getJson.getMockImplementation()!
    world.getJson.mockImplementation(async (...args) => {
      const response = await original(...args)
      if (args[1]?.get('itemType') === 'attachment') {
        response.headers.set('Last-Modified-Version', '8')
      }
      return response
    })
    await expect(world.search({ hasAttachment: true })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
    })
  })

  it('bounds distinct filtered indexes and rescans an evicted listing', async () => {
    const { search, listingStarts } = setup()
    for (let generation = 0; generation < 5; generation += 1) {
      await search({ yearFrom: 2023, cacheGeneration: generation })
    }
    expect(listingStarts()).toHaveLength(15)
    const result = await search({ yearFrom: 2023, cacheGeneration: 0 })
    expect(listingStarts()).toHaveLength(18)
    expect(result.total).toBe(3)
  })

  it('rescans a cached listing once when the batched read proves a newer library version', async () => {
    const world = setup()
    await world.search({ yearFrom: 2023, limit: 1 })
    const original = world.getJson.getMockImplementation()!
    world.getJson.mockImplementation(async (...args) => {
      const response = await original(...args)
      response.headers.set('Last-Modified-Version', '8')
      return response
    })
    const result = await world.search({ yearFrom: 2023, offset: 1, limit: 1 })
    expect(world.listingStarts()).toEqual(['0', '100', '200', '0', '100', '200'])
    expect(result.items[0]?.ref).toContain('ITEM0101')
  })

  it('scans once per filter definition and serves later pages from the index', async () => {
    const { search, getJson, listingStarts } = setup()
    const first = await search({ yearFrom: 2023, yearTo: 2023, offset: 1, limit: 1 })
    // The domain result carries no `limit`; the library service's view adds
    // the effective page size (asserted in the host service spec).
    expect(first).toMatchObject({ total: 3, returned: 1, offset: 1, nextOffset: 2 })
    expect(first.items[0]?.ref).toContain('ITEM0101')
    // One concurrent scan: the first page plus the two offset pages.
    expect(listingStarts()).toEqual(['0', '100', '200'])

    // A second page of the same filter definition costs one batched key
    // read and no rescan.
    const second = await search({ yearFrom: 2023, yearTo: 2023, offset: 2, limit: 1 })
    expect(second).toMatchObject({ total: 3, offset: 2, returned: 1 })
    expect(second.items[0]?.ref).toContain('ITEM0102')
    expect(listingStarts()).toEqual(['0', '100', '200'])
    const batchCalls = getJson.mock.calls.filter(([, params]) => params?.get('itemKey') !== null)
    expect(batchCalls).toHaveLength(2)
    expect(batchCalls[0]?.[1]?.get('itemKey')).toBe('ITEM0101')
    expect(batchCalls[1]?.[1]?.get('itemKey')).toBe('ITEM0102')
  })

  it('rescans once when the panel bumps its data generation', async () => {
    const { search, listingStarts } = setup()
    await search({ yearFrom: 2023, yearTo: 2023, offset: 0, limit: 1, cacheGeneration: 1 })
    expect(listingStarts()).toEqual(['0', '100', '200'])
    await search({ yearFrom: 2023, yearTo: 2023, offset: 0, limit: 1, cacheGeneration: 2 })
    // A bumped generation is a new filter definition: one fresh scan.
    expect(listingStarts()).toEqual(['0', '100', '200', '0', '100', '200'])
  })

  it('expires the stored index after its ttl', async () => {
    vi.useFakeTimers()
    try {
      const { search, listingStarts } = setup()
      await search({ yearFrom: 2023, yearTo: 2023, offset: 0, limit: 1 })
      vi.setSystemTime(Date.now() + 31_000)
      await search({ yearFrom: 2023, yearTo: 2023, offset: 0, limit: 1 })
      expect(listingStarts()).toEqual(['0', '100', '200', '0', '100', '200'])
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([true, false])(
    'uses an attachment index instead of per-candidate probes for hasAttachment=%s',
    async (hasAttachment) => {
      const { search, getJson } = setup()
      const result = await search({ yearFrom: 2023, hasAttachment, limit: 50 })
      expect(result.total).toBe(hasAttachment ? 1 : 2)
      expect(result.items.map((item) => item.ref.includes('ITEM0101'))).toEqual(
        hasAttachment ? [true] : [false, false],
      )
      // The existence fact rides one paginated attachment index, and the
      // page rows ride one batched key read: no `/children` probes at all.
      const indexCalls = getJson.mock.calls.filter(
        ([path, params]) => path.endsWith('/items') && params?.get('itemType') === 'attachment',
      )
      expect(indexCalls).toHaveLength(1)
      const batchCalls = getJson.mock.calls.filter(([, params]) => params?.get('itemKey') !== null)
      expect(batchCalls).toHaveLength(1)
    },
  )

  it.each(['all', 'any'] as const)(
    'preserves type, tag %s, exclusion and sort parameters on every candidate page',
    async (tagMatch) => {
      const { search, getJson } = setup()
      await search({
        yearTo: 2024,
        itemTypes: ['book', 'report'],
        tags: ['read', '-draft'],
        excludeTags: ['hidden'],
        tagMatch,
        sort: 'title',
        direction: 'asc',
      })
      const listingCalls = getJson.mock.calls.filter(([path]) => path.endsWith('/items/top'))
      expect(listingCalls.length).toBeGreaterThan(0)
      for (const [, params] of listingCalls) {
        expect(params?.get('itemType')).toBe('book || report')
        expect(params?.getAll('tag')).toEqual(
          tagMatch === 'all' ? ['read', '\\-draft', '-hidden'] : ['read || \\-draft', '-hidden'],
        )
        expect(params?.get('sort')).toBe('title')
        expect(params?.get('direction')).toBe('asc')
      }
    },
  )

  it('fails loud after one rescan when the library keeps drifting from the index', async () => {
    const world = setup()
    // The listing keeps reporting the full candidate set, but every batched
    // row read comes back empty: the stored keys can no longer be served, so
    // the index is dropped and rescanned exactly once before the breach is
    // reported.
    world.getJson.mockImplementation(async (path: string, params?: URLSearchParams) => {
      const itemKey = params?.get('itemKey')
      if (itemKey !== null && itemKey !== undefined) {
        return {
          json: [],
          headers: new Headers({
            'Total-Results': '0',
            'Zotero-Server-ID': 'S1',
            'Last-Modified-Version': '7',
          }),
        }
      }
      const start = Number(params?.get('start') ?? 0)
      const limit = Number(params?.get('limit') ?? LISTING_PAGE)
      return {
        json: world.rows.slice(start, start + limit),
        headers: new Headers({
          'Total-Results': String(world.rows.length),
          'Zotero-Server-ID': 'S1',
          'Last-Modified-Version': '7',
        }),
      }
    })
    await expect(world.search({ yearFrom: 2023, yearTo: 2023, limit: 1 })).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
    })
  })

  it('rejects inverted year bounds and cancellation without returning a partial total', async () => {
    const { search } = setup()
    await expect(search({ yearFrom: 2024, yearTo: 2023 })).rejects.toMatchObject({
      code: 'ZOTERO_INVALID_ARGUMENT',
    })
    const controller = new AbortController()
    controller.abort()
    await expect(search({ hasAttachment: true }, controller.signal)).rejects.toThrow()
  })

  it('refuses the note supplement beside exact filters instead of dropping it silently', async () => {
    const { search } = setup()
    await expect(search({ yearFrom: 2023, includeSupplemental: true, limit: 1 })).rejects.toThrow(
      'note-body supplement',
    )
  })

  it('reuses the stored candidates when only the year range moves', async () => {
    const { search, listingStarts } = setup()
    const first = await search({ yearFrom: 2023, limit: 1 })
    expect(first.total).toBe(3)
    const second = await search({ yearFrom: 2023, yearTo: 2023, limit: 1 })
    expect(second.total).toBe(3)
    // One scan answers every year definition over the same candidates.
    expect(listingStarts()).toEqual(['0', '100', '200'])
  })

  it('reuses presence facts across attachment toggles and rescans the dimension once', async () => {
    const { search, listingStarts, attachmentWalks } = setup()
    const withAttachment = await search({ yearFrom: 2023, hasAttachment: true, limit: 1 })
    expect(withAttachment.total).toBe(1)
    const walksAfterFirst = attachmentWalks()
    expect(walksAfterFirst).toBeGreaterThan(0)
    // The opposite value reads the same stored presence facts: no new walk,
    // no new candidate scan.
    const withoutAttachment = await search({ yearFrom: 2023, hasAttachment: false, limit: 1 })
    expect(withoutAttachment.total).toBe(2)
    expect(attachmentWalks()).toBe(walksAfterFirst)
    expect(listingStarts()).toEqual(['0', '100', '200'])
    // Turning the dimension off is a different index: the candidate stream is
    // re-read without an attachment walk.
    await search({ yearFrom: 2023, limit: 1 })
    expect(attachmentWalks()).toBe(walksAfterFirst)
    expect(listingStarts()).toHaveLength(6)
  })

  it('drops a stale attachment cache and re-reads presence once', async () => {
    const world = setup()
    const { search, listingVersion, walkVersion, batchVersion, attachmentWalks } = world
    const first = await search({ yearFrom: 2023, hasAttachment: true, limit: 1 })
    expect(first.total).toBe(1)
    const walksAfterFirst = attachmentWalks()
    // The library moves on (the candidate scan now reads version 8) while the
    // stored presence set still says 7: the scan's version fence drops the
    // cached walk, one re-read answers, and the page still serves.
    listingVersion.current = 8
    walkVersion.current = 8
    batchVersion.current = 8
    const second = await search({ yearFrom: 2023, hasAttachment: true, offset: 0, limit: 1 })
    expect(second.total).toBe(1)
    expect(attachmentWalks()).toBeGreaterThan(walksAfterFirst)
  })

  it('fails loud when the refetched presence still disagrees with the candidate scan', async () => {
    const { search, listingVersion, batchVersion, attachmentWalks } = setup()
    const first = await search({ yearFrom: 2023, hasAttachment: true, limit: 1 })
    expect(first.total).toBe(1)
    const walksAfterFirst = attachmentWalks()
    // The candidate scan and the batched rows move to version 8 while the
    // presence walk keeps answering version 7: the stale cache is dropped,
    // the re-read still disagrees, and the scan fails loud instead of mixing
    // revisions.
    listingVersion.current = 8
    batchVersion.current = 8
    await expect(
      search({ yearFrom: 2023, hasAttachment: true, offset: 0, limit: 1 }),
    ).rejects.toThrow('attachment presence was indexed')
    expect(attachmentWalks()).toBeGreaterThan(walksAfterFirst)
  })

  it('fails loud when a rescan cannot reconcile the stored index with the rows', async () => {
    const { search, batchVersion } = setup()
    const first = await search({ yearFrom: 2023, limit: 1 })
    expect(first.total).toBe(3)
    // The stored index reads version 7 while every batched row read now
    // answers 8: the page drifts, the one allowed rescan rebuilds the index
    // from the same version-7 listing, and the second serve still drifts.
    batchVersion.current = 8
    await expect(
      search({ yearFrom: 2023, hasAttachment: false, offset: 0, limit: 1 }),
    ).rejects.toThrow('The library changed while a filtered search page was served')
  })
})
