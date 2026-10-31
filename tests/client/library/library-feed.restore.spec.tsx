// @vitest-environment jsdom
/**
 * The view pins an instance reopens with: the selected row and the narrow pane
 * come from the durable record, and the detail refetch follows the restored row.
 * @module tests/client/library/library-feed.restore
 */

import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  writeLibrarySessionView,
  writeLibraryState,
} from '../../../src/client/components/library/library-storage.ts'
import type { LibraryStoredState } from '../../../src/client/components/library/library-storage.ts'
import { ITEM_DETAIL, LIBRARY_ROWS, SAVED_SEARCHES } from '../helpers/library-panel-harness.tsx'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'

const SELECTED = 'zotero://user/0/item/ITEM0001?server=S1'

/** The durable record with everything at its default but the view pins. */
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

describe('restored view pins', () => {
  it('restores the selected row and the narrow pane from the instance record', async () => {
    writeLibraryState('S1', stored({ selectedRef: SELECTED, narrowPane: 'inspector' }))
    const { result, face } = setup()
    await waitFor(() => expect(result.current.selectedRef).toBe(SELECTED))
    expect(result.current.narrowPane).toBe('inspector')
    await waitFor(() =>
      expect(face.item).toHaveBeenCalledWith(expect.objectContaining({ ref: SELECTED })),
    )
  })

  it('falls back to the inspector pane when only the row was stored', async () => {
    writeLibraryState('S1', stored({ selectedRef: SELECTED }))
    const { result } = setup()
    await waitFor(() => expect(result.current.narrowPane).toBe('inspector'))
  })

  it('bridges a persisted unqualified expanded ref to the served qualified row', async () => {
    const bare = 'zotero://user/0/collection/COLL0001'
    const qualified = `${bare}?server=S1`
    writeLibraryState('S1', stored({ expanded: [bare] }))
    const { result, face } = setup({
      browse: vi.fn<LibraryFeedFace['browse']>(async (request) => ({
        ok: true,
        value:
          request.kind === 'libraries'
            ? LIBRARY_ROWS
            : request.kind === 'savedSearches'
              ? SAVED_SEARCHES
              : {
                  kind: 'collections',
                  libraryVersion: 1,
                  items: [
                    { kind: 'collection', ref: qualified, name: 'LLM Papers', path: [], depth: 0 },
                  ],
                  total: 1,
                  offset: 0,
                  returned: 1,
                  limit: 1,
                },
      })),
    })
    await waitFor(() =>
      expect(result.current.flatTree.some(({ row }) => row.ref === qualified)).toBe(true),
    )
    expect(result.current.expanded.has(qualified)).toBe(true)
    await waitFor(() =>
      expect(face.browse).toHaveBeenCalledWith(expect.objectContaining({ parentRef: qualified })),
    )
  })

  it('drops a cached detail that names another row and refetches the restored one', async () => {
    writeLibrarySessionView('session-1', {
      inspector: {
        phase: 'ready',
        detail: { ...ITEM_DETAIL, ref: 'zotero://user/0/item/ITEM0002?server=S1' },
      },
    })
    writeLibraryState('S1', stored({ selectedRef: SELECTED }))
    const { result, face } = setup()

    await waitFor(() =>
      expect(face.item).toHaveBeenCalledWith(expect.objectContaining({ ref: SELECTED })),
    )
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    const inspector = result.current.inspector
    // The stale payload named ITEM0002; the restored row's answer replaced it.
    expect(inspector?.phase === 'ready' ? inspector.detail.ref : undefined).toBe(ITEM_DETAIL.ref)
  })
})

describe('library switch', () => {
  it('keeps the reading preferences the reader chose', async () => {
    writeLibraryState('S1', stored({ mode: 'everything', sort: 'title', direction: 'asc' }))
    const { result } = setup()
    await waitFor(() => expect(result.current.mode).toBe('everything'))
    act(() => result.current.selectLibrary({ type: 'group', id: 123 }))
    expect(result.current.currentLibrary).toEqual({ type: 'group', id: 123 })
    expect(result.current.mode).toBe('everything')
    expect(result.current.sort).toBe('title')
    expect(result.current.direction).toBe('asc')
  })
})
