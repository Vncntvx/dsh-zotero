// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  ROOT_COLLECTIONS,
  LIBRARY_ROWS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import {
  readLibraryState,
  writeLibraryState,
} from '../../../src/client/components/library/library-storage.ts'
import type { ZoteroCollectionRowView } from '../../../src/contract.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
const parent = ROOT_COLLECTIONS.items[1] as ZoteroCollectionRowView
const target: ZoteroCollectionRowView = {
  kind: 'collection',
  ref: 'zotero://user/0/collection/DEEP0001',
  name: 'Current',
  parentRef: parent.ref,
  path: [parent.name, 'Current'],
  depth: 1,
}
function store() {
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: { kind: 'collection', ref: target.ref, name: 'Old name' },
    q: 'retained',
    filters: { tags: ['read'] },
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
}
function scripted(): LibraryFeedFace['browse'] {
  return vi.fn<LibraryFeedFace['browse']>(async (request) => {
    if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
    if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
    const all = request.parentRef ? [target] : ROOT_COLLECTIONS.items
    return {
      ok: true,
      value: {
        ...ROOT_COLLECTIONS,
        total: all.length,
        returned: 1,
        items: all.slice(request.offset, request.offset + 1),
        offset: request.offset,
        ...(request.offset + 1 < all.length ? { nextOffset: request.offset + 1 } : {}),
      },
    }
  })
}
it('locates a restored deep scope through real parent rows and sequential root pages', async () => {
  store()
  const collectionPath = vi.fn<LibraryFeedFace['collectionPath']>(async (request) => ({
    ok: true,
    value: { library: request.library, libraryVersion: 1, path: [parent, target] },
  }))
  const { result } = setupLibraryFeed({ browse: scripted(), collectionPath })
  await waitFor(() => expect(result.current.locatedRef).toBe(target.ref))
  expect(result.current.flatTree.map((entry) => entry.row.ref)).toContain(target.ref)
  expect(result.current.selection).toMatchObject({ name: 'Current', path: target.path })
  expect(result.current.q).toBe('retained')
  expect(result.current.filters).toEqual({ tags: ['read'] })
  expect(Object.values(readLibraryState('S1')!.prefixes!)).toContain(2)
})
it('keeps a user collapse when a pending restored path finishes', async () => {
  store()
  const response = deferred<Awaited<ReturnType<LibraryFeedFace['collectionPath']>>>()
  const { result, face } = setupLibraryFeed({
    browse: scripted(),
    collectionPath: () => response.promise,
  })
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  await waitFor(() => expect(face.collectionPath).toBeDefined())
  act(() => result.current.toggleCollection(parent.ref))
  act(() => result.current.toggleCollection(parent.ref))
  await act(async () =>
    response.resolve({
      ok: true,
      value: { library: { type: 'user', id: 0 }, libraryVersion: 1, path: [parent, target] },
    }),
  )
  expect(result.current.expanded.has(parent.ref)).toBe(false)
  expect(result.current.locatedRef).toBeUndefined()
})
it('reports a missing path without silently selecting all items', async () => {
  store()
  const { result } = setupLibraryFeed({
    collectionPath: async () => ({
      ok: false,
      error: new RemoteError('zotero/domain', 'Collection no longer exists', {
        code: 'ZOTERO_NOT_FOUND',
      }),
    }),
  })
  await waitFor(() => expect(result.current.locateError).toBe('Collection no longer exists'))
  expect(result.current.selection.kind).toBe('collection')
  act(() => result.current.selectScope({ kind: 'library' }))
  expect(result.current.selection.kind).toBe('library')
})
it('keeps a path transport failure retryable through the locate action', async () => {
  store()
  const collectionPath = vi
    .fn<LibraryFeedFace['collectionPath']>()
    .mockRejectedValueOnce(new Error('disconnected'))
    .mockResolvedValue({
      ok: true,
      value: { library: { type: 'user', id: 0 }, libraryVersion: 1, path: [parent, target] },
    })
  const { result } = setupLibraryFeed({ browse: scripted(), collectionPath })
  await waitFor(() => expect(result.current.locateError).toBe('disconnected'))
  act(() => result.current.locate())
  await waitFor(() => expect(result.current.locatedRef).toBe(target.ref))
  expect(result.current.narrowPane).toBe('tree')
})
it('rejects an old filter editor callback after switching scope', async () => {
  const { result } = setupLibraryFeed()
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  const previousChange = result.current.setFilters
  act(() => result.current.selectScope({ kind: 'trash' }))
  act(() => previousChange({ yearFrom: 2020 }))
  expect(result.current.filters).toEqual({})
})

