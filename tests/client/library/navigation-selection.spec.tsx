// @vitest-environment jsdom
/**
 * Selecting a container-only collection: Zotero reports zero items and a
 * positive sub-collection count, so the selection opens the branch and the
 * narrow pane stays on the tree instead of landing on an empty listing.
 * @module tests/client/library/navigation-selection
 */

import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const container = {
  kind: 'collection' as const,
  ref: 'zotero://user/0/collection/COLL0001',
  name: 'Container',
  path: ['Container'],
  depth: 0,
  childCount: 2,
  itemCount: 0,
}
const stocked = {
  ...container,
  ref: 'zotero://user/0/collection/COLL0002',
  name: 'Stocked',
  path: ['Stocked'],
  itemCount: 3,
}
/** A served child keeps the branch open: a confirmed empty lane collapses it. */
const child = {
  kind: 'collection' as const,
  ref: 'zotero://user/0/collection/COLL0003',
  name: 'Child',
  path: ['Container', 'Child'],
  depth: 1,
  childCount: 0,
  itemCount: 2,
}

/** Roots carry the counts; child lanes serve one row so expansion sticks. */
function browseRoots(rows: readonly (typeof container)[]): LibraryFeedFace['browse'] {
  return vi.fn<LibraryFeedFace['browse']>(async (request) => ({
    ok: true,
    value:
      request.kind === 'libraries'
        ? LIBRARY_ROWS
        : request.kind === 'savedSearches'
          ? SAVED_SEARCHES
          : request.parentRef !== undefined
            ? { ...ROOT_COLLECTIONS, items: [child], total: 1, returned: 1 }
            : { ...ROOT_COLLECTIONS, items: rows, total: rows.length, returned: rows.length },
  }))
}

it('opens a zero-item collection with sub-collections and stays on the tree', async () => {
  const { result, face } = setupLibraryFeed({ browse: browseRoots([container, stocked]) })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(2))
  act(() =>
    result.current.selectScope({ kind: 'collection', ref: container.ref, name: container.name }),
  )
  await waitFor(() =>
    expect(result.current.selection).toMatchObject({ kind: 'collection', ref: container.ref }),
  )
  expect(result.current.narrowPane).toBe('tree')
  expect(result.current.expanded.has(container.ref)).toBe(true)
  await waitFor(() =>
    expect(face.browse).toHaveBeenCalledWith(expect.objectContaining({ parentRef: container.ref })),
  )
})

it('keeps a collection with items on the listing side', async () => {
  const { result } = setupLibraryFeed({ browse: browseRoots([container, stocked]) })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(2))
  act(() =>
    result.current.selectScope({ kind: 'collection', ref: stocked.ref, name: stocked.name }),
  )
  await waitFor(() =>
    expect(result.current.selection).toMatchObject({ kind: 'collection', ref: stocked.ref }),
  )
  expect(result.current.narrowPane).toBe('list')
  expect(result.current.expanded.has(stocked.ref)).toBe(false)
})
