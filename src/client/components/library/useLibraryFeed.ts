/**
 * The library panel's data feed: one hook owning every wire call the panel
 * makes. The panel mounts while its sidebar entry is selected, so requests
 * run on open and stop on switch-away. Each lane numbers its requests with a
 * monotonic sequence, and tree lanes do so per collection key: an answer
 * whose sequence is not the latest is dropped.
 * @module dsh-zotero/client/components/library/useLibraryFeed
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SupportedLocalLibrary,
  ZoteroChildListingKind,
  ZoteroChildPageView,
  ZoteroItemDetailView,
  ZoteroLibraryBrowseItemView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryBrowseResultView,
  ZoteroLibraryChildPageRequestView,
  ZoteroLibraryItemRequestView,
  ZoteroLibrarySearchRequestView,
  ZoteroSearchResultView,
} from '../../../contract.ts'
import { ZOTERO_CHILD_PAGE_ROWS } from '../../../constants.ts'
import {
  collectionRowsOf,
  type CollectionRowView,
  type FlatCollectionRow,
  type LibraryLaneState,
  type LibraryListQuery,
  type LibraryFilters,
  type LibraryListState,
  type LibrarySearchMode,
  type LibrarySelection,
  type LibraryItemState,
  type LibrarySelectorState,
  type SavedSearchRowView,
  flattenTree,
  itemStateOf,
  librariesRequestOf,
  lanePageOf,
  libraryOptionsOf,
  LIBRARY_SORTS,
  listRequestOf,
  listStateOf,
  pageOffsetOf,
  PERSONAL_LIBRARY,
  sameLibrary,
  savedSearchesRequestOf,
  savedSearchRowsOf,
  treeRequestOf,
} from './library-model.ts'
import { messageOf } from '../../error-text.ts'
import { readLibraryState, writeLibraryState, type LibraryStoredState } from './library-storage.ts'

/** The wire face the panel calls; injected so specs can stub it wholesale. */
export interface LibraryFeedFace {
  readonly browse: (
    request: ZoteroLibraryBrowseRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryBrowseResultView>>
  readonly search: (
    request: ZoteroLibrarySearchRequestView,
  ) => Promise<RemoteResult<ZoteroSearchResultView>>
  readonly item: (
    request: ZoteroLibraryItemRequestView,
  ) => Promise<RemoteResult<ZoteroItemDetailView>>
  readonly childPage: (
    request: ZoteroLibraryChildPageRequestView,
  ) => Promise<RemoteResult<ZoteroChildPageView>>
  /**
   * Drops the shared data plane's cached reads. Present when the face is the
   * panel's shared plane; a bare spec stub may omit it.
   */
  readonly invalidate?: () => void
  /**
   * Pins the shared plane's cache to one Zotero instance. Present when the
   * face is the panel's shared plane; a bare spec stub may omit it, in which
   * case the feed falls back to {@link LibraryFeedFace.invalidate}.
   */
  readonly setInstance?: (serverId: string | undefined) => void
}

const SEARCH_DEBOUNCE_MS = 300

const INSPECTOR_INCLUDE: readonly ZoteroChildListingKind[] = ['notes', 'attachments', 'annotations']

type CollectionRow = CollectionRowView
type TreeLanes = ReadonlyMap<string, LibraryLaneState<CollectionRow>>
export type ChildKind = ZoteroChildListingKind
export type ChildLoadState = { phase: 'loading' } | { phase: 'error'; message: string }

export interface LibraryFeed {
  readonly libraries: LibrarySelectorState
  readonly currentLibrary: SupportedLocalLibrary
  readonly selectLibrary: (library: SupportedLocalLibrary) => void
  readonly flatTree: readonly FlatCollectionRow[]
  readonly expanded: ReadonlySet<string>
  readonly toggleCollection: (ref: string) => void
  readonly pageTree: (ref: string | undefined, offset: number) => void
  readonly retryTree: (ref: string | undefined) => void
  readonly treeLane: (ref: string | undefined) => LibraryLaneState<CollectionRow> | undefined
  readonly savedSearches: LibraryLaneState<SavedSearchRowView>
  readonly pageSavedSearches: (offset: number) => void
  readonly retrySavedSearches: () => void
  readonly selection: LibrarySelection
  readonly selectScope: (selection: LibrarySelection) => void
  readonly q: string
  readonly setQ: (q: string) => void
  readonly filters: LibraryFilters
  readonly setFilters: (filters: LibraryFilters) => void
  readonly mode: LibrarySearchMode
  readonly setMode: (mode: LibrarySearchMode) => void
  readonly sort: (typeof LIBRARY_SORTS)[number]
  readonly direction: 'asc' | 'desc'
  readonly setSort: (sort: (typeof LIBRARY_SORTS)[number], direction: 'asc' | 'desc') => void
  readonly list: LibraryListState
  readonly offset: number
  readonly gotoOffset: (offset: number) => void
  readonly selectedRef: string | undefined
  readonly selectItem: (ref: string | undefined) => void
  readonly inspector: LibraryItemState | undefined
  /** Bumped by {@link LibraryFeed.refresh}; effects that re-read on refresh key on it. */
  readonly refreshToken: number
  readonly refresh: () => void
  readonly refreshAffected: (kind: 'items' | 'collections' | 'savedSearches') => void
  readonly retryLibraries: () => void
  readonly retryList: () => void
  readonly retryInspector: () => void
  readonly pageChild: (kind: 'notes' | 'attachments' | 'annotations', offset: number) => void
  readonly childStates: Partial<Record<ChildKind, ChildLoadState>>
  readonly retryChild: (kind: ChildKind) => void
}

/**
 * Own the panel's wire traffic. One effect per lane keeps dependencies
 * honest: the list reloads on any toolbar change (offset rewound to 0 for a
 * new scope/query/sort), the tree loads a level the first time it expands,
 * and the inspector loads the selected row's detail with all child kinds.
 * @param face - the wire face (browse/search/item).
 * @returns the feed interface the panel components render.
 */
export function useLibraryFeed(
  face: LibraryFeedFace,
  serverId?: string,
  enabled = true,
): LibraryFeed {
  const [libraries, setLibraries] = useState<LibraryFeed['libraries']>({ phase: 'loading' })
  const [currentLibrary, setCurrentLibrary] = useState<SupportedLocalLibrary>({
    type: 'user',
    id: 0,
  })
  const [lanes, setLanes] = useState<TreeLanes>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [savedSearches, setSavedSearches] = useState<LibraryFeed['savedSearches']>({
    phase: 'loading',
  })
  const [savedOffset, setSavedOffset] = useState(0)
  const [selection, setSelection] = useState<LibrarySelection>({ kind: 'library' })
  const [q, setQRaw] = useState('')
  const [filters, setFiltersRaw] = useState<LibraryFilters>({})
  const [debouncedQ, setDebouncedQ] = useState('')
  const [mode, setModeRaw] = useState<LibrarySearchMode>('metadata')
  const [sort, setSortRaw] = useState<(typeof LIBRARY_SORTS)[number]>('dateModified')
  const [direction, setDirectionRaw] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [list, setList] = useState<LibraryListState>({ phase: 'loading' })
  const [selectedRef, setSelectedRef] = useState<string | undefined>(undefined)
  const [inspector, setInspector] = useState<LibraryItemState | undefined>(undefined)
  const [refreshToken, setRefreshToken] = useState(0)
  const [libraryRetry, setLibraryRetry] = useState(0)
  const [savedRetry, setSavedRetry] = useState(0)
  const [listRetry, setListRetry] = useState(0)
  const [inspectorRetry, setInspectorRetry] = useState(0)
  const [childStates, setChildStates] = useState<Partial<Record<ChildKind, ChildLoadState>>>({})
  const childOffsets = useRef<Partial<Record<ChildKind, number>>>({})
  const childSeq = useRef<Partial<Record<ChildKind, number>>>({})
  const laneOffsets = useRef(new Map<string, number>())
  // Monotonic sequences: the winner is the request issued last, and a stale
  // answer that resolves late is dropped by comparison. Tree lanes ticket per
  // key: only a newer request for the same key invalidates a lane.
  const seq = useRef({
    libraries: 0,
    lanes: new Map<string, number>(),
    saved: 0,
    list: 0,
    inspector: 0,
  })
  // Mirror of `expanded` for the refresh path; the sync effect below is
  // declared before the tree effect, so the refresh commit reads the set the
  // user currently sees open.
  const expandedRef = useRef(expanded)
  // Live reads for the stable post-write refresh: a form that resolves after
  // its own unmount still refreshes the scope the user sees now, not the one
  // captured when the write was submitted.
  const currentLibraryRef = useRef(currentLibrary)
  currentLibraryRef.current = currentLibrary
  const selectedRefRef = useRef(selectedRef)
  selectedRefRef.current = selectedRef
  const restoredServer = useRef<string>()
  const [hydratedServer, setHydratedServer] = useState<string>()
  const active = enabled && (serverId === undefined || hydratedServer === serverId)

  /**
   * Reset on every library change: hydration on a server switch and an
   * explicit library selection. Invalidates every outstanding lane, saved,
   * list, and inspector answer, clears the lane cache, and installs the given
   * library, with stored preferences after hydration and defaults after a
   * selection.
   */
  const resetLibraryState = useCallback(
    (library: SupportedLocalLibrary, restored?: LibraryStoredState): void => {
      seq.current.list += 1
      seq.current.inspector += 1
      seq.current.saved += 1
      for (const [key, ticket] of seq.current.lanes) seq.current.lanes.set(key, ticket + 1)
      laneOffsets.current.clear()
      setLanes(new Map())
      setSavedSearches({ phase: 'loading' })
      setSavedOffset(0)
      setCurrentLibrary(library)
      setSelection(restored?.selection ?? { kind: 'library' })
      setQRaw(restored?.q ?? '')
      setDebouncedQ(restored?.q ?? '')
      setModeRaw(restored?.mode ?? 'metadata')
      setSortRaw(restored?.sort ?? 'dateModified')
      setDirectionRaw(restored?.direction ?? 'desc')
      setFiltersRaw(restored?.filters ?? {})
      setOffset(restored?.offset ?? 0)
      setExpanded(new Set(restored?.expanded ?? []))
      setSelectedRef(undefined)
      setInspector(undefined)
    },
    [],
  )

  useEffect(() => {
    if (serverId === undefined || restoredServer.current === serverId) return
    const saved = readLibraryState(serverId)
    const changedInstance = restoredServer.current !== undefined
    restoredServer.current = serverId
    // Re-key the shared plane before any lane re-reads: a changed instance
    // must never answer from the previous Zotero's cache.
    if (face.setInstance !== undefined) face.setInstance(serverId)
    else if (changedInstance) face.invalidate?.()
    resetLibraryState(saved?.library ?? { type: 'user', id: 0 }, saved)
    setHydratedServer(serverId)
    if (changedInstance) setRefreshToken((value) => value + 1)
  }, [serverId, resetLibraryState, face])

  useEffect(() => {
    if (!active || serverId === undefined || hydratedServer !== serverId) return
    writeLibraryState(serverId, {
      version: 1,
      library: currentLibrary,
      selection,
      q: debouncedQ,
      mode,
      sort,
      direction,
      offset,
      expanded: [...expanded],
      filters,
    })
  }, [
    serverId,
    active,
    hydratedServer,
    currentLibrary,
    selection,
    debouncedQ,
    mode,
    sort,
    direction,
    offset,
    expanded,
    filters,
  ])

  // The debounced query drives requests; the raw input drives the text box.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q])

  // The library selector: the complete listing on open and on refresh. The
  // host clamps and slices the full library table, so a one-page read would
  // hide every group past the first page (and the fallback below would then
  // reset a selection it cannot see); walk `nextOffset` until the end.
  useEffect(() => {
    if (!active) return
    const ticket = ++seq.current.libraries
    setLibraries({ phase: 'loading' })
    void (async () => {
      const rows: ZoteroLibraryBrowseItemView[] = []
      let cursor = 0
      for (;;) {
        const result = await face.browse(librariesRequestOf(cursor))
        if (ticket !== seq.current.libraries) return
        if (!result.ok) {
          setLibraries({ phase: 'error', message: result.error.message })
          return
        }
        rows.push(...result.value.items)
        const next = result.value.nextOffset
        if (next === undefined) break
        if (next <= cursor) {
          setLibraries({ phase: 'error', message: 'The library listing stalled mid-page.' })
          return
        }
        cursor = next
      }
      setLibraries({ phase: 'ready', options: libraryOptionsOf(rows) })
    })().catch((error: unknown) => {
      if (ticket !== seq.current.libraries) return
      setLibraries({ phase: 'error', message: messageOf(error) })
    })
  }, [active, face, refreshToken, libraryRetry])

  const loadLane = useCallback(
    (parentRef: string | undefined, offset = 0): void => {
      const key = parentRef ?? ''
      laneOffsets.current.set(key, offset)
      const ticket = (seq.current.lanes.get(key) ?? 0) + 1
      seq.current.lanes.set(key, ticket)
      setLanes((prev) =>
        new Map(prev).set(key, { phase: 'loading', previous: lanePageOf(prev.get(key)) }),
      )
      void face
        .browse(treeRequestOf(currentLibraryRef.current, parentRef, offset))
        .then((result) => {
          if (seq.current.lanes.get(key) !== ticket) return
          setLanes((prev) =>
            new Map(prev).set(
              key,
              result.ok
                ? {
                    phase: 'ready',
                    rows: collectionRowsOf(result.value.items),
                    total: result.value.total,
                    offset: result.value.offset,
                    limit: result.value.limit,
                    nextOffset: result.value.nextOffset,
                  }
                : {
                    phase: 'error',
                    message: result.error.message,
                    previous: lanePageOf(prev.get(key)),
                  },
            ),
          )
        })
        .catch((error: unknown) => {
          if (seq.current.lanes.get(key) !== ticket) return
          setLanes((prev) =>
            new Map(prev).set(key, {
              phase: 'error',
              message: messageOf(error),
              previous: lanePageOf(prev.get(key)),
            }),
          )
        })
    },
    [face],
  )

  useEffect(() => {
    expandedRef.current = expanded
  })

  /**
   * A refresh re-asks every level the tree has loaded — expanded or folded —
   * at its last offset. Collapsed-but-cached levels would otherwise serve
   * stale rows on re-expand after a collection write.
   */
  const reloadCachedTree = useCallback((): void => {
    loadLane(undefined, laneOffsets.current.get('') ?? 0)
    for (const [ref] of laneOffsets.current) {
      if (ref === '') continue
      loadLane(ref, laneOffsets.current.get(ref) ?? 0)
    }
  }, [loadLane])

  useEffect(() => {
    if (!active) return
    // Selecting a library resets `expanded` first, so the loop is empty there.
    reloadCachedTree()
  }, [active, currentLibrary, refreshToken, reloadCachedTree])

  useEffect(() => {
    if (!active) return
    const ticket = ++seq.current.saved
    setSavedSearches((previous) => ({ phase: 'loading', previous: lanePageOf(previous) }))
    void face
      .browse(savedSearchesRequestOf(currentLibrary, savedOffset))
      .then((result) => {
        if (ticket !== seq.current.saved) return
        setSavedSearches((previous) =>
          result.ok
            ? {
                phase: 'ready',
                rows: savedSearchRowsOf(result.value.items),
                total: result.value.total,
                offset: result.value.offset,
                limit: result.value.limit,
                nextOffset: result.value.nextOffset,
              }
            : { phase: 'error', message: result.error.message, previous: lanePageOf(previous) },
        )
      })
      .catch((error: unknown) => {
        if (ticket !== seq.current.saved) return
        setSavedSearches((previous) => ({
          phase: 'error',
          message: messageOf(error),
          previous: lanePageOf(previous),
        }))
      })
  }, [active, face, currentLibrary, refreshToken, savedOffset, savedRetry])

  // The item list: every toolbar change reloads from the page the offset names.
  useEffect(() => {
    if (!active) return
    const ticket = ++seq.current.list
    if (q !== debouncedQ) {
      setList({ phase: 'loading' })
      return
    }
    const query: LibraryListQuery = {
      selection,
      library: currentLibrary,
      q: debouncedQ,
      mode,
      sort,
      direction,
      offset,
      filters,
    }
    setList((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }))
    void face
      .search(listRequestOf(query))
      .then((result) => {
        if (ticket !== seq.current.list) return
        if (
          !result.ok &&
          result.error.code === 'zotero/domain' &&
          result.error.details.code === 'ZOTERO_NOT_FOUND' &&
          (selection.kind === 'collection' || selection.kind === 'savedSearch')
        ) {
          setSelection({ kind: 'library' })
          setOffset(0)
          return
        }
        setList(listStateOf(result))
      })
      .catch((error: unknown) => {
        if (ticket !== seq.current.list) return
        setList({ phase: 'error', message: messageOf(error) })
      })
  }, [
    active,
    face,
    selection,
    currentLibrary,
    q,
    debouncedQ,
    mode,
    sort,
    direction,
    offset,
    filters,
    refreshToken,
    listRetry,
  ])

