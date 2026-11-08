// @vitest-environment jsdom
/**
 * A rebuild schedules the root and saved-search listings together, and a
 * version change in one lane does not poison the other.
 * @module tests/client/library/navigation-rebuild-concurrency
 */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryBrowseResultView,
} from '../../../src/contract.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { writeLibraryState } from '../../../src/client/components/library/library-storage.ts'
import {
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => {
  localStorage.clear()
  writeLibraryState('S1', 'session-1', {
    version: 3,
    prefixes: {},
    library: { type: 'user', id: 0 },
    selection: {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0001',
      name: 'LLM Papers',
    },
    q: '',
    filters: {},
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('navigation rebuild concurrency', () => {
  it('starts the saved lane before root finishes and locates only after both', async () => {
    const rootGate = deferred<{ ok: true; value: ZoteroLibraryBrowseResultView }>()
    let hold = false
    let rootReads = 0
    let savedReads = 0
    const collectionPath = vi.fn<LibraryFeedFace['collectionPath']>(async (request) => ({
      ok: true,
      value: { ...request, path: [] },
    }))
    const browse = vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true as const, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches') {
        savedReads += 1
        return { ok: true as const, value: SAVED_SEARCHES }
      }
      if (!request.parentRef) {
        rootReads += 1
        if (hold) return rootGate.promise
      }
      return { ok: true as const, value: ROOT_COLLECTIONS }
    }) as LibraryFeedFace['browse']
    const { result } = setupLibraryFeed({ browse, collectionPath })
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    await waitFor(() => expect(result.current.savedSearches.phase).toBe('ready'))

    savedReads = 0
    collectionPath.mockClear()
    hold = true
    act(() => result.current.refresh())
    // The saved lane is issued while root's rebuild request is still open.
    await waitFor(() => expect(savedReads).toBe(1))
    expect(rootReads).toBe(2)
    expect(collectionPath).not.toHaveBeenCalled()

    await act(async () => rootGate.resolve({ ok: true, value: ROOT_COLLECTIONS }))
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    await waitFor(() => expect(collectionPath).toHaveBeenCalled())
  })

  it('restarts a version-changed root prefix without failing the concurrent saved lane', async () => {
    localStorage.clear()
    writeLibraryState('S1', 'session-1', {
      version: 3,
      prefixes: { '': 2 },
      library: { type: 'user', id: 0 },
      selection: { kind: 'library' },
      q: '',
      filters: {},
      mode: 'metadata',
      sort: 'title',
      direction: 'asc',
      offset: 0,
      expanded: [],
    })
    let version = 1
    let bump = false
    const invalidate = vi.fn()
    const browse = vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true as const, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches')
        return { ok: true as const, value: { ...SAVED_SEARCHES, libraryVersion: version } }
      if (!request.parentRef) {
        const offset = request.offset ?? 0
        if (offset === 0)
          return {
            ok: true as const,
            value: {
              ...ROOT_COLLECTIONS,
              libraryVersion: version,
              items: ROOT_COLLECTIONS.items.slice(0, 1),
              total: 2,
              returned: 1,
              offset: 0,
              nextOffset: 1,
            },
          }
        if (bump) version = 2
        return {
          ok: true as const,
          value: {
            ...ROOT_COLLECTIONS,
            libraryVersion: version,
            items: ROOT_COLLECTIONS.items.slice(1),
            total: 2,
            returned: 1,
            offset: 1,
          },
        }
      }
      return { ok: true as const, value: ROOT_COLLECTIONS }
    }) as LibraryFeedFace['browse']
    const { result } = setupLibraryFeed({ browse, invalidate })
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))

    bump = true
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    expect(result.current.treeLane(undefined)).toMatchObject({ phase: 'ready', total: 2 })
    expect(result.current.savedSearches.phase).toBe('ready')
    expect(result.current.locateError).toBeUndefined()
    expect(invalidate).toHaveBeenCalled()
  })
})