it('finds a saved search on a later page and refreshes its current name', async () => {
  const searchRef = 'zotero://user/0/search/SEARCH02'
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: { kind: 'savedSearch', ref: searchRef, name: 'Old' },
    q: '',
    filters: {},
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
  const { result } = setupLibraryFeed({
    browse: async (request) => {
      if (request.kind !== 'savedSearches') return scripted()(request)
      return {
        ok: true,
        value: {
          ...SAVED_SEARCHES,
          offset: request.offset,
          total: 2,
          items: request.offset
            ? [{ kind: 'savedSearch', ref: searchRef, name: 'Renamed', conditions: [] }]
            : SAVED_SEARCHES.items,
          ...(request.offset ? {} : { nextOffset: 1 }),
        },
      }
    },
  })
  await waitFor(() => expect(result.current.locatedRef).toBe(searchRef))
  expect(result.current.selection).toMatchObject({ name: 'Renamed' })
  act(() =>
    result.current.selectScope({
      kind: 'savedSearch',
      ref: searchRef + '?server=S1',
      name: 'Renamed',
    }),
  )
  expect(result.current.selection).toMatchObject({ ref: searchRef })
})
it('reports a removed saved search after exhausting its listing', async () => {
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: { kind: 'savedSearch', ref: 'zotero://user/0/search/MISSING1', name: 'Missing' },
    q: '',
    filters: {},
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
  const { result } = setupLibraryFeed()
  await waitFor(() => expect(result.current.locateError).toContain('no longer exists'))
})
it('reports a path whose target is absent from the actual parent listing', async () => {
  store()
  const { result } = setupLibraryFeed({
    collectionPath: async () => ({
      ok: true,
      value: { library: { type: 'user', id: 0 }, libraryVersion: 1, path: [target] },
    }),
  })
  await waitFor(() => expect(result.current.locateError).toContain('path changed'))
  expect(result.current.locatedRef).toBeUndefined()
})
it('stops locating at a failed child lane and leaves its retry available', async () => {
  store()
  const browse = scripted()
  const { result } = setupLibraryFeed({
    browse: async (request) =>
      request.parentRef
        ? { ok: false, error: new RemoteError('gateway/internal', 'child down', {}) }
        : browse(request),
    collectionPath: async () => ({
      ok: true,
      value: { library: { type: 'user', id: 0 }, libraryVersion: 1, path: [parent, target] },
    }),
  })
  await waitFor(() => expect(result.current.locateError).toContain('Cannot load'))
  expect(result.current.treeLane(parent.ref)).toMatchObject({
    phase: 'error',
    message: 'child down',
  })
})

it('shows a navigation failure before attempting a restored path', async () => {
  store()
  const browse = scripted()
  const { result } = setupLibraryFeed({
    browse: async (request) =>
      request.kind === 'collections'
        ? { ok: false, error: new RemoteError('gateway/internal', 'root failed', {}) }
        : browse(request),
  })
  await waitFor(() => expect(result.current.locateError).toContain('Load navigation'))
})
it('shows a saved-search listing failure during restored location', async () => {
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: { kind: 'savedSearch', ref: 'zotero://user/0/search/SEARCH01', name: 'Unread' },
    q: '',
    filters: {},
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
  const browse = scripted()
  const { result } = setupLibraryFeed({
    browse: async (request) =>
      request.kind === 'savedSearches'
        ? { ok: false, error: new RemoteError('gateway/internal', 'saved failed', {}) }
        : browse(request),
  })
  await waitFor(() => expect(result.current.locateError).toBe('saved failed'))
})

it('walks more than two saved-search pages to reveal the restored search', async () => {
  const ref = 'zotero://user/0/search/SEARCH03'
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: { kind: 'savedSearch', ref, name: 'Third' },
    q: '',
    filters: {},
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
  const original = scripted()
  const { result } = setupLibraryFeed({
    browse: async (request) =>
      request.kind === 'savedSearches'
        ? {
            ok: true,
            value: {
              ...SAVED_SEARCHES,
              total: 3,
              offset: request.offset,
              items: [
                {
                  kind: 'savedSearch',
                  ref: `zotero://user/0/search/SEARCH0${request.offset + 1}`,
                  name: 'Search',
                  conditions: [],
                },
              ],
              ...(request.offset < 2 ? { nextOffset: request.offset + 1 } : {}),
            },
          }
        : original(request),
  })
  await waitFor(() => expect(result.current.locatedRef).toBe(ref))
  expect(result.current.savedSearches).toMatchObject({
    phase: 'ready',
    rows: expect.any(Array),
    total: 3,
  })
})
it('does not resume path expansion after unmount while a path prefix is loading', async () => {
  store()
  const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const original = scripted()
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) =>
    request.kind === 'collections' && request.offset ? pending.promise : original(request),
  )
  const { result, unmount } = setupLibraryFeed({
    browse,
    collectionPath: async () => ({
      ok: true,
      value: { library: { type: 'user', id: 0 }, libraryVersion: 1, path: [parent, target] },
    }),
  })
  await waitFor(() =>
    expect(browse).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'collections', offset: 1 }),
    ),
  )
  unmount()
  await act(async () =>
    pending.resolve({
      ok: true,
      value: { ...ROOT_COLLECTIONS, offset: 1, returned: 1, items: [parent] },
    }),
  )
  expect(result.current.locatedRef).toBeUndefined()
  expect(browse.mock.calls.some(([request]) => request.parentRef !== undefined)).toBe(false)
})

it('ignores a path rejection after the user chooses another scope', async () => {
  store()
  const pending = deferred<Awaited<ReturnType<LibraryFeedFace['collectionPath']>>>()
  const collectionPath = vi.fn<LibraryFeedFace['collectionPath']>(() => pending.promise)
  const { result } = setupLibraryFeed({ collectionPath })
  await waitFor(() => expect(collectionPath).toHaveBeenCalled())
  act(() => result.current.selectScope({ kind: 'trash' }))
  await act(async () => pending.reject(new Error('late path failure')))
  expect(result.current.locateError).toBeUndefined()
  expect(result.current.selection.kind).toBe('trash')
})