  // The inspector: one detail per selected row, all child kinds included.
  useEffect(() => {
    childOffsets.current = {}
    setChildStates({})
    if (selectedRef === undefined) {
      seq.current.inspector += 1
      setInspector(undefined)
      return
    }
    const ticket = ++seq.current.inspector
    setInspector((previous) => (previous?.phase === 'ready' ? previous : { phase: 'loading' }))
    void face
      .item({ ref: selectedRef, include: INSPECTOR_INCLUDE, childPages: {} })
      .then((result) => {
        if (ticket !== seq.current.inspector) return
        setInspector(itemStateOf(result))
      })
      .catch((error: unknown) => {
        if (ticket !== seq.current.inspector) return
        setInspector({ phase: 'error', message: messageOf(error) })
      })
  }, [face, selectedRef, inspectorRetry, refreshToken])

  const pageChild = useCallback(
    (kind: ChildKind, nextOffset: number): void => {
      if (selectedRef === undefined) return
      const parentTicket = seq.current.inspector
      const ticket = (childSeq.current[kind] ?? 0) + 1
      childSeq.current[kind] = ticket
      const offset = pageOffsetOf(nextOffset)
      childOffsets.current[kind] = offset
      setChildStates((states) => ({ ...states, [kind]: { phase: 'loading' } }))
      const current = () =>
        parentTicket === seq.current.inspector && childSeq.current[kind] === ticket
      void face
        .childPage({ ref: selectedRef, kind, offset, limit: ZOTERO_CHILD_PAGE_ROWS })
        .then((result) => {
          if (!current()) return
          if (!result.ok) {
            setChildStates((states) => ({
              ...states,
              [kind]: { phase: 'error', message: result.error.message },
            }))
            return
          }
          if (result.value.kind !== kind) {
            setChildStates((states) => ({
              ...states,
              [kind]: { phase: 'error', message: 'The child page answered a different kind.' },
            }))
            return
          }
          setInspector((state) =>
            state?.phase === 'ready'
              ? { phase: 'ready', detail: { ...state.detail, [kind]: result.value.page } }
              : state,
          )
          setChildStates((states) => ({ ...states, [kind]: undefined }))
        })
        .catch((error: unknown) => {
          if (current())
            setChildStates((states) => ({
              ...states,
              [kind]: { phase: 'error', message: messageOf(error) },
            }))
        })
    },
    [face, selectedRef],
  )

