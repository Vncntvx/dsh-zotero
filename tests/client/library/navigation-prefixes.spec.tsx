// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  ROOT_COLLECTIONS,
  LIBRARY_ROWS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
const rows = ROOT_COLLECTIONS.items
function browsePages(
  change?: (offset: number) => Record<string, unknown>,
): LibraryFeedFace['browse'] {
  return vi.fn<LibraryFeedFace['browse']>(async (request) => ({
    ok: true,
    value:
      request.kind === 'libraries'
        ? LIBRARY_ROWS
        : request.kind === 'savedSearches'
          ? SAVED_SEARCHES
          : {
              ...ROOT_COLLECTIONS,
              items: [rows[request.offset]!],
              total: 2,
              returned: 1,
              offset: request.offset,
              ...(request.offset === 0 ? { nextOffset: 1 } : {}),
              ...change?.(request.offset),
            },
  }))
}
it('appends the server cursor without losing the selected first root', async () => {
  const { result, face } = setupLibraryFeed({ browse: browsePages() })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() =>
    result.current.selectScope({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0001',
      name: 'First',
    }),
  )
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() => expect(result.current.flatTree).toHaveLength(2))
  expect(result.current.selection.kind).toBe('collection')
  expect(face.browse).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }))
})
it('preserves the successful prefix when a continuation repeats an object', async () => {
  const { result } = setupLibraryFeed({
    browse: browsePages((offset) => (offset ? { items: [rows[0]] } : {})),
  })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('error'))
  expect(result.current.flatTree).toHaveLength(1)
})
it('restarts once from zero when a continuation reports a new library version', async () => {
  let version = 1
  const pages = browsePages((offset) => {
    if (offset) version = 2
    return { libraryVersion: version }
  })
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
    const result = await pages(request)
    return result.ok && request.kind === 'savedSearches'
      ? { ok: true, value: { ...result.value, libraryVersion: version } }
      : result
  })
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() =>
    expect(result.current.treeLane(undefined)).toMatchObject({ phase: 'ready', libraryVersion: 2 }),
  )
  expect(result.current.flatTree).toHaveLength(2)
  expect(
    vi
      .mocked(browse)
      .mock.calls.filter(([request]) => request.kind === 'collections')
      .map(([request]) => request.offset),
  ).toEqual([0, 1, 0, 1])
})
it('drops an in-flight continuation after unmount without scheduling another request', async () => {
  const continuation = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const browse = vi.fn(browsePages())
  const { result, unmount } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  browse.mockImplementationOnce(() => continuation.promise)
  act(() => {
    result.current.loadMoreTree(undefined)
    result.current.loadMoreTree(undefined)
  })
  await waitFor(() => expect(browse).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 })))
  const count = browse.mock.calls.length
  unmount()
  await act(async () =>
    continuation.resolve({
      ok: true,
      value: { ...ROOT_COLLECTIONS, offset: 1, items: [rows[1]!], returned: 1 },
    }),
  )
  expect(browse).toHaveBeenCalledTimes(count)
})

it('rejects a missing version without interpreting the branch as a leaf', async () => {
  const { result } = setupLibraryFeed({
    browse: browsePages(() => ({ libraryVersion: undefined })),
  })
  await waitFor(() => expect(result.current.treeLane(undefined)).toMatchObject({ phase: 'error' }))
  expect(result.current.flatTree).toHaveLength(0)
})
it('stops after one automatic rebuild when the library keeps changing', async () => {
  let version = 1
  const base = browsePages()
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
    const result = await base(request)
    if (request.kind === 'collections' && request.offset) version++
    return result.ok ? { ok: true, value: { ...result.value, libraryVersion: version } } : result
  })
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() =>
    expect(result.current.treeLane(undefined)).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('keeps changing'),
    }),
  )
  expect(
    browse.mock.calls
      .filter(([request]) => request.kind === 'collections')
      .map(([request]) => request.offset),
  ).toEqual([0, 1, 0, 1])
})
