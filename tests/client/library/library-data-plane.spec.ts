/**
 * The library panel's shared data plane: identical in-flight reads collapse
 * into one wire call, settled reads answer identical requests inside a short
 * window, `invalidate()` ends both, and a failure is never cached.
 * @module tests/client/library/library-data-plane
 */

import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createLibraryDataPlane } from '../../../src/client/components/library/library-data-plane.ts'
import type { LibraryPanelWireFace } from '../../../src/client/components/library/library-feed-types.ts'
import { browseResult, itemDetail, searchResult } from '../../helpers/library-fixtures.js'
import { deferred } from '../../helpers/sync.js'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/** The export request/result the export-cache cases share. */
const EXPORT_REQUEST = { refs: ['zotero://user/0/item/ABCD1234'], format: 'citation' as const }

function exportResult() {
  return ok({
    format: 'citation' as const,
    citations: [{ ref: 'zotero://user/0/item/ABCD1234', text: 'Dao, T. (2023).' }],
  })
}

function face(): Record<
  'browse' | 'search' | 'item' | 'childPage' | 'export',
  ReturnType<typeof vi.fn>
> {
  return {
    browse: vi.fn(async () => ok(browseResult())),
    search: vi.fn(async () => ok(searchResult())),
    item: vi.fn(async () => ok(itemDetail())),
    childPage: vi.fn(async (request: { kind: string; offset: number; limit: number }) =>
      ok({
        kind: request.kind,
        page: { total: 0, returned: 0, offset: request.offset, limit: request.limit, items: [] },
      }),
    ),
    export: vi.fn(async () => exportResult()),
  }
}

function planeOf(
  underlying: Record<
    'browse' | 'search' | 'item' | 'childPage' | 'export',
    ReturnType<typeof vi.fn>
  >,
) {
  return createLibraryDataPlane(underlying as unknown as LibraryPanelWireFace)
}

