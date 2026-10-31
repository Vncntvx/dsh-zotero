// @vitest-environment jsdom
/** Per-prefix library-version fencing and the narrow refresh a saved-search write earns. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type {
  ZoteroLibraryBrowseItemView,
  ZoteroLibraryBrowseResultView,
} from '../../../src/contract.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const [first, second] = ROOT_COLLECTIONS.items as [
  ZoteroLibraryBrowseItemView,
  ZoteroLibraryBrowseItemView,
]
const firstRef = first.kind === 'collection' ? first.ref : ''
const secondRef = second.kind === 'collection' ? second.ref : ''

function collectionsPage(
  items: readonly ZoteroLibraryBrowseItemView[],
  offset: number,
  nextOffset: number | undefined,
  libraryVersion: number,
): { ok: true; value: ZoteroLibraryBrowseResultView } {
  return {
    ok: true,
    value: {
      ...ROOT_COLLECTIONS,
      libraryVersion,
      items,
      total: 2,
      offset,
      returned: items.length,
      nextOffset,
    },
  }
}

it('restarts one prefix when a later page reports a new library version', async () => {
  const offsets: number[] = []
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
    if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
    if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
    offsets.push(request.offset)
    if (offsets.length === 1) return collectionsPage([first], 0, 1, 1)
    if (request.offset === 1) return collectionsPage([second], 1, undefined, 2)
    return collectionsPage([first, second], 0, undefined, 2)
  })
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  const savedReads = () =>
    vi.mocked(browse).mock.calls.filter(([request]) => request.kind === 'savedSearches').length
  const savedBefore = savedReads()
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  expect(offsets).toEqual([0, 1, 0])
  expect(savedReads()).toBe(savedBefore)
  expect(result.current.treeLane(undefined)).toMatchObject({
    rows: [{ ref: firstRef }, { ref: secondRef }],
    libraryVersion: 2,
  })
})

it('fails the branch when the library keeps changing under one prefix', async () => {
  let version = 1
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
    if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
    if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
    version++
    return request.offset === 0
      ? collectionsPage([first], 0, 1, version)
      : collectionsPage([second], 1, undefined, version + 1)
  })
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('error'))
  expect(result.current.treeLane(undefined)).toMatchObject({
    message: 'Library keeps changing. Reload this branch.',
  })
})

it('reloads only the saved-search lane after a saved-search write', async () => {
  const { result, face } = setupLibraryFeed()
  await waitFor(() => expect(result.current.savedSearches.phase).toBe('ready'))
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  vi.mocked(face.browse).mockClear()
  vi.mocked(face.collectionPath).mockClear()
  act(() => result.current.refreshAffected('savedSearches'))
  await waitFor(() => expect(face.browse).toHaveBeenCalledTimes(1))
  expect(vi.mocked(face.browse).mock.calls.map(([request]) => request.kind)).toEqual([
    'savedSearches',
  ])
  expect(face.collectionPath).not.toHaveBeenCalled()
})

it('repairs a failed saved-search lane from offset zero', async () => {
  let fail = true
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) => {
    if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
    if (request.kind === 'savedSearches')
      return fail
        ? {
            ok: false,
            error: new RemoteError('zotero/domain', 'saved search read failed', {
              code: 'ZOTERO_UNEXPECTED',
            }),
          }
        : { ok: true, value: SAVED_SEARCHES }
    return { ok: true, value: ROOT_COLLECTIONS }
  })
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.savedSearches.phase).toBe('error'))
  fail = false
  act(() => result.current.refreshAffected('savedSearches'))
  await waitFor(() => expect(result.current.savedSearches.phase).toBe('ready'))
})
