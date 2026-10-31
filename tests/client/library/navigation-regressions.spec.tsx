// @vitest-environment jsdom

import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  ROOT_COLLECTIONS,
  LIBRARY_ROWS,
  SAVED_SEARCHES,
  searchPage,
} from '../helpers/library-panel-harness.tsx'
import { writeLibraryState } from '../../../src/client/components/library/library-storage.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
const ref = 'zotero://user/0/collection/COLL0001'
it('hides the previous scope while the next scope request is pending', async () => {
  const pending = deferred<any>()
  const { result, face } = setupLibraryFeed()
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  vi.mocked(face.search).mockImplementationOnce(() => pending.promise)
  act(() => result.current.selectScope({ kind: 'collection', ref, name: 'Next' }))
  expect(result.current.list.phase).toBe('loading')
  await act(async () => pending.resolve({ ok: true, value: searchPage() }))
})
it('restores the child lane of a persisted expanded root', async () => {
  writeLibraryState('S1', {
    version: 2,
    prefixes: {},
    library: { type: 'user', id: 0 },
    selection: { kind: 'library' },
    q: '',
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    filters: {},
    expanded: [ref],
  })
  const { result, face } = setupLibraryFeed()
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  expect(face.browse).toHaveBeenCalledWith(expect.objectContaining({ parentRef: ref }))
})
it('clears user filters in the first query of a different scope', async () => {
  const { result, face } = setupLibraryFeed()
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  act(() => result.current.setFilters({ tags: ['old'], yearFrom: 2020 }))
  act(() => result.current.selectScope({ kind: 'trash' }))
  expect(result.current.filters).toEqual({})
  expect(face.search).toHaveBeenLastCalledWith(expect.not.objectContaining({ tags: ['old'] }))
})
it('removes expanded intent after a successful empty child listing', async () => {
  const { result } = setupLibraryFeed({
    browse: async (request) => ({
      ok: true,
      value:
        request.kind === 'libraries'
          ? LIBRARY_ROWS
          : request.kind === 'savedSearches'
            ? SAVED_SEARCHES
            : request.parentRef
              ? { ...ROOT_COLLECTIONS, items: [], total: 0, returned: 0 }
              : ROOT_COLLECTIONS,
    }),
  })
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  act(() => result.current.toggleCollection(ref))
  await waitFor(() => expect(result.current.treeLane(ref)?.phase).toBe('ready'))
  expect(result.current.expanded.has(ref)).toBe(false)
})
