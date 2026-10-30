import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupportedLocalLibrary } from '../../../contract.ts'
import type { LibraryFeedFace } from './library-feed-types.ts'
import {
  collectionRowsOf,
  savedSearchRowsOf,
  treeRequestOf,
  savedSearchesRequestOf,
  flattenTree,
  lanePageOf,
  type CollectionRowView,
  type SavedSearchRowView,
  type LibrarySelection,
} from './library-model.ts'
import { objectIdentity } from './navigation-identity.ts'
import { messageOf } from '../../error-text.ts'

export interface NavigationPage<T> {
  readonly phase: 'ready'
  readonly rows: readonly T[]
  readonly total: number
  readonly offset: 0
  readonly limit: number
  readonly nextOffset: number | undefined
  readonly libraryVersion: number
}
export type NavigationLane<T> =
  | NavigationPage<T>
  | { phase: 'loading'; previous?: NavigationPage<T> }
  | { phase: 'error'; message: string; previous?: NavigationPage<T> }
type Row = CollectionRowView | SavedSearchRowView
const SAVED = '@saved'

/** Owns continuous prefixes; every operation is fenced by instance/library generation. */
export function useLibraryNavigation(
  face: LibraryFeedFace,
  serverId: string | undefined,
  library: SupportedLocalLibrary,
  active: boolean,
  expanded: ReadonlySet<string>,
  setExpanded: (
    next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>),
  ) => void,
  prefixes: Readonly<Record<string, number>>,
  selection: LibrarySelection,
  updateSelection: (scope: LibrarySelection) => void,
) {
  const [lanes, setLanes] = useState<ReadonlyMap<string, NavigationLane<Row>>>(new Map())
  const [locateError, setLocateError] = useState<string>()
  const [locatedRef, setLocatedRef] = useState<string>()
  const state = useRef(new Map<string, NavigationLane<Row>>())
  const generation = useRef(0)
  const locationGeneration = useRef(0)
  const libraryFence = useRef<number>()
  const automaticRebuilds = useRef(0)
  const recover = useRef<() => void>()
  const recheckLeaves = useRef(new Set<string>())
  const pending = useRef(new Map<string, Promise<void>>())
  const open = useRef(expanded)
  open.current = expanded
  const live = useRef(active)
  live.current = active
  const restoreCounts = useRef<Readonly<Record<string, number>>>({})
  const slots = useRef(0)
  const queue = useRef<(() => void)[]>([])
  const keyOf = useCallback(
    (ref?: string) => (ref === undefined ? '' : objectIdentity(ref, serverId)),
    [serverId],
  )
  const publish = (key: string, lane: NavigationLane<Row>) => {
    state.current.set(key, lane)
    setLanes(new Map(state.current))
  }
  const load = useCallback(
    (ref?: string, goal = 0, rebuild = false): Promise<void> => {
      const key = ref === SAVED ? SAVED : keyOf(ref)
      const running = pending.current.get(key)
      if (running) return running
      const epoch = generation.current
      const valid = () => live.current && generation.current === epoch
      const task = (async () => {
        await new Promise<void>((resolve) => {
          if (slots.current < 4) {
            slots.current++
            resolve()
          } else
            queue.current.push(() => {
              slots.current++
              resolve()
            })
        })
        try {
          if (!valid()) return
          let previous = lanePageOf(state.current.get(key)) as NavigationPage<Row> | undefined
          const target = Math.max(goal, rebuild ? (previous?.rows.length ?? 0) : 0)
          let page = rebuild ? undefined : previous
          publish(key, { phase: 'loading', previous })
          for (;;) {
            const offset = page?.nextOffset ?? 0
            if (page && page.nextOffset === undefined) break
            const response = await face.browse(
              ref === SAVED
                ? savedSearchesRequestOf(library, offset)
                : treeRequestOf(library, ref, offset),
            )
            if (!valid()) return
            if (!response.ok) throw new Error(response.error.message)
            const value = response.value
            const version = value.libraryVersion
            if (!Number.isSafeInteger(version) || version! < 0)
              throw new Error('Navigation response lacks a valid library version.')
            if (libraryFence.current !== undefined && libraryFence.current !== version) {
              if (automaticRebuilds.current >= 1)
                throw new Error('Library keeps changing. Reload navigation.')
              automaticRebuilds.current++
              restoreCounts.current = { ...restoreCounts.current, [key]: target }
              face.invalidate?.()
              recover.current?.()
              return
            }
            libraryFence.current = version
            const rows =
              ref === SAVED ? savedSearchRowsOf(value.items) : collectionRowsOf(value.items)
            const all = [...(page?.rows ?? []), ...rows]
            if (
              value.offset !== offset ||
              new Set(all.map((row) => keyOf(row.ref))).size !== all.length ||
              (value.nextOffset !== undefined &&
                (value.nextOffset !== offset + rows.length || value.nextOffset <= offset)) ||
              all.length > value.total ||
              (value.nextOffset === undefined && all.length !== value.total)
            )
              throw new Error('Navigation pagination is inconsistent. Reload this branch.')
            page = {
              phase: 'ready',
              rows: all,
              total: value.total,
              offset: 0,
              limit: value.limit,
              nextOffset: value.nextOffset,
              libraryVersion: version!,
            }
            previous = page
            publish(key, { phase: 'loading', previous: page })
            if (page.rows.length >= target || page.nextOffset === undefined) break
          }
          // Normal loop exits have a complete page; cancellation exits above.
          publish(key, page!)
          if (ref !== undefined && ref !== SAVED && page!.total === 0)
            setExpanded((prev) => new Set([...prev].filter((item) => keyOf(item) !== key)))
        } catch (error) {
          if (valid())
            publish(key, {
              phase: 'error',
              message: messageOf(error),
              previous: lanePageOf(state.current.get(key)) as NavigationPage<Row> | undefined,
            })
        } finally {
          slots.current--
          queue.current.shift()?.()
        }
      })().finally(() => {
        if (pending.current.get(key) === task) pending.current.delete(key)
      })
      pending.current.set(key, task)
      return task
    },
    [face, library, keyOf, setExpanded],
  )

  useEffect(() => {
    live.current = active
    libraryFence.current = undefined
    automaticRebuilds.current = 0
    generation.current++
    pending.current.clear()
    state.current.clear()
    setLanes(new Map())
    if (active) {
      void load(undefined, prefixes[''] ?? 0)
      void load(SAVED, prefixes[SAVED] ?? 0)
    }
    return () => {
      generation.current++
      live.current = false
    }
  }, [active, serverId, library, load])

  const lane = (ref?: string) => lanes.get(ref === SAVED ? SAVED : keyOf(ref))
  const root = lanePageOf(lane())
  const flatTree = useMemo(
    () =>
      flattenTree(
        (root?.rows ?? []) as CollectionRowView[],
        (ref) => lanePageOf(lanes.get(keyOf(ref))) as NavigationPage<CollectionRowView> | undefined,
        new Set(
          [...expanded].flatMap((ref) => {
            const key = keyOf(ref)
            return [...lanes.values()].flatMap((value) =>
              (lanePageOf(value)?.rows ?? [])
                .filter((row) => keyOf(row.ref) === key)
                .map((row) => row.ref),
            )
          }),
        ),
        root,
      ),
    [lanes, expanded, keyOf, root],
  )

  useEffect(() => {
    if (!active) return
    for (const { row } of flatTree) {
      if (
        ![...open.current].some((ref) => keyOf(ref) === keyOf(row.ref)) &&
        !recheckLeaves.current.has(keyOf(row.ref))
      )
        continue
      if (!state.current.has(keyOf(row.ref)))
        void load(row.ref, restoreCounts.current[keyOf(row.ref)] ?? prefixes[keyOf(row.ref)] ?? 0)
    }
  }, [active, flatTree, keyOf, load, prefixes])

  const locate = useCallback(async () => {
    if (!active || !('ref' in selection)) return
    const epoch = generation.current
    const location = ++locationGeneration.current
    const valid = () =>
      live.current && epoch === generation.current && location === locationGeneration.current
    setLocateError(undefined)
    setLocatedRef(undefined)
    try {
      await load()
      const root = lanePageOf(state.current.get('')) as NavigationPage<Row> | undefined
      if (!valid()) return
      if (!root) throw new Error('Load navigation before locating the current scope.')
      if (selection.kind === 'savedSearch') {
        await load(SAVED)
        while (valid()) {
          const page = lanePageOf(state.current.get(SAVED))
          const savedLane = state.current.get(SAVED)
          if (savedLane?.phase === 'error') throw new Error(savedLane.message)
          const found = page?.rows.find((row) => keyOf(row.ref) === keyOf(selection.ref))
          if (found) {
            updateSelection({ ...selection, name: found.name })
            setLocatedRef(found.ref)
            return
          }
          if (page?.nextOffset === undefined)
            throw new Error('Saved search no longer exists. Return to all items.')
          await load(SAVED, page.rows.length + 1)
        }
        return
      }
      const response = await face.collectionPath({
        library,
        ref: selection.ref,
        libraryVersion: root.libraryVersion,
      })
      if (!valid()) return
      if (!response.ok) throw new Error(response.error.message)
      let parent: string | undefined
      for (const row of response.value.path) {
        while (valid()) {
          const page = lanePageOf(state.current.get(keyOf(parent)))
          if (page?.rows.some((item) => keyOf(item.ref) === keyOf(row.ref))) break
          if (page && page.nextOffset === undefined)
            throw new Error('Collection path changed. Reload navigation.')
          await load(parent, (page?.rows.length ?? 0) + 1)
          if (state.current.get(keyOf(parent))?.phase === 'error')
            throw new Error('Cannot load the current collection path.')
        }
        if (!valid()) return
        if (parent !== undefined) {
          const ancestor = parent
          setExpanded((prev) => new Set([...prev, ancestor]))
        }
        parent = row.ref
      }
      const target = response.value.path.at(-1)
      if (target) {
        updateSelection({ ...selection, ref: target.ref, name: target.name, path: target.path })
        setLocatedRef(target.ref)
      }
    } catch (error) {
      if (valid()) setLocateError(messageOf(error))
    }
  }, [active, selection, face, library, load, keyOf, setExpanded, updateSelection])
  const locateRef = useRef(locate)
  locateRef.current = locate
  useEffect(() => {
    if (active) void locateRef.current()
  }, [active, serverId, library])

  const rebuild = useCallback(() => {
    libraryFence.current = undefined
    generation.current++
    pending.current.clear()
    const counts = new Map(
      [...state.current].map(([key, value]) => [
        key,
        Math.max(lanePageOf(value)?.rows.length ?? 0, restoreCounts.current[key] ?? 0),
      ]),
    )
    recheckLeaves.current = new Set(
      [...state.current].filter(([, value]) => lanePageOf(value)?.total === 0).map(([key]) => key),
    )
    restoreCounts.current = Object.fromEntries(counts)
    state.current.clear()
    setLanes(new Map())
    void (async () => {
      await load(undefined, counts.get('') ?? 0, true)
      await load(SAVED, counts.get(SAVED) ?? 0, true)
      await locateRef.current()
    })()
  }, [face, load])
  recover.current = rebuild
  const refresh = useCallback(() => {
    automaticRebuilds.current = 0
    rebuild()
  }, [rebuild])
  return {
    flatTree,
    locatedRef,
    locateError,
    locate,
    refresh,
    cancelLocate: () => {
      locationGeneration.current++
    },
    treeLane: (ref?: string) => lane(ref) as NavigationLane<CollectionRowView> | undefined,
    savedSearches: (lane(SAVED) ?? { phase: 'loading' }) as NavigationLane<SavedSearchRowView>,
    loadMore: (ref?: string) => load(ref, (lanePageOf(lane(ref))?.rows.length ?? 0) + 1),
    retryTree: (ref?: string) =>
      load(ref, prefixes[keyOf(ref)] ?? 0, state.current.get(keyOf(ref))?.phase === 'ready'),
    loadMoreSaved: () => load(SAVED, (lanePageOf(lane(SAVED))?.rows.length ?? 0) + 1),
    retrySaved: () => load(SAVED, prefixes[SAVED] ?? 0),
    prefixes: Object.fromEntries(
      [...lanes].map(([key, value]) => [key, lanePageOf(value)?.rows.length ?? 0]),
    ),
  }
}
