import { LIBRARY_DEFAULTS, type LibraryPreferences } from '../../../library-preferences.ts'
import { ZOTERO_CHILD_PAGE_ROWS } from '../../../constants.ts'
import type {
  LibrarySessionView,
  LibraryViewMemory,
  LibraryViewStore,
} from './library-view-store.ts'
/**
 * The library panel's data feed: one hook owning the item list, the library
 * selector, the inspector, and persistence, plus the seam through which the
 * panel reaches navigation. The panel mounts while its sidebar entry is
 * selected, so requests run on open and stop on switch-away. Each of these
 * lanes numbers its requests with a monotonic sequence; an answer whose
 * sequence is not the latest is dropped. Collection and saved-search lanes
 * belong to `useLibraryNavigation`, which fences them by library version.
 * @module dsh-zotero/client/components/library/useLibraryFeed
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SupportedLocalLibrary,
  ZoteroChildListingKind,
  ZoteroLibraryBrowseItemView,
} from '../../../contract.ts'
import {
  type CollectionRowView,
  type FlatCollectionRow,
  type LibraryLaneState,
  type LibraryListQuery,
  type LibraryFilters,
  type LibraryListState,
  type LibrarySelection,
  type LibraryItemState,
  type LibraryPane,
  type LibrarySelectorState,
  type SavedSearchRowView,
  itemStateOf,
  isContainerOnly,
  librariesRequestOf,
  libraryOptionsOf,
  LIBRARY_SORTS,
  listRequestOf,
  listStateOf,
  pageOffsetOf,
  PERSONAL_LIBRARY,
  sameLibrary,
} from './library-model.ts'
import { objectIdentity, scopeIdentity, scopeKeyOf } from './navigation-identity.ts'
import { laneFailureOf } from './library-errors.ts'
import { useLibraryChildFeed } from './useLibraryChildFeed.ts'
import { useLibraryNavigation } from './useLibraryNavigation.ts'
import {
  readLibraryState,
  clearLibraryState,
  writeLibraryState,
  type LibraryStoredState,
} from './library-storage.ts'
import { librarySessionKeyOf } from './library-view-store.ts'
import type { ChildKind, ChildLoadState, LibraryFeedFace } from './library-feed-types.ts'

// Match the host Workspace Browser search delay.
const SEARCH_DEBOUNCE_MS = 250
const LOADING_LIST: LibraryListState = Object.freeze({ phase: 'loading' })

const INSPECTOR_INCLUDE: readonly ZoteroChildListingKind[] = ['notes', 'attachments', 'annotations']

type CollectionRow = CollectionRowView

interface LibraryFeed {
  readonly storageError?: string
  readonly clearPosition: () => boolean
  readonly locate: () => void
  readonly locatedRef?: string
  readonly locateError?: string
  readonly narrowPane: LibraryPane
  readonly setNarrowPane: (pane: LibraryPane) => void
  readonly libraries: LibrarySelectorState
  readonly currentLibrary: SupportedLocalLibrary
  readonly selectLibrary: (library: SupportedLocalLibrary) => void
  readonly flatTree: readonly FlatCollectionRow[]
  readonly expanded: ReadonlySet<string>
  /** The object identity of one ref under this feed's instance; the tree compares with it. */
  readonly identityOf: (ref: string) => string
  readonly toggleCollection: (ref: string) => void
  readonly loadMoreTree: (ref: string | undefined) => void
  readonly retryTree: (ref: string | undefined) => void
  readonly treeLane: (ref: string | undefined) => LibraryLaneState<CollectionRow> | undefined
  readonly savedSearches: LibraryLaneState<SavedSearchRowView>
  readonly loadMoreSavedSearches: () => void
  readonly retrySavedSearches: () => void
  readonly selection: LibrarySelection
  /** Instance + library + scope: the key every scope-owned surface remounts on. */
  readonly scopeKey: string
  readonly selectScope: (selection: LibrarySelection) => void
  readonly q: string
  /** Query committed to the list request, excluding the current typing draft. */
  readonly listQuery: string
  readonly setQ: (q: string) => void
  readonly filters: LibraryFilters
  readonly setFilters: (filters: LibraryFilters) => void
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
  /** Changes when tags may differ: a refresh, an item write, or a new instance. */
  readonly tagsRefresh: number
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
  serverId: string | undefined,
  enabled: boolean,
  sessionId: string,
  viewStore: LibraryViewStore,
  preferences: LibraryPreferences = LIBRARY_DEFAULTS,
  memory?: LibraryViewMemory,
  visible = true,
  // The panel already read the pre-probe session payload; reuse it instead of
  // scanning the store a second time. A caller that passes nothing keeps the
  // hook's own read.
  initialViewOverride?: LibrarySessionView,
): LibraryFeed {
  // The session cache carries only the detail payload; every preference and
  // the view pins (`selectedRef` / `narrowPane`) hydrate from localStorage.
  const initialView = useMemo(
    () => initialViewOverride ?? viewStore.sessionView(undefined, sessionId),
    [initialViewOverride, viewStore, sessionId],
  )
  const [storageError, setStorageError] = useState<string>()
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const [libraries, setLibraries] = useState<LibraryFeed['libraries']>({ phase: 'loading' })
  const [currentLibrary, setCurrentLibrary] = useState<SupportedLocalLibrary>(PERSONAL_LIBRARY)
  const [prefixes, setPrefixes] = useState<Readonly<Record<string, number>>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const [selection, setSelection] = useState<LibrarySelection>({ kind: 'library' })
  /** The instance + library + scope key every scope-owned surface remounts on. */
  const scopeKey = scopeKeyOf(currentLibrary, selection, serverId)
  const liveScope = useRef(scopeKey)
  liveScope.current = scopeKey
  const [q, setQRaw] = useState('')
  const [filters, setFiltersRaw] = useState<LibraryFilters>({})
  const [debouncedQ, setDebouncedQ] = useState('')
  const [sort, setSortRaw] = useState<(typeof LIBRARY_SORTS)[number]>('dateModified')
  const [direction, setDirectionRaw] = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset] = useState(0)
  const [listOwner, setListOwner] = useState('')
  const [list, setList] = useState<LibraryListState>({ phase: 'loading' })
  const [selectedRef, setSelectedRef] = useState<string | undefined>(undefined)
  const [inspector, setInspector] = useState<LibraryItemState | undefined>(
    () => initialView?.inspector,
  )
  const [narrowPane, setNarrowPaneState] = useState<LibraryPane>('list')

  const setNarrowPane = useCallback((pane: LibraryPane) => {
    setNarrowPaneState(pane)
  }, [])
  const [refreshToken, setRefreshToken] = useState(0)
  // The tag pane uses its own token because it reads a library-wide vocabulary
  // outside the list lanes.
  const [tagsRefresh, setTagsRefresh] = useState(0)
  const [libraryRetry, setLibraryRetry] = useState(0)
  const [listRetry, setListRetry] = useState(0)
  const [inspectorRetry, setInspectorRetry] = useState(0)
  // The list owner is one string that names the exact request in flight; the
  // raw `q` is absent because the list effect parks on `q !== debouncedQ`
  // instead, so the identity stays stable while the user types.
  const requestIdentity = useMemo(
    () =>
      JSON.stringify([
        serverId,
        currentLibrary,
        scopeIdentity(selection, serverId),
        debouncedQ,
        sort,
        direction,
        offset,
        filters,
        refreshToken,
        listRetry,
      ]),
    [
      serverId,
      currentLibrary,
      selection,
      debouncedQ,
      sort,
      direction,
      offset,
      filters,
      refreshToken,
      listRetry,
    ],
  )
  // Monotonic sequences: the winner is the request issued last, and a stale
  // answer that resolves late is dropped by comparison. Collection and
  // saved-search lanes are not here: they carry their own generation and
  // library-version fence in `useLibraryNavigation`.
  const seq = useRef({
    libraries: 0,
    list: 0,
    inspector: 0,
  })
  const inspectorTicketOf = useCallback(() => seq.current.inspector, [])
  const childFeed = useLibraryChildFeed(face, selectedRef, inspectorTicketOf, setInspector)
  const { childStates, pageChild, reset: resetChildren } = childFeed
  // Live reads for the stable post-write refresh: a form that resolves after
  // its own unmount still refreshes the scope the user sees now, not the one
  // captured when the write was submitted.
  useEffect(() => {
    if (memory?.disclosure && memory.disclosure.ref !== selectedRef) memory.disclosure = undefined
  }, [selectedRef, memory])
  const selectedRefRef = useRef(selectedRef)
  selectedRefRef.current = selectedRef
  const restoredServer = useRef<string>()
  const restoredSession = useRef<string>()
  const viewIdentity = librarySessionKeyOf(serverId, sessionId)
  const persistence = useMemo(
    () => ({ viewIdentity, query: '', state: undefined as LibraryStoredState | undefined }),
    [viewIdentity],
  )
  persistence.query = q
  /** The exact state last written, keyed by instance so a switch re-persists. */
  const lastPersisted = useRef<{ serverId: string; serialized: string }>()
  const [hydratedView, setHydratedView] = useState<string>()
  const active = enabled && serverId !== undefined && hydratedView === viewIdentity

  /** The one identity spelling every consumer compares against this instance, memoized per ref. */
  const identityCache = useRef<{ serverId: string | undefined; map: Map<string, string> }>({
    serverId: undefined,
    map: new Map(),
  })
  const identityOf = useCallback(
    (ref: string): string => {
      if (identityCache.current.serverId !== serverId)
        identityCache.current = { serverId, map: new Map() }
      let identity = identityCache.current.map.get(ref)
      if (identity === undefined) {
        identity = objectIdentity(ref, serverId)
        if (identityCache.current.map.size >= 2000) identityCache.current.map.clear()
        identityCache.current.map.set(ref, identity)
      }
      return identity
    },
    [serverId],
  )

  const navigation = useLibraryNavigation({
    face,
    instance: { serverId, library: currentLibrary },
    active,
    expansion: { expanded, setExpanded },
    restore: { prefixes },
    selection: { value: selection, update: setSelection },
    identityOf,
  })
  const {
    flatTree,
    savedSearches,
    cancelLocate,
    loadMore: loadMoreNavigation,
    retryTree: retryNavigation,
    locate: locateNavigation,
  } = navigation
  const reloadCachedTree = navigation.refresh
  const refreshSavedLane = navigation.refreshSaved

  /**
   * Reset on every library change: hydration on a server switch and an
   * explicit library selection. Installs the given library, with stored
   * preferences after hydration, the caller's kept reading preferences after
   * a selection, and defaults otherwise.
   */
  const resetLibraryState = useCallback(
    (
      library: SupportedLocalLibrary,
      restored?: LibraryStoredState,
      keep?: Pick<LibraryFeed, 'sort' | 'direction'>,
    ): void => {
      seq.current.list += 1
      setPrefixes(restored?.prefixes ?? {})
      setCurrentLibrary(library)
      setSelection(restored?.selection ?? { kind: 'library' })
      setQRaw(restored?.q ?? '')
      setDebouncedQ(restored?.q ?? '')
      setSortRaw(restored?.sort ?? keep?.sort ?? 'dateModified')
      setDirectionRaw(restored?.direction ?? keep?.direction ?? 'desc')
      setFiltersRaw(restored?.filters ?? {})
      setOffset(restored?.offset ?? 0)
      setExpanded(new Set(restored?.expanded ?? []))
      // Hydration is the one path that restores a selection. The cached detail
      // survives when it still names that row: the inspector effect then
      // refreshes it without dropping the ready payload back to `loading`.
      seq.current.inspector += 1
      setSelectedRef(restored?.selectedRef)
      setInspector((previous) =>
        previous?.phase === 'ready' && previous.detail.ref === restored?.selectedRef
          ? previous
          : undefined,
      )
      setNarrowPaneState(
        restored?.narrowPane ?? (restored?.selectedRef !== undefined ? 'inspector' : 'list'),
      )
    },
    [],
  )

  useEffect(() => {
    if (
      serverId === undefined ||
      (restoredServer.current === serverId && restoredSession.current === sessionId)
    )
      return
    setStorageError(undefined)
    lastPersisted.current = undefined
    let saved = memory?.resetPending ? undefined : memory?.snapshot
    if (!saved && !memory?.resetPending && preferences.reopenBehavior === 'restore') {
      try {
        saved = readLibraryState(serverId, sessionId)
      } catch (error) {
        setStorageError(laneFailureOf(error))
      }
    }
    if (memory) {
      memory.scroll = saved?.scroll ?? memory.scroll
      if (saved?.selectedRef && saved.childPages)
        memory.childPages = { ref: saved.selectedRef, offsets: saved.childPages }
      memory.resetPending = false
    }
    const changedInstance =
      restoredServer.current !== undefined && restoredServer.current !== serverId
    restoredServer.current = serverId
    restoredSession.current = sessionId
    // Re-key the shared plane before any lane re-reads: a changed instance
    // must never answer from the previous Zotero's cache.
    if (face.setInstance !== undefined) face.setInstance(serverId)
    else if (changedInstance) face.invalidate?.()
    resetLibraryState(saved?.library ?? { type: 'user', id: 0 }, saved)
    setHydratedView(viewIdentity)
    if (changedInstance) {
      setRefreshToken((value) => value + 1)
      setTagsRefresh((value) => value + 1)
    }
  }, [
    serverId,
    resetLibraryState,
    face,
    sessionId,
    viewIdentity,
    memory,
    preferences.reopenBehavior,
  ])

  // Persist by content, not by reference. Navigation publishes a fresh
  // `prefixes` object for every pagination step, including loading states
  // whose visible prefix is unchanged; keying the effect on that identity
  // made each intermediate publish a synchronous localStorage write of an
  // identical value. Serializing inside the effect prevents JSON.stringify
  // from running on every keystroke/render tick.
  useEffect(() => {
    if (
      !active ||
      storageError ||
      serverId === undefined ||
      hydratedView !== viewIdentity ||
      (memory !== undefined && (memory.serverId !== serverId || memory.sessionId !== sessionId))
    )
      return
    const persistedState: LibraryStoredState = {
      version: 4,
      prefixes: navigation.prefixes,
      library: currentLibrary,
      selection,
      // Persist the debounced query so typing updates storage once per pause.
      q: debouncedQ,
      sort,
      direction,
      offset,
      expanded: [...expanded],
      filters,
      selectedRef,
      scroll: memory?.scroll,
      childPages:
        memory?.childPages && memory.childPages.ref === selectedRef
          ? memory.childPages.offsets
          : undefined,
      narrowPane,
    }
    const serialized = JSON.stringify(persistedState)
    persistence.state = persistedState
    if (
      lastPersisted.current?.serverId === serverId &&
      lastPersisted.current.serialized === serialized
    )
      return
    if (memory) {
      memory.snapshot = persistedState
      const ownerServerId = serverId
      const ownerSessionId = sessionId
      const ownerKey = JSON.stringify([ownerServerId, ownerSessionId])
      memory.saveScrollKey = ownerKey
      memory.saveScroll = (flush = false) => {
        if (
          memory.serverId !== ownerServerId ||
          memory.sessionId !== ownerSessionId ||
          memory.saveScrollKey !== ownerKey ||
          memory.snapshot === undefined
        )
          return
        if (!visibleRef.current && !flush) return
        const state = { ...memory.snapshot, scroll: { ...memory.scroll } }
        try {
          writeLibraryState(ownerServerId, ownerSessionId, state)
        } catch (error) {
          setStorageError(laneFailureOf(error))
        }
      }
    }
    if (!visible) return
    try {
      writeLibraryState(serverId, sessionId, persistedState)
    } catch (error) {
      setStorageError(laneFailureOf(error))
      return
    }
    lastPersisted.current = { serverId, serialized }
  }, [
    active,
    serverId,
    hydratedView,
    viewIdentity,
    sessionId,
    memory,
    visible,
    storageError,
    debouncedQ,
    navigation.prefixes,
    currentLibrary,
    selection,
    sort,
    direction,
    offset,
    expanded,
    filters,
    selectedRef,
    narrowPane,
    persistence,
  ])

  useEffect(() => {
    const flush = () => {
      const state = persistence.state
      if (serverId !== undefined && state !== undefined && state.q !== persistence.query) {
        const latest = { ...state, q: persistence.query }
        try {
          writeLibraryState(serverId, sessionId, latest)
          persistence.state = latest
          if (memory?.serverId === serverId && memory.sessionId === sessionId)
            memory.snapshot = latest
        } catch (error) {
          setStorageError(laneFailureOf(error))
        }
      }
      memory?.flushScrollSave()
    }
    if (!active || !visible) {
      flush()
      return
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [active, visible, serverId, sessionId, memory, persistence])

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
    // One controller per activation: the walk may span several pages, and a
    // toolbar change must abandon the ones still in flight.
    const controller = new AbortController()
    const ticket = ++seq.current.libraries
    setLibraries({ phase: 'loading' })
    void (async () => {
      const rows: ZoteroLibraryBrowseItemView[] = []
      let cursor = 0
      for (;;) {
        const result = await face.browse(librariesRequestOf(cursor), controller.signal)
        if (ticket !== seq.current.libraries) return
        if (!result.ok) {
          setLibraries({ phase: 'error', message: result.error.message })
          return
        }
        rows.push(...result.value.items)
        const next = result.value.nextOffset
        if (next === undefined) break
        if (next <= cursor) {
          setLibraries({ phase: 'error', message: 'libraryErrorListingStalled' })
          return
        }
        cursor = next
      }
      setLibraries({ phase: 'ready', options: libraryOptionsOf(rows) })
    })().catch((error: unknown) => {
      if (ticket !== seq.current.libraries) return
      setLibraries({ phase: 'error', message: laneFailureOf(error) })
    })
    return () => controller.abort()
  }, [active, face, refreshToken, libraryRetry])

  useEffect(
    () => () => {
      seq.current.list++
      seq.current.inspector++
      seq.current.libraries++
      resetChildren()
    },
    [active, serverId, resetChildren],
  )

  // The item list: every toolbar change reloads from the page the offset names.
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const ticket = ++seq.current.list
    if (q !== debouncedQ) {
      setList(LOADING_LIST)
      controller.abort()
      return
    }
    const query: LibraryListQuery = {
      selection,
      library: currentLibrary,
      q,
      sort,
      direction,
      offset,
      filters,
    }
    setListOwner(requestIdentity)
    setList(LOADING_LIST)
    void face
      .search(listRequestOf(query), controller.signal)
      .then((result) => {
        if (ticket !== seq.current.list) return
        setList(listStateOf(result))
      })
      .catch((error: unknown) => {
        if (ticket !== seq.current.list) return
        setList({ phase: 'error', message: laneFailureOf(error) })
      })
    return () => controller.abort()
  }, [
    active,
    face,
    selection,
    currentLibrary,
    q,
    debouncedQ,
    sort,
    direction,
    offset,
    filters,
    refreshToken,
    listRetry,
    requestIdentity,
  ])

  // The inspector: one detail per selected row, all child kinds included.
  useEffect(() => {
    if (!active) return
    if (selectedRef === undefined) {
      // Deselecting already cleared the detail (`selectItem` / `rewindList`);
      // the cached payload survives here so hydration can still restore it on
      // a remount that has not read its view pins yet.
      seq.current.inspector += 1
      resetChildren()
      return
    }
    // Each effect activation owns a fresh detail read, including reconnects.
    const controller = new AbortController()
    resetChildren()
    const ticket = ++seq.current.inspector
    setInspector((previous) =>
      previous?.phase === 'ready' && previous.detail.ref === selectedRef
        ? previous
        : { phase: 'loading' },
    )
    void face
      .item(
        {
          ref: selectedRef,
          include: INSPECTOR_INCLUDE,
          childPages: Object.fromEntries(
            INSPECTOR_INCLUDE.map((kind) => [
              kind,
              {
                offset:
                  memory?.childPages && memory.childPages.ref === selectedRef
                    ? (memory.childPages.offsets[kind] ?? 0)
                    : 0,
                limit: ZOTERO_CHILD_PAGE_ROWS,
              },
            ]),
          ),
        },
        controller.signal,
      )
      .then((result) => {
        if (ticket !== seq.current.inspector) return
        setInspector(itemStateOf(result))
      })
      .catch((error: unknown) => {
        if (ticket !== seq.current.inspector) return
        setInspector({ phase: 'error', message: laneFailureOf(error) })
      })
    return () => controller.abort()
  }, [active, face, selectedRef, inspectorRetry, refreshToken, resetChildren, memory])

  /**
   * Open or close one branch. Refs may arrive in alias spellings, so
   * membership compares object identity instead of string equality.
   */
  const setBranchOpen = useCallback(
    (ref: string, open: boolean) => {
      setExpanded((prev) => {
        const key = objectIdentity(ref, serverId)
        const matching = [...prev].filter((item) => objectIdentity(item, serverId) === key)
        if (open) return matching.length > 0 ? prev : new Set([...prev, ref])
        if (matching.length === 0) return prev
        const next = new Set(prev)
        matching.forEach((item) => next.delete(item))
        return next
      })
    },
    [serverId],
  )

  const toggleCollection = useCallback(
    (ref: string) => {
      cancelLocate()
      const lane = navigation.treeLane(ref)
      if (lane?.phase === 'ready' && lane.total === 0) return
      const key = objectIdentity(ref, serverId)
      setBranchOpen(ref, ![...expanded].some((item) => objectIdentity(item, serverId) === key))
    },
    [expanded, navigation, serverId, setBranchOpen, cancelLocate],
  )

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
      if (sameLibrary(library, currentLibrary)) return
      // Switching library keeps how the reader reads: the sort is about the
      // list, not the library that list belongs to.
      resetLibraryState(library, undefined, { sort, direction })
    },
    [resetLibraryState, currentLibrary, sort, direction],
  )

  const selectScope = useCallback(
    (next: LibrarySelection): void => {
      const nextId = scopeIdentity(next, serverId)
      const row =
        next.kind === 'collection'
          ? flatTree.find(({ row }) => objectIdentity(row.ref, serverId) === nextId)?.row
          : undefined
      // Zotero counts items directly in the collection. Zero items with
      // children is a container-only collection: its content is the branch,
      // so selecting it opens the branch instead of parking on an empty list.
      const containerRef =
        next.kind === 'collection' && row !== undefined && isContainerOnly(row)
          ? next.ref
          : undefined
      const pane = containerRef === undefined ? 'list' : 'tree'
      if (nextId === scopeIdentity(selection, serverId)) {
        if (containerRef !== undefined) setBranchOpen(containerRef, true)
        setNarrowPaneState(pane)
        return
      }
      cancelLocate()
      setSelection(next.kind === 'collection' && row ? { ...next, path: row.path } : next)
      if (
        preferences.scopeChangeBehavior === 'clear' ||
        !['library', 'collection'].includes(next.kind) ||
        !['library', 'collection'].includes(selection.kind)
      ) {
        setQRaw('')
        setDebouncedQ('')
        setFiltersRaw({})
      }
      rewindList()
      if (containerRef !== undefined) setBranchOpen(containerRef, true)
      setNarrowPaneState(pane)
    },
    [
      rewindList,
      selection,
      serverId,
      flatTree,
      setBranchOpen,
      preferences.scopeChangeBehavior,
      cancelLocate,
    ],
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
      if (liveScope.current !== scopeKey) return
      setFiltersRaw(next)
      rewindList()
    },
    [rewindList, scopeKey],
  )

  const refresh = useCallback((): void => {
    face.invalidate?.()
    setRefreshToken((token) => token + 1)
    setTagsRefresh((token) => token + 1)
    reloadCachedTree()
  }, [face, reloadCachedTree])

  /**
   * The post-write invalidation, stable so a write form can invoke it after
   * its own unmount. Reads the live refs: the refreshed scope is the one the
   * user sees now, not the one captured when the write was submitted. A
   * collection write can move any ancestor, so it rebuilds the tree and
   * re-proves the located path; a saved-search write owns one lane. An item
   * write can add or drop tags, so the tag pane re-reads its vocabulary.
   */
  const refreshAffected = useCallback(
    (kind: 'items' | 'collections' | 'savedSearches'): void => {
      face.invalidate?.()
      if (kind === 'collections') reloadCachedTree()
      if (kind === 'savedSearches') refreshSavedLane()
      if (kind === 'items') setTagsRefresh((token) => token + 1)
      setListRetry((value) => value + 1)
      if (selectedRefRef.current !== undefined) setInspectorRetry((value) => value + 1)
    },
    [face, reloadCachedTree, refreshSavedLane],
  )

  useEffect(() => {
    // `phase: 'ready'` means the listing walked to its end, so a missing
    // library is a real absence (a deleted group), not a paging gap.
    if (libraries.phase !== 'ready' || libraries.options.length === 0) return
    if (!libraries.options.some(({ library }) => sameLibrary(library, currentLibrary))) {
      selectLibrary(PERSONAL_LIBRARY)
    }
  }, [libraries, currentLibrary, selectLibrary])

  const selectItem = useCallback(
    (ref: string | undefined) => {
      seq.current.inspector += 1
      setSelectedRef(ref)
      resetChildren()
      if (ref !== undefined) setNarrowPaneState('inspector')
      else setInspector(undefined)
    },
    [resetChildren],
  )
  const retryList = useCallback(() => setListRetry((value) => value + 1), [])
  const retryInspector = useCallback(() => setInspectorRetry((value) => value + 1), [])
  const loadMoreTree = useCallback(
    (ref: string | undefined) => {
      void loadMoreNavigation(ref)
    },
    [loadMoreNavigation],
  )
  const retryTree = useCallback(
    (ref: string | undefined) => {
      void retryNavigation(ref)
    },
    [retryNavigation],
  )
  const locate = useCallback(() => {
    setNarrowPaneState('tree')
    void locateNavigation()
  }, [locateNavigation])
  const pageChildWithMemory = useCallback(
    (kind: ChildKind, offset: number) => {
      if (memory && selectedRef) {
        if (memory.childPages?.ref !== selectedRef)
          memory.childPages = { ref: selectedRef, offsets: {} }
        memory.childPages.offsets[kind] = offset
      }
      pageChild(kind, offset)
    },
    [memory, selectedRef, pageChild],
  )
  const childOffsetOf = childFeed.childOffsetOf
  const retryChild = useCallback(
    (kind: ChildKind) =>
      pageChild(
        kind,
        memory?.childPages?.ref === selectedRef
          ? (memory?.childPages?.offsets[kind] ?? 0)
          : childOffsetOf(kind),
      ),
    [memory, selectedRef, pageChild, childOffsetOf],
  )

  const clearPosition = useCallback(() => {
    seq.current.list += 1
    seq.current.inspector += 1
    resetChildren()
    cancelLocate()
    resetLibraryState(PERSONAL_LIBRARY)
    if (memory) {
      memory.cancelScrollSave()
      memory.childPages = undefined
      memory.snapshot = undefined
      memory.scroll = {}
      memory.disclosure = undefined
    }
    lastPersisted.current = undefined
    try {
      if (serverId) clearLibraryState(serverId, sessionId)
      setStorageError(undefined)
      return true
    } catch (error) {
      setStorageError(laneFailureOf(error))
      return false
    }
  }, [resetChildren, cancelLocate, resetLibraryState, memory, serverId, sessionId])

  return {
    storageError,
    clearPosition,
    libraries,
    currentLibrary,
    selectLibrary,
    flatTree,
    expanded: navigation.expanded,
    identityOf,
    toggleCollection,
    loadMoreTree,
    retryTree,
    treeLane: navigation.treeLane,
    savedSearches,
    loadMoreSavedSearches: () => {
      void navigation.loadMoreSaved()
    },
    retrySavedSearches: () => {
      void navigation.retrySaved()
    },
    locate,
    locatedRef: navigation.locatedRef,
    locateError: navigation.locateError,
    selection,
    scopeKey,
    selectScope,
    q,
    listQuery: debouncedQ,
    setQ,
    filters,
    setFilters,
    sort,
    direction,
    setSort,
    list: listOwner === requestIdentity ? list : LOADING_LIST,
    offset,
    gotoOffset,
    narrowPane,
    setNarrowPane,
    selectedRef,
    selectItem,
    inspector,
    refreshToken,
    tagsRefresh,
    refresh,
    refreshAffected,
    retryLibraries: () => setLibraryRetry((value) => value + 1),
    retryList,
    retryInspector,
    pageChild: pageChildWithMemory,
    childStates,
    retryChild,
  }
}