  const toggleCollection = useCallback(
    (ref: string): void => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(ref)) next.delete(ref)
        else next.add(ref)
        return next
      })
      // Expanding a level the cache has never loaded requests it; a re-expand
      // of a previously loaded level reuses the cached rows until refresh.
      if (!lanes.has(ref)) loadLane(ref)
    },
    [lanes, loadLane],
  )

  const flatTree = useMemo(() => {
    const roots = lanePageOf(lanes.get(''))?.rows ?? []
    return flattenTree(
      roots,
      (ref) => lanePageOf(lanes.get(ref)),
      expanded,
      lanePageOf(lanes.get('')),
    )
  }, [lanes, expanded])

  /**
   * Rewind the list and drop the inspector: any change to what the list shows
   * invalidates both, and the sequence bumps drop answers still in flight.
   */
  const rewindList = useCallback((nextOffset = 0): void => {
    seq.current.list += 1
    seq.current.inspector += 1
    setOffset(nextOffset)
    setSelectedRef(undefined)
    setInspector(undefined)
  }, [])

  const selectLibrary = useCallback(
    (library: SupportedLocalLibrary): void => {
      resetLibraryState(library)
    },
    [resetLibraryState],
  )

  const selectScope = useCallback(
    (next: LibrarySelection): void => {
      setSelection(next)
      rewindList()
    },
    [rewindList],
  )

  const setMode = useCallback(
    (next: LibrarySearchMode): void => {
      setModeRaw(next)
      rewindList()
    },
    [rewindList],
  )

  const setSort = useCallback(
    (next: (typeof LIBRARY_SORTS)[number], nextDirection: 'asc' | 'desc'): void => {
      setSortRaw(next)
      setDirectionRaw(nextDirection)
      rewindList()
    },
    [rewindList],
  )

  const gotoOffset = useCallback(
    (next: number): void => {
      rewindList(pageOffsetOf(next))
    },
    [rewindList],
  )

  const setQ = useCallback(
    (next: string): void => {
      setQRaw(next)
      rewindList()
    },
    [rewindList],
  )

  const setFilters = useCallback(
    (next: LibraryFilters): void => {
      setFiltersRaw(next)
      rewindList()
    },
    [rewindList],
  )

  const refresh = useCallback((): void => {
    face.invalidate?.()
    setRefreshToken((token) => token + 1)
  }, [face])

  /**
   * The post-write invalidation, stable so a write form can invoke it after
   * its own unmount. Reads the live refs: the refreshed scope is the one the
   * user sees now, not the one captured when the write was submitted.
   */
  const refreshAffected = useCallback(
    (kind: 'items' | 'collections' | 'savedSearches'): void => {
      face.invalidate?.()
      if (kind === 'collections') reloadCachedTree()
      if (kind === 'savedSearches') setSavedRetry((value) => value + 1)
      setListRetry((value) => value + 1)
      if (selectedRefRef.current !== undefined) setInspectorRetry((value) => value + 1)
    },
    [face, reloadCachedTree],
  )

  useEffect(() => {
    // `phase: 'ready'` means the listing walked to its end, so a missing
    // library is a real absence (a deleted group), not a paging gap.
    if (libraries.phase !== 'ready' || libraries.options.length === 0) return
    if (!libraries.options.some(({ library }) => sameLibrary(library, currentLibrary))) {
      selectLibrary(PERSONAL_LIBRARY)
    }
  }, [libraries, currentLibrary, selectLibrary])

  return {
    libraries,
    currentLibrary,
    selectLibrary,
    flatTree,
    expanded,
    toggleCollection,
    pageTree: loadLane,
    retryTree: (ref) => loadLane(ref, laneOffsets.current.get(ref ?? '') ?? 0),
    treeLane: (ref) => lanes.get(ref ?? ''),
    savedSearches,
    pageSavedSearches: (next) => setSavedOffset(pageOffsetOf(next)),
    retrySavedSearches: () => setSavedRetry((value) => value + 1),
    selection,
    selectScope,
    q,
    setQ,
    filters,
    setFilters,
    mode,
    setMode,
    sort,
    direction,
    setSort,
    list,
    offset,
    gotoOffset,
    selectedRef,
    selectItem: (ref) => {
      seq.current.inspector += 1
      setSelectedRef(ref)
      childOffsets.current = {}
      setChildStates({})
    },
    inspector,
    refreshToken,
    refresh,
    refreshAffected,
    retryLibraries: () => setLibraryRetry((value) => value + 1),
    retryList: () => setListRetry((value) => value + 1),
    retryInspector: () => setInspectorRetry((value) => value + 1),
    pageChild,
    childStates,
    retryChild: (kind) => pageChild(kind, childOffsets.current[kind] ?? 0),
  }
}
