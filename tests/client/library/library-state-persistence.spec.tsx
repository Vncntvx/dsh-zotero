// @vitest-environment jsdom
/**
 * The durable record is written when its content changes, not when the
 * navigation hook publishes a fresh object for an unchanged visible prefix.
 * @module tests/client/library/library-state-persistence
 */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroLibraryBrowseRequestView } from '../../../src/contract.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import {
  libraryStorageKey,
  readLibraryState,
  writeLibraryState,
  type LibraryStoredState,
} from '../../../src/client/components/library/library-storage.ts'
import {
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import { deferred } from '../../helpers/sync.ts'

function stored(overrides: Partial<LibraryStoredState> = {}): LibraryStoredState {
  return {
    version: 2,
    prefixes: {},
    library: { type: 'user', id: 0 },
    selection: { kind: 'library' },
    q: '',
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
    filters: {},
    ...overrides,
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('library state persistence', () => {
  it('skips the loading publish whose visible prefix is unchanged', async () => {
    writeLibraryState('S1', stored({ prefixes: { '': 1 } }))
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const secondPage = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const browse = vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true as const, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches') return { ok: true as const, value: SAVED_SEARCHES }
      if (!request.parentRef) {
        if ((request.offset ?? 0) === 0)
          return {
            ok: true as const,
            value: {
              ...ROOT_COLLECTIONS,
              items: ROOT_COLLECTIONS.items.slice(0, 1),
              total: 2,
              returned: 1,
              offset: 0,
              nextOffset: 1,
            },
          }
        return secondPage.promise
      }
      return { ok: true as const, value: ROOT_COLLECTIONS }
    }) as LibraryFeedFace['browse']
    const { result } = setupLibraryFeed({ browse })
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    writes.mockClear()

    act(() => result.current.loadMoreTree(undefined))
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 })),
    )
    // The loading publish still shows the first page's one-row prefix, so the
    // durable content is identical and no synchronous write happens.
    expect(writes).not.toHaveBeenCalled()

    await act(async () =>
      secondPage.resolve({
        ok: true,
        value: {
          ...ROOT_COLLECTIONS,
          items: ROOT_COLLECTIONS.items.slice(1),
          total: 2,
          returned: 1,
          offset: 1,
        },
      }),
    )
    await waitFor(() => expect(readLibraryState('S1')?.prefixes['']).toBe(2))
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('writes once per real preference change and round-trips the record', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = setupLibraryFeed()
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    writes.mockClear()

    act(() => result.current.setNarrowPane('inspector'))
    await waitFor(() => expect(readLibraryState('S1')?.narrowPane).toBe('inspector'))
    expect(writes).toHaveBeenCalledTimes(1)

    act(() => result.current.setSort('title', 'asc'))
    await waitFor(() => expect(readLibraryState('S1')?.sort).toBe('title'))
    expect(writes).toHaveBeenCalledTimes(2)
    expect(readLibraryState('S1')).toMatchObject({
      version: 2,
      sort: 'title',
      direction: 'asc',
      narrowPane: 'inspector',
    })
  })

  it('re-persists after the Zotero instance changes', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const { result, rerender } = setupLibraryFeed()
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    writes.mockClear()

    act(() => rerender({ id: 'S2' }))
    await waitFor(() => expect(readLibraryState('S2')).toBeDefined())
    expect(writes.mock.calls.some(([key]) => key === libraryStorageKey('S2'))).toBe(true)
  })
})
