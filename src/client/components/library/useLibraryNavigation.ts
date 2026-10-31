/**
 * The library panel's navigation state: continuous collection prefixes, the
 * saved-search listing, restoration, per-prefix library-version fencing, and
 * location. A lane is one continuous prefix rather than a page window, so
 * paging only ever appends; the feed owns the item list and persistence.
 * @module dsh-zotero/client/components/library/useLibraryNavigation
 */

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
  type LibraryLanePage,
  type SavedSearchRowView,
  type LibrarySelection,
} from './library-model.ts'
import { objectIdentity } from './navigation-identity.ts'
import { messageOf } from '../../error-text.ts'

/** One navigation prefix: rows accumulated from offset 0 and the version they were read at. */
export type NavigationPage<T> = LibraryLanePage<T> & { readonly libraryVersion: number }

/** A lane's render state: the prefix plus its loading and error frames. */
export type NavigationLane<T> =
  | NavigationPage<T>
  | { phase: 'loading'; previous?: NavigationPage<T> }
  | { phase: 'error'; message: string; previous?: NavigationPage<T> }

/** The rows every lane carries, whatever listing served them. */
type Row = CollectionRowView | SavedSearchRowView
/** The one lane key that is not an object identity; no valid ref can equal it. */
const SAVED = '@saved'

/**
 * Whether two breadcrumbs name the same path. An absent path and an empty one
 * are different facts: one is a saved search, the other a collection whose
 * path has not been resolved yet.
 */
function samePath(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Own the panel's navigation: one continuous prefix per collection level and
 * one for saved searches, every request fenced by the library version its
 * prefix was read at and every write-back compared before it replaces state.
 */
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
  /** The lane's visible page: the ready prefix, or the previous one while it reloads. */
  const pageOf = (key: string): NavigationPage<Row> | undefined => {
    const lane = state.current.get(key)
    return lane?.phase === 'ready' ? lane : lane?.previous
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
          let previous = pageOf(key)
          const target = Math.max(goal, rebuild ? (previous?.rows.length ?? 0) : 0)
          let page = rebuild ? undefined : previous
          let restarted = false
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
            // A prefix is one snapshot: every page reports the version the
            // first page did. A page read after the library moved would make
            // this prefix skip or duplicate rows across the seam, so the
            // whole prefix is read again at the new version instead of merged.
            // Only this lane restarts; other lanes are independent listings.
            if (page !== undefined && page.libraryVersion !== version) {
              if (restarted) throw new Error('Library keeps changing. Reload this branch.')
              restarted = true
              // The settled plane answers by request shape, not by version, so
              // the restart would otherwise be served the prefix it is trying
              // to replace.
              face.invalidate?.()
              page = undefined
              continue
            }
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
              previous: pageOf(key),
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

  /**
   * Every spelling the loaded rows use for one object identity. A stored ref
   * may lack the server qualifier the served rows carry, so the expansion
   * tests below need the spellings the rows actually have.
   */
  const rowRefsByIdentity = useMemo(() => {
    const index = new Map<string, Set<string>>()
    for (const value of lanes.values())
      for (const row of lanePageOf(value)?.rows ?? []) {
        const key = keyOf(row.ref)
        const spellings = index.get(key) ?? new Set<string>()
        spellings.add(row.ref)
        index.set(key, spellings)
      }
    return index
  }, [lanes, keyOf])

  /** The expanded set in every spelling: the stored refs plus the rows naming them. */
  const expandedRefs = useMemo(() => {
    const refs = new Set(expanded)
    for (const ref of expanded)
      for (const spelling of rowRefsByIdentity.get(keyOf(ref)) ?? []) refs.add(spelling)
    return refs
  }, [expanded, rowRefsByIdentity, keyOf])

  const flatTree = useMemo(
    () =>
      flattenTree(
        (root?.rows ?? []) as CollectionRowView[],
        (ref) =>
          lanePageOf(lanes.get(keyOf(ref))) as LibraryLanePage<CollectionRowView> | undefined,
        expandedRefs,
        root,
      ),
    [lanes, expandedRefs, keyOf, root],
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
      const root = pageOf('')
      if (!valid()) return
      if (!root) throw new Error('Load navigation before locating the current scope.')
      if (selection.kind === 'savedSearch') {
        await load(SAVED)
        while (valid()) {
          const page = pageOf(SAVED)
          const savedLane = state.current.get(SAVED)
          if (savedLane?.phase === 'error') throw new Error(savedLane.message)
          const found = page?.rows.find((row) => keyOf(row.ref) === keyOf(selection.ref))
          if (found) {
            if (found.name !== selection.name) updateSelection({ ...selection, name: found.name })
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
          const page = pageOf(keyOf(parent))
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
        // A locate that resolves to the scope already shown must not replace
        // the selection object: the item list keys its read on that identity,
        // so a fresh-but-equal object would refetch the same page and flash
        // the list back to `loading`.
        const currentPath = 'path' in selection ? selection.path : undefined
        if (
          keyOf(target.ref) !== keyOf(selection.ref) ||
          target.name !== selection.name ||
          !samePath(target.path, currentPath)
        )
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

  /**
   * Reload every lane from offset 0 at whatever version the library is now.
   * The manual refresh and a collection write both need the whole tree: a
   * collection write can move any ancestor, and the located path has to be
   * re-proven. Saved-search writes use {@link refreshSaved} instead.
   */
  const rebuild = useCallback(() => {
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
  }, [load])
  /**
   * Reload only the saved-search lane after a saved-search write. The write
   * advanced the library version, so this prefix restarts at offset 0 and
   * re-reads at the new version; collection lanes are independent listings
   * and keep their rows instead of being rebuilt and re-located.
   */
  const refreshSaved = useCallback(() => {
    const lane = state.current.get(SAVED)
    const loadedRows = (lane?.phase === 'ready' ? lane : lane?.previous)?.rows.length ?? 0
    void load(SAVED, Math.max(loadedRows, prefixes[SAVED] ?? 0), true)
  }, [load, prefixes])
  /** Loaded rows per lane key; the feed persists exactly this record. */
  const persistedPrefixes = useMemo(
    () =>
      Object.fromEntries(
        [...lanes].map(([key, value]) => [key, lanePageOf(value)?.rows.length ?? 0]),
      ),
    [lanes],
  )
  return {
    flatTree,
    expanded: expandedRefs,
    locatedRef,
    locateError,
    locate,
    refresh: rebuild,
    refreshSaved,
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
    prefixes: persistedPrefixes,
  }
}
