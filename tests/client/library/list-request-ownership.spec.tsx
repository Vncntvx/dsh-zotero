// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  searchPage,
} from '../helpers/library-panel-harness.tsx'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
it('drops an old search rejection after a new scope succeeds', async () => {
  const stale = deferred<Awaited<ReturnType<LibraryFeedFace['search']>>>()
  const search = vi
    .fn<LibraryFeedFace['search']>()
    .mockResolvedValueOnce({ ok: true, value: searchPage() })
    .mockImplementationOnce(() => stale.promise)
    .mockResolvedValue({ ok: true, value: searchPage({ items: [], total: 0, returned: 0 }) })
  const { result } = setupLibraryFeed({ search })
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  act(() => result.current.selectScope({ kind: 'trash' }))
  act(() => result.current.selectScope({ kind: 'publications' }))
  await waitFor(() => expect(result.current.list).toMatchObject({ phase: 'ready', total: 0 }))
  await act(async () => stale.reject(new Error('old failure')))
  expect(result.current.list).toMatchObject({ phase: 'ready', total: 0 })
})
it('keeps query and inspector when the current library is selected again', async () => {
  const { result } = setupLibraryFeed()
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  act(() => result.current.setFilters({ tags: ['read'] }))
  act(() => result.current.selectLibrary({ type: 'user', id: 0 }))
  expect(result.current.filters).toEqual({ tags: ['read'] })
})
it('walks clamped library selector pages and rejects a stalled cursor', async () => {
  let stall = false
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => ({
    ok: true,
    value:
      request.kind === 'libraries'
        ? {
            ...LIBRARY_ROWS,
            offset: request.offset,
            items: LIBRARY_ROWS.items.slice(request.offset, request.offset + 1),
            returned: 1,
            ...(stall
              ? { nextOffset: request.offset }
              : request.offset === 0
                ? { nextOffset: 1 }
                : {}),
          }
        : request.kind === 'savedSearches'
          ? SAVED_SEARCHES
          : ROOT_COLLECTIONS,
  }))
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() =>
    expect(result.current.libraries).toMatchObject({ phase: 'ready', options: expect.any(Array) }),
  )
  expect(
    result.current.libraries.phase === 'ready' && result.current.libraries.options,
  ).toHaveLength(2)
  stall = true
  act(() => result.current.retryLibraries())
  await waitFor(() =>
    expect(result.current.libraries).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('stalled'),
    }),
  )
})
it('ignores a late successful library selector page after unmount', async () => {
  const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) =>
    request.kind === 'libraries'
      ? pending.promise
      : { ok: true, value: request.kind === 'collections' ? ROOT_COLLECTIONS : SAVED_SEARCHES },
  )
  const { unmount } = setupLibraryFeed({ browse })
  await waitFor(() =>
    expect(browse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'libraries' })),
  )
  unmount()
  await act(async () => pending.resolve({ ok: true, value: { ...LIBRARY_ROWS, nextOffset: 1 } }))
  expect(browse.mock.calls.filter(([request]) => request.kind === 'libraries')).toHaveLength(1)
})
