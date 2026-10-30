// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import {
  ROOT_COLLECTIONS,
  LIBRARY_ROWS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import { writeLibraryState } from '../../../src/client/components/library/library-storage.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type { ZoteroCollectionRowView } from '../../../src/contract.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
const root = ROOT_COLLECTIONS.items[0] as ZoteroCollectionRowView
const child: ZoteroCollectionRowView = {
  ...root,
  ref: root.ref.replace('COLL0001', 'CHILD001'),
  parentRef: root.ref,
  name: 'Child',
  path: [root.name, 'Child'],
  depth: 1,
}
const saved = {
  version: 2 as const,
  library: { type: 'user' as const, id: 0 as const },
  selection: { kind: 'library' as const },
  q: '',
  filters: {},
  mode: 'metadata' as const,
  sort: 'title' as const,
  direction: 'asc' as const,
  offset: 0,
  expanded: [root.ref, child.ref],
}
function hierarchy(): LibraryFeedFace['browse'] {
  return vi.fn<LibraryFeedFace['browse']>(async (request) => {
    if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
    if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
    const items = request.parentRef === root.ref ? [child] : request.parentRef ? [] : [root]
    return {
      ok: true,
      value: { ...ROOT_COLLECTIONS, items, total: items.length, returned: items.length },
    }
  })
}
it('restores visible expanded descendants and confirms their leaf state', async () => {
  writeLibraryState('S1', saved)
  const { result, face } = setupLibraryFeed({ browse: hierarchy() })
  await waitFor(() =>
    expect(result.current.treeLane(child.ref)).toMatchObject({ phase: 'ready', total: 0 }),
  )
  expect(result.current.expanded.has(child.ref)).toBe(false)
  expect(result.current.expanded.has(root.ref)).toBe(true)
  expect(face.browse).toHaveBeenCalledWith(expect.objectContaining({ parentRef: root.ref }))
})
it('does not load expanded descendants hidden behind a collapsed ancestor', async () => {
  writeLibraryState('S1', { ...saved, expanded: [child.ref] })
  const { result, face } = setupLibraryFeed({ browse: hierarchy() })
  await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
  expect(
    vi.mocked(face.browse).mock.calls.some(([request]) => request.parentRef !== undefined),
  ).toBe(false)
  act(() => result.current.toggleCollection(root.ref))
  await waitFor(() => expect(result.current.treeLane(child.ref)?.phase).toBe('ready'))
})
it('refreshes visible former leaves so newly added children become reachable', async () => {
  let hasChildren = false
  const original = hierarchy()
  const { result } = setupLibraryFeed({
    browse: async (request) =>
      request.parentRef === root.ref && !hasChildren
        ? { ok: true, value: { ...ROOT_COLLECTIONS, items: [], total: 0, returned: 0 } }
        : original(request),
  })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() => result.current.toggleCollection(root.ref))
  await waitFor(() =>
    expect(result.current.treeLane(root.ref)).toMatchObject({ phase: 'ready', total: 0 }),
  )
  hasChildren = true
  act(() => result.current.refresh())
  await waitFor(() =>
    expect(result.current.treeLane(root.ref)).toMatchObject({ phase: 'ready', total: 1 }),
  )
  act(() => result.current.toggleCollection(root.ref))
  expect(result.current.flatTree.map((row) => row.row.ref)).toContain(child.ref)
})
it('drops an old instance branch result after switching instances', async () => {
  const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const original = hierarchy()
  const { result, rerender } = setupLibraryFeed({
    browse: (request) => (request.parentRef ? pending.promise : original(request)),
  })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() => result.current.toggleCollection(root.ref))
  await waitFor(() => expect(result.current.treeLane(root.ref)?.phase).toBe('loading'))
  rerender({ id: 'S2' })
  await waitFor(() => expect(result.current.expanded.size).toBe(0))
  await act(async () =>
    pending.resolve({
      ok: true,
      value: { ...ROOT_COLLECTIONS, items: [child], total: 1, returned: 1 },
    }),
  )
  expect(result.current.treeLane(root.ref)).toBeUndefined()
})
it('limits navigation restoration to four concurrent branches and drops queued work on unmount', async () => {
  const roots = Array.from({ length: 6 }, (_, index) => ({
    ...root,
    ref: root.ref.replace('COLL0001', `ROOT000${index}`),
  }))
  writeLibraryState('S1', { ...saved, expanded: roots.map((row) => row.ref) })
  const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const original = hierarchy()
  let calls = 0
  const { unmount } = setupLibraryFeed({
    browse: async (request) => {
      if (request.parentRef) {
        calls++
        return pending.promise
      }
      if (request.kind === 'collections')
        return {
          ok: true,
          value: { ...ROOT_COLLECTIONS, items: roots, total: roots.length, returned: roots.length },
        }
      return original(request)
    },
  })
  await waitFor(() => expect(calls).toBe(4))
  unmount()
  await act(async () =>
    pending.resolve({ ok: true, value: { ...ROOT_COLLECTIONS, items: [], total: 0, returned: 0 } }),
  )
  expect(calls).toBe(4)
})

it('does not reread a confirmed leaf when expansion is attempted again', async () => {
  const original = hierarchy()
  const browse = vi.fn<LibraryFeedFace['browse']>(async (request) =>
    request.parentRef
      ? { ok: true, value: { ...ROOT_COLLECTIONS, items: [], total: 0, returned: 0 } }
      : original(request),
  )
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(1))
  act(() => result.current.toggleCollection(root.ref))
  await waitFor(() =>
    expect(result.current.treeLane(root.ref)).toMatchObject({ phase: 'ready', total: 0 }),
  )
  const calls = browse.mock.calls.length
  act(() => result.current.toggleCollection(root.ref))
  expect(result.current.expanded.has(root.ref)).toBe(false)
  expect(browse).toHaveBeenCalledTimes(calls)
})
