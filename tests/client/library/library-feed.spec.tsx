// @vitest-environment jsdom
/** Independent request lanes, restoration and inspector lifetime. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import {
  libraryStorageKey,
  readLibraryState,
  writeLibraryState,
} from '../../../src/client/components/library/library-storage.ts'
import {
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  searchPage,
} from '../helpers/library-panel-harness.tsx'
import { deferred } from '../../helpers/sync.ts'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('list and inspector lifetime', () => {
  it.each(['library', 'scope', 'mode', 'sort', 'page', 'query', 'filter'] as const)(
    'clears the inspector on %s changes and discards a late detail',
    async (change) => {
      const old = deferred<any>()
      const { result } = setup({ item: () => old.promise })
      await waitFor(() => expect(result.current.list.phase).toBe('ready'))
      act(() => result.current.selectItem(ITEM_DETAIL.ref))
      await waitFor(() => expect(result.current.inspector?.phase).toBe('loading'))
      act(() => {
        const feed = result.current
        if (change === 'library') feed.selectLibrary({ type: 'group', id: 123 })
        if (change === 'scope') feed.selectScope({ kind: 'trash' })
        if (change === 'mode') feed.setMode('everything')
        if (change === 'sort') feed.setSort('title', 'asc')
        if (change === 'page') feed.gotoOffset(50)
        if (change === 'query') feed.setQ('new')
        if (change === 'filter') feed.setFilters({ tags: ['read'] })
      })
      await act(async () => old.resolve({ ok: true, value: ITEM_DETAIL }))
      expect(result.current.selectedRef).toBeUndefined()
      expect(result.current.inspector).toBeUndefined()
    },
  )

  it('debounces a changed query at offset zero and rejects the old list response', async () => {
    vi.useFakeTimers()
    const stale = deferred<any>()
    const search = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: searchPage() })
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue({ ok: true, value: searchPage({ items: [], total: 0, returned: 0 }) })
    const { result } = setup({ search })
    await act(async () => {})
    act(() => result.current.gotoOffset(50))
    await act(async () => {})
    act(() => result.current.setQ('updated'))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'updated', offset: 0 }))
    await act(async () => stale.resolve({ ok: true, value: searchPage({ offset: 50 }) }))
    expect(result.current.list).toMatchObject({ phase: 'ready', items: [] })
  })

  it('recovers a failed list without changing its parameters', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
      .mockResolvedValue({ ok: true, value: searchPage() })
    const { result } = setup({ search })
    await waitFor(() => expect(result.current.list.phase).toBe('error'))
    act(() => result.current.retryList())
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    expect(search.mock.calls[0]).toEqual(search.mock.calls[1])
  })
})

describe('instance preferences', () => {
  it('discards cross-instance or wrong-kind expanded refs and a group publications scope', () => {
    writeLibraryState('S1', {
      version: 2,
      library: { type: 'group', id: 123 },
      selection: { kind: 'publications' },
      q: '',
      mode: 'metadata',
      sort: 'title',
      direction: 'asc',
      offset: 50,
      filters: {},
      expanded: [
        'zotero://group/123/collection/COLL0001?server=S1',
        'zotero://group/123/collection/COLL0002?server=S2',
        'zotero://user/0/collection/COLL0001',
        'zotero://group/123/search/SEARCH01',
      ],
    })
    expect(readLibraryState('S1')).toMatchObject({
      selection: { kind: 'library' },
      offset: 0,
      expanded: ['zotero://group/123/collection/COLL0001?server=S1'],
    })
  })

  it.each(['zotero://user/0/search/SEARCH01', 'zotero://user/0/search/SEARCH01?server=S1'])(
    'restores the saved-search selection and page for %s',
    (ref) => {
      writeLibraryState('S1', {
        version: 2,
        library: { type: 'user', id: 0 },
        selection: { kind: 'savedSearch', ref, name: 'Unread' },
        q: '',
        mode: 'metadata',
        sort: 'title',
        direction: 'asc',
        offset: 50,
        expanded: [],
        filters: {},
      })
      expect(readLibraryState('S1')).toMatchObject({
        selection: { kind: 'savedSearch', ref, name: 'Unread' },
        offset: 50,
      })
    },
  )

  it('ignores malformed or cross-instance storage without blocking startup', () => {
    localStorage.setItem(libraryStorageKey('S1'), '{broken')
    expect(readLibraryState('S1')).toBeUndefined()
    localStorage.setItem(libraryStorageKey('S1'), JSON.stringify({ version: 2 }))
    expect(readLibraryState('S1')).toBeUndefined()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() =>
      writeLibraryState('S1', {
        version: 2,
        library: { type: 'user', id: 0 },
        selection: { kind: 'library' },
        q: '',
        mode: 'metadata',
        sort: 'title',
        direction: 'asc',
        offset: 0,
        expanded: [],
        filters: {},
      }),
    ).not.toThrow()
    expect(setItem).toHaveBeenCalled()
  })

  it('restores a confirmed instance and isolates another instance', async () => {
    writeLibraryState('S1', {
      version: 2,
      library: { type: 'group', id: 123 },
      selection: { kind: 'library' },
      q: 'saved',
      mode: 'everything',
      sort: 'title',
      direction: 'asc',
      offset: 50,
      expanded: [],
      filters: { yearFrom: 2020 },
    })
    const { result, face, rerender } = setup()
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    expect(face.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        library: { type: 'group', id: 123 },
        q: 'saved',
        offset: 50,
        yearFrom: 2020,
      }),
    )
    rerender({ id: 'S2' })
    await waitFor(() => expect(result.current.q).toBe(''))
    expect(result.current.currentLibrary).toEqual({ type: 'user', id: 0 })
    expect(JSON.parse(localStorage.getItem(libraryStorageKey('S1'))!).q).toBe('saved')
  })

  it('preserves a missing restored scope and exposes its error', async () => {
    writeLibraryState('S1', {
      version: 2,
      library: { type: 'user', id: 0 },
      selection: {
        kind: 'collection',
        ref: 'zotero://user/0/collection/GONE0001?server=S1',
        name: 'gone',
      },
      q: '',
      mode: 'metadata',
      sort: 'title',
      direction: 'asc',
      offset: 50,
      expanded: [],
      filters: {},
    })
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('zotero/domain', 'gone', { code: 'ZOTERO_NOT_FOUND' }),
      })
      .mockResolvedValue({ ok: true, value: searchPage() })
    const { result } = setup({ search })
    await waitFor(() => expect(result.current.list.phase).toBe('error'))
    expect(result.current.selection.kind).toBe('collection')
    expect(result.current.offset).toBe(50)
  })
})

describe('targeted recovery and write refresh', () => {
  it('reports rejected library and saved-search reads and recovers each independently', async () => {
    const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    let rejectLibraries = true,
      rejectSaved = true
    const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
      if (request.kind === 'libraries') {
        if (rejectLibraries) throw new Error('libraries disconnected')
        return { ok: true, value: LIBRARY_ROWS }
      }
      if (request.kind === 'savedSearches') {
        if (rejectSaved) return pending.promise
        return { ok: true, value: SAVED_SEARCHES }
      }
      return { ok: true, value: ROOT_COLLECTIONS }
    })
    const { result } = setup({ browse })
    await waitFor(() =>
      expect(result.current.libraries).toEqual({
        phase: 'error',
        message: 'libraries disconnected',
      }),
    )
    await act(async () => pending.reject(new Error('saved disconnected')))
    await waitFor(() =>
      expect(result.current.savedSearches).toMatchObject({
        phase: 'error',
        message: 'saved disconnected',
      }),
    )
    rejectLibraries = false
    rejectSaved = false
    act(() => {
      result.current.retryLibraries()
      result.current.retrySavedSearches()
    })
    await waitFor(() => expect(result.current.libraries.phase).toBe('ready'))
    await waitFor(() => expect(result.current.savedSearches.phase).toBe('ready'))
  })

  it('ignores library, saved-search, and tree failures superseded by a refresh', async () => {
    const pendingLibraries = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const pendingSaved = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const pendingTree = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    let first = true
    const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
      if (first)
        return request.kind === 'libraries'
          ? pendingLibraries.promise
          : request.kind === 'savedSearches'
            ? pendingSaved.promise
            : pendingTree.promise
      return {
        ok: true,
        value:
          request.kind === 'libraries'
            ? LIBRARY_ROWS
            : request.kind === 'savedSearches'
              ? SAVED_SEARCHES
              : ROOT_COLLECTIONS,
      }
    })
    const { result } = setup({ browse })
    await waitFor(() => expect(browse).toHaveBeenCalledTimes(3))
    first = false
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.libraries.phase).toBe('ready'))
    await act(async () => {
      pendingLibraries.reject(new Error('old library error'))
      pendingSaved.reject(new Error('old saved error'))
      pendingTree.reject(new Error('old tree error'))
    })
    expect(result.current.libraries.phase).toBe('ready')
    expect(result.current.savedSearches.phase).toBe('ready')
    expect(result.current.treeLane(undefined)?.phase).toBe('ready')
  })

  it('falls back to the first available library when a restored group is no longer listed', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectLibrary({ type: 'group', id: 999 }))
    await waitFor(() => expect(result.current.currentLibrary).toEqual({ type: 'user', id: 0 }))
  })

  it('keeps a failed library search visible and ignores an inspector rejection after deselection', async () => {
    const item = deferred<Awaited<ReturnType<LibraryFeedFace['item']>>>()
    const search = vi.fn<LibraryFeedFace['search']>().mockResolvedValue({
      ok: false,
      error: new RemoteError('zotero/domain', 'scope missing', { code: 'ZOTERO_NOT_FOUND' }),
    })
    const { result } = setup({ search, item: () => item.promise })
    await waitFor(() =>
      expect(result.current.list).toEqual({ phase: 'error', message: 'scope missing' }),
    )
    expect(result.current.selection).toEqual({ kind: 'library' })
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    act(() => result.current.selectItem(undefined))
    await act(async () => item.reject(new Error('late inspector failure')))
    expect(result.current.inspector).toBeUndefined()
  })
  it('retains the tree page after a rejected page request and retries that offset', async () => {
    const { result, face } = setup({
      browse: async (request) => ({
        ok: true,
        value:
          request.kind === 'libraries'
            ? LIBRARY_ROWS
            : request.kind === 'savedSearches'
              ? SAVED_SEARCHES
              : {
                  ...ROOT_COLLECTIONS,
                  total: 3,
                  ...(request.offset === 0
                    ? { nextOffset: 2 }
                    : {
                        offset: 2,
                        returned: 1,
                        items: [
                          {
                            ...ROOT_COLLECTIONS.items[0]!,
                            ref: 'zotero://user/0/collection/COLL0003',
                          },
                        ],
                      }),
                },
      }),
    })
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    face.browse = vi.fn(face.browse)
    vi.mocked(face.browse).mockRejectedValueOnce(new Error('tree disconnected'))
    act(() => result.current.loadMoreTree(undefined))
    await waitFor(() =>
      expect(result.current.treeLane(undefined)).toMatchObject({
        phase: 'error',
        message: 'tree disconnected',
        previous: { rows: ROOT_COLLECTIONS.items },
      }),
    )
    act(() => result.current.retryTree(undefined))
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    expect(face.browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'collections', offset: 2 }),
    )
  })

  it.each(['items', 'collections', 'savedSearches'] as const)(
    'refreshes only the affected navigation lane after a %s write',
    async (kind) => {
      const invalidate = vi.fn()
      const { result, face } = setup({ invalidate })
      await waitFor(() => expect(result.current.list.phase).toBe('ready'))
      act(() => result.current.toggleCollection('zotero://user/0/collection/COLL0001'))
      await waitFor(() =>
        expect(result.current.treeLane('zotero://user/0/collection/COLL0001')?.phase).toBe('ready'),
      )
      act(() => result.current.selectItem(ITEM_DETAIL.ref))
      await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
      const browse = vi.mocked(face.browse),
        search = vi.mocked(face.search),
        item = vi.mocked(face.item)
      browse.mockClear()
      search.mockClear()
      item.mockClear()
      act(() => result.current.refreshAffected(kind))
      await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(item).toHaveBeenCalledTimes(1))
      expect(invalidate).toHaveBeenCalledTimes(1)
      const kinds = browse.mock.calls.map(([request]) => request.kind)
      expect(kinds).toEqual(
        kind === 'items'
          ? []
          : kind === 'collections'
            ? ['collections', 'savedSearches', 'collections']
            : ['collections', 'savedSearches', 'collections'],
      )
      expect(result.current.selectedRef).toBe(ITEM_DETAIL.ref)
    },
  )

  it('retries the library list, search and inspector without resetting selection', async () => {
    const { result, face } = setup()
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    vi.mocked(face.browse).mockClear()
    vi.mocked(face.search).mockClear()
    vi.mocked(face.item).mockClear()
    act(() => result.current.retryLibraries())
    await waitFor(() => expect(face.browse).toHaveBeenCalledTimes(1))
    expect(face.browse).toHaveBeenLastCalledWith({ kind: 'libraries', offset: 0, limit: 50 })
    act(() => result.current.retryList())
    await waitFor(() => expect(face.search).toHaveBeenCalledTimes(1))
    act(() => result.current.retryInspector())
    await waitFor(() => expect(face.item).toHaveBeenCalledTimes(1))
    expect(result.current.selectedRef).toBe(ITEM_DETAIL.ref)
  })
})
