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
  version: 4 as const,
  prefixes: {},
  library: { type: 'user' as const, id: 0 as const },
  selection: { kind: 'library' as const },
  q: '',
  filters: {},
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
  writeLibraryState('S1', 'session-1', saved)
  const { result, face } = setupLibraryFeed({ browse: hierarchy() })
  await waitFor(() =>
    expect(result.current.treeLane(child.ref)).toMatchObject({ phase: 'ready', total: 0 }),
  )
  expect(result.current.expanded.has(child.ref)).toBe(false)
  expect(result.current.expanded.has(root.ref)).toBe(true)
  expect(face.browse).toHaveBeenCalledWith(
    expect.objectContaining({ parentRef: root.ref }),
    expect.any(AbortSignal),
  )
})
it('does not load expanded descendants hidden behind a collapsed ancestor', async () => {
  writeLibraryState('S1', 'session-1', { ...saved, expanded: [child.ref] })
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
  writeLibraryState('S1', 'session-1', { ...saved, expanded: roots.map((row) => row.ref) })
  const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const original = hierarchy()
  const signals: AbortSignal[] = []
  const { unmount } = setupLibraryFeed({
    browse: async (request, signal) => {
      if (request.parentRef) {
        signals.push(signal!)
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
  await waitFor(() => expect(signals).toHaveLength(4))
  unmount()
  expect(signals.every((signal) => signal.aborted)).toBe(true)
  await act(async () =>
    pending.resolve({ ok: true, value: { ...ROOT_COLLECTIONS, items: [], total: 0, returned: 0 } }),
  )
  expect(signals).toHaveLength(4)
})

it('does not spend rebuilt slots on old queued work or accept late old branches', async () => {
  const roots = Array.from({ length: 6 }, (_, index) => ({
    ...root,
    ref: root.ref.replace('COLL0001', `ROOT000${index}`),
  }))
  writeLibraryState('S1', 'session-1', { ...saved, expanded: roots.map((row) => row.ref) })
  const previous = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const replacement = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  const firstSignals: AbortSignal[] = []
  const nextSignals: AbortSignal[] = []
  const original = hierarchy()
  let rebuilding = false
  const { result } = setupLibraryFeed({
    browse: async (request, signal) => {
      if (request.parentRef) {
        const signals = rebuilding ? nextSignals : firstSignals
        signals.push(signal!)
        return rebuilding ? replacement.promise : previous.promise
      }
      if (request.kind === 'collections')
        return {
          ok: true,
          value: { ...ROOT_COLLECTIONS, items: roots, total: roots.length, returned: roots.length },
        }
      return original(request)
    },
  })
  await waitFor(() => expect(firstSignals).toHaveLength(4))
  rebuilding = true
  act(() => result.current.refresh())
  expect(firstSignals.every((signal) => signal.aborted)).toBe(true)
  await waitFor(() => expect(nextSignals).toHaveLength(4))
  await act(async () =>
    previous.resolve({
      ok: true,
      value: { ...ROOT_COLLECTIONS, items: [child], total: 1, returned: 1 },
    }),
  )
  expect(nextSignals).toHaveLength(4)
  expect(result.current.flatTree.some(({ row }) => row.ref === child.ref)).toBe(false)
  await act(async () =>
    replacement.resolve({
      ok: true,
      value: { ...ROOT_COLLECTIONS, items: [], total: 0, returned: 0 },
    }),
  )
  expect(nextSignals).toHaveLength(6)
  for (const row of roots)
    expect(result.current.treeLane(row.ref)).toMatchObject({ phase: 'ready', total: 0 })
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

it('keeps an expanded branch and its children while that lane reloads', async () => {
  const grand: ZoteroCollectionRowView = {
    ...child,
    ref: child.ref.replace('CHILD001', 'GRAND001'),
    parentRef: child.ref,
    name: 'Grand',
    path: [root.name, child.name, 'Grand'],
    depth: 2,
  }
  const gate = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
  let hold = false
  writeLibraryState('S1', 'session-1', { ...saved, expanded: [root.ref, child.ref] })
  const { result } = setupLibraryFeed({
    browse: async (request) => {
      if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
      if (request.parentRef === child.ref)
        return hold
          ? gate.promise
          : { ok: true, value: { ...ROOT_COLLECTIONS, items: [grand], total: 1, returned: 1 } }
      const items = request.parentRef === root.ref ? [child] : request.parentRef ? [] : [root]
      return {
        ok: true,
        value: { ...ROOT_COLLECTIONS, items, total: items.length, returned: items.length },
      }
    },
  })
  await waitFor(() =>
    expect(result.current.flatTree.map(({ row }) => row.ref)).toContain(grand.ref),
  )
  hold = true
  act(() => result.current.retryTree(child.ref))
  await waitFor(() => expect(result.current.treeLane(child.ref)?.phase).toBe('loading'))
  expect(result.current.expanded.has(child.ref)).toBe(true)
  expect(result.current.flatTree.map(({ row }) => row.ref)).toContain(grand.ref)
  await act(async () =>
    gate.resolve({
      ok: true,
      value: { ...ROOT_COLLECTIONS, items: [grand], total: 1, returned: 1 },
    }),
  )
})