describe('the library data plane', () => {
  it('bumps the host filtered-search generation when the shared cache is invalidated', async () => {
    const underlying = face(),
      plane = planeOf(underlying)
    const query = {
      scope: { kind: 'library' as const },
      sort: 'title' as const,
      direction: 'asc' as const,
      offset: 0,
      limit: 50,
      yearFrom: 2020,
    }
    await plane.search(query)
    expect(underlying.search).toHaveBeenLastCalledWith({ ...query, cacheGeneration: 0 })
    plane.invalidate()
    await plane.search(query)
    expect(underlying.search).toHaveBeenLastCalledWith({ ...query, cacheGeneration: 1 })
  })
  it('keeps a fresh response cached when an invalidated read finishes later', async () => {
    const stale = deferred<RemoteResult<unknown>>()
    const underlying = face()
    underlying.item.mockReturnValueOnce(stale.promise)
    const plane = planeOf(underlying)
    const request = { ref: 'zotero://user/0/item/ABCD1234', include: [], childPages: {} }
    const old = plane.item(request)
    plane.invalidate()
    const fresh = await plane.item(request)
    stale.resolve(ok(itemDetail({ title: 'Old title' })))
    await old
    expect(await plane.item(request)).toEqual(fresh)
    expect(underlying.item).toHaveBeenCalledTimes(2)
  })
  it('collapses identical in-flight reads into one wire call', async () => {
    const underlying = face()
    let release: ((value: RemoteResult<unknown>) => void) | undefined
    underlying.browse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const plane = planeOf(underlying)
    const request = {
      kind: 'tags' as const,
      library: { type: 'user' as const, id: 0 as const },
      offset: 0,
      limit: 50,
    }
    const first = plane.browse(request)
    const second = plane.browse(request)
    release?.(ok(browseResult()))
    const [a, b] = await Promise.all([first, second])
    expect(underlying.browse).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('answers an identical later request from the short-lived cache', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    const request = {
      scope: { kind: 'library' as const },
      sort: 'title' as const,
      direction: 'asc' as const,
      offset: 0,
      limit: 50,
    }
    await plane.search(request)
    await plane.search(request)
    expect(underlying.search).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after invalidate and for a different request', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    const request = { ref: 'zotero://user/0/item/ABCD1234', include: [], childPages: {} }
    await plane.item(request)
    await plane.item(request)
    expect(underlying.item).toHaveBeenCalledTimes(1)
    plane.invalidate()
    await plane.item(request)
    expect(underlying.item).toHaveBeenCalledTimes(2)
    await plane.item({ ...request, ref: 'zotero://user/0/item/EFGH5678' })
    expect(underlying.item).toHaveBeenCalledTimes(3)
  })

  it('never caches a failure, so retry re-requests', async () => {
    const underlying = face()
    underlying.search.mockRejectedValue(new Error('loopback reset'))
    const plane = planeOf(underlying)
    const request = {
      scope: { kind: 'library' as const },
      sort: 'title' as const,
      direction: 'asc' as const,
      offset: 0,
      limit: 50,
    }
    await expect(plane.search(request)).rejects.toThrow('loopback reset')
    underlying.search.mockResolvedValue(ok(searchResult()))
    await expect(plane.search(request)).resolves.toEqual(ok(searchResult()))
    expect(underlying.search).toHaveBeenCalledTimes(2)
  })

  it('re-keys the cache on an instance change, so a restart never answers from the old Zotero', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    const request = { ref: 'zotero://user/0/item/ABCD1234', include: [], childPages: {} }
    plane.setInstance('S1')
    await plane.item(request)
    // The same instance answers from the cache.
    await plane.item(request)
    expect(underlying.item).toHaveBeenCalledTimes(1)
    // A different confirmed instance re-fetches: the identity invariant
    // forbids mixing two Zotero instances in one result.
    plane.setInstance('S2')
    await plane.item(request)
    expect(underlying.item).toHaveBeenCalledTimes(2)
    // Back to the first instance: its entries were cleared with the re-key.
    plane.setInstance('S1')
    await plane.item(request)
    expect(underlying.item).toHaveBeenCalledTimes(3)
  })

  it('serves one child-page read per identical window and re-fetches across instances', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    const request = {
      ref: 'zotero://user/0/item/ABCD1234',
      kind: 'notes' as const,
      offset: 0,
      limit: 50,
    }
    plane.setInstance('S1')
    await plane.childPage(request)
    await plane.childPage(request)
    expect(underlying.childPage).toHaveBeenCalledTimes(1)
    plane.setInstance('S2')
    await plane.childPage(request)
    expect(underlying.childPage).toHaveBeenCalledTimes(2)
  })

  it('prunes expired entries and caps the settled map', async () => {
    vi.useFakeTimers()
    try {
      const underlying = face()
      const plane = planeOf(underlying)
      const request = (index: number) => ({
        ref: `zotero://user/0/item/ITEM${String(index).padStart(4, '0')}`,
        include: [] as [],
        childPages: {},
      })
      // Fill past the cap with distinct item reads.
      for (let index = 0; index < 130; index += 1) await plane.item(request(index))
      expect(underlying.item).toHaveBeenCalledTimes(130)
      // The oldest entries were evicted, so item 0 re-fetches; the newest
      // entries are still cached.
      await plane.item(request(0))
      expect(underlying.item).toHaveBeenCalledTimes(131)
      await plane.item(request(129))
      expect(underlying.item).toHaveBeenCalledTimes(131)
      // Expiry prunes on the next call even below the cap.
      vi.setSystemTime(Date.now() + 11_000)
      await plane.item(request(129))
      expect(underlying.item).toHaveBeenCalledTimes(132)
    } finally {
      vi.useRealTimers()
    }
  })

  it('collapses identical in-flight export reads into one wire call', async () => {
    const underlying = face()
    let release: ((value: RemoteResult<unknown>) => void) | undefined
    underlying.export.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const plane = planeOf(underlying)
    const first = plane.export(EXPORT_REQUEST)
    const second = plane.export(EXPORT_REQUEST)
    release?.(exportResult())
    const [a, b] = await Promise.all([first, second])
    expect(underlying.export).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('answers an identical later export request from the settled cache', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    await plane.export(EXPORT_REQUEST)
    await plane.export(EXPORT_REQUEST)
    expect(underlying.export).toHaveBeenCalledTimes(1)
  })

  it('expires a settled export after its ten-second TTL', async () => {
    vi.useFakeTimers()
    try {
      const underlying = face()
      const plane = planeOf(underlying)
      await plane.export(EXPORT_REQUEST)
      await plane.export(EXPORT_REQUEST)
      expect(underlying.export).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 11_000)
      await plane.export(EXPORT_REQUEST)
      expect(underlying.export).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-fetches an export after invalidate and for a different format', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    await plane.export(EXPORT_REQUEST)
    await plane.export(EXPORT_REQUEST)
    expect(underlying.export).toHaveBeenCalledTimes(1)
    plane.invalidate()
    await plane.export(EXPORT_REQUEST)
    expect(underlying.export).toHaveBeenCalledTimes(2)
    await plane.export({ ...EXPORT_REQUEST, format: 'bibtex' })
    expect(underlying.export).toHaveBeenCalledTimes(3)
  })

  it('re-keys the export cache on an instance change, so a restart never answers from the old Zotero', async () => {
    const underlying = face()
    const plane = planeOf(underlying)
    plane.setInstance('S1')
    await plane.export(EXPORT_REQUEST)
    await plane.export(EXPORT_REQUEST)
    expect(underlying.export).toHaveBeenCalledTimes(1)
    plane.setInstance('S2')
    await plane.export(EXPORT_REQUEST)
    expect(underlying.export).toHaveBeenCalledTimes(2)
    plane.setInstance('S1')
    await plane.export(EXPORT_REQUEST)
    expect(underlying.export).toHaveBeenCalledTimes(3)
  })

  it('never caches a failed export, so retry re-requests', async () => {
    const underlying = face()
    underlying.export.mockRejectedValueOnce(new Error('loopback reset'))
    const plane = planeOf(underlying)
    await expect(plane.export(EXPORT_REQUEST)).rejects.toThrow('loopback reset')
    await expect(plane.export(EXPORT_REQUEST)).resolves.toEqual(exportResult())
    expect(underlying.export).toHaveBeenCalledTimes(2)
  })
})
