/**
 * Pure projections for the library panel: the scope/selection model, the
 * wire-request builders, the tree flattening, and the list/inspector state
 * machines. Everything here is a pure function over contract views; the
 * helper spec exercises the panel without mounting it.
 * @module dsh-zotero/client/components/library/library-model
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_SORT_FIELDS } from '../../../constants.ts'
import { isPdfContentType } from '../../../media-types.ts'
import type {
  SupportedLocalLibrary,
  ZoteroAttachmentRowView,
  ZoteroItemDetailView,
  ZoteroLibraryBrowseItemView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibrarySearchRequestView,
  ZoteroLibrarySearchScopeView,
  ZoteroLibrarySortField,
  ZoteroSearchItemView,
  ZoteroSearchResultView,
} from '../../../contract.ts'

/** Rows per listing page; the host clamps it to `maxBrowseResults`/`maxSearchResults` and returns the effective `limit`. */
export const LIBRARY_PAGE_SIZE = 50

/** The canonical personal library; the host lists it first on every page walk. */
export const PERSONAL_LIBRARY: SupportedLocalLibrary = { type: 'user', id: 0 }

/** The narrow layout's panes; a wide layout shows all three side by side. */
export type LibraryPane = 'tree' | 'list' | 'inspector'

/** A non-negative integer page offset from untrusted arithmetic. */
export function pageOffsetOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** The previous page's offset: one served page back, floored at 0. */
export function previousPageOffsetOf(offset: number, limit: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.max(0, Math.floor(offset) - Math.floor(limit))
}

/** The stable key one library answers to, in the selector and in storage. */
export function libraryKeyOf(library: SupportedLocalLibrary): string {
  return `${library.type}:${library.id}`
}

/** Whether two library selectors name the same library. */
export function sameLibrary(a: SupportedLocalLibrary, b: SupportedLocalLibrary): boolean {
  return a.type === b.type && a.id === b.id
}

/** The attachment the inspector's head action opens: Zotero's best choice first. */
export function pdfAttachmentOf(detail: ZoteroItemDetailView): ZoteroAttachmentRowView | undefined {
  if (detail.bestAttachment !== undefined && isPdfContentType(detail.bestAttachment.contentType)) {
    return detail.bestAttachment
  }
  return detail.attachments?.items.find((attachment) => isPdfContentType(attachment.contentType))
}

/** The sort fields the panel offers, in toolbar order. */
export const LIBRARY_SORTS = ZOTERO_SORT_FIELDS

/** The search modes the panel's toggle switches between. */
export type LibrarySearchMode = 'metadata' | 'everything'

/**
 * What the item list currently lists. The wire scope is derived from it; the
 * selection carries the display facts (the collection or search name) the
 * tree row already holds, so the list header does not resolve names again.
 */
export type LibrarySelection =
  | { kind: 'library' }
  | { kind: 'publications' }
  | { kind: 'trash' }
  | { kind: 'collection'; ref: string; name: string }
  | { kind: 'savedSearch'; ref: string; name: string }

/** The wire scope a selection lists. */
export function scopeViewOf(selection: LibrarySelection): ZoteroLibrarySearchScopeView {
  switch (selection.kind) {
    case 'library':
    case 'publications':
    case 'trash':
      return { kind: selection.kind }
    case 'collection':
      return { kind: 'collection', refOrName: selection.ref }
    case 'savedSearch':
      return { kind: 'savedSearch', refOrName: selection.ref }
  }
}

/** One item-list page request for the current toolbar state. */
export interface LibraryListQuery {
  readonly selection: LibrarySelection
  readonly library: SupportedLocalLibrary
  readonly q: string
  readonly mode: LibrarySearchMode
  readonly sort: ZoteroLibrarySortField
  readonly direction: 'asc' | 'desc'
  readonly offset: number
  readonly filters?: LibraryFilters
}

export type LibraryFilters = Pick<
  ZoteroLibrarySearchRequestView,
  'itemTypes' | 'tags' | 'tagMatch' | 'yearFrom' | 'yearTo' | 'hasAttachment'
>

/** The wire request one list page produces. */
export function listRequestOf(query: LibraryListQuery): ZoteroLibrarySearchRequestView {
  return {
    ...query.filters,
    scope: scopeViewOf(query.selection),
    library: query.library,
    ...(query.q !== '' ? { q: query.q } : {}),
    mode: query.mode,
    sort: query.sort,
    direction: query.direction,
    offset: query.offset,
    limit: LIBRARY_PAGE_SIZE,
  }
}

/** One browse listing request for a tree level. */
export function treeRequestOf(
  library: SupportedLocalLibrary,
  parentRef: string | undefined,
  offset = 0,
): ZoteroLibraryBrowseRequestView {
  return {
    kind: 'collections',
    library,
    ...(parentRef !== undefined ? { parentRef } : {}),
    offset: pageOffsetOf(offset),
    limit: LIBRARY_PAGE_SIZE,
  }
}

/** One browse listing request for the saved searches of a library. */
export function savedSearchesRequestOf(
  library: SupportedLocalLibrary,
  offset = 0,
): ZoteroLibraryBrowseRequestView {
  return {
    kind: 'savedSearches',
    library,
    offset: pageOffsetOf(offset),
    limit: LIBRARY_PAGE_SIZE,
  }
}

/** One browse listing request for the library selector. */
/** One library-listing page request; the selector walks every page. */
export function librariesRequestOf(offset = 0): ZoteroLibraryBrowseRequestView {
  return { kind: 'libraries', offset, limit: LIBRARY_PAGE_SIZE }
}

/** The library rows of a `libraries` listing; the personal library keeps first place. */
export function libraryOptionsOf(
  rows: readonly ZoteroLibraryBrowseItemView[],
): { library: SupportedLocalLibrary; name: string }[] {
  const options = rows
    .filter(
      (row): row is Extract<ZoteroLibraryBrowseItemView, { kind: 'library' }> =>
        row.kind === 'library',
    )
    .map((row) => ({ library: row.library, name: row.name }))
  return options.sort((a, b) =>
    a.library.type === b.library.type
      ? a.library.id - b.library.id
      : a.library.type === 'user'
        ? -1
        : 1,
  )
}

/** The collection rows a `collections` listing serves, in listing order. */
export type CollectionRowView = Extract<ZoteroLibraryBrowseItemView, { kind: 'collection' }>

/** The saved-search rows a `savedSearches` listing serves. */
export type SavedSearchRowView = Extract<ZoteroLibraryBrowseItemView, { kind: 'savedSearch' }>

/** The collection rows of a `collections` listing. */
export function collectionRowsOf(
  rows: readonly ZoteroLibraryBrowseItemView[],
): CollectionRowView[] {
  return rows.filter((row): row is CollectionRowView => row.kind === 'collection')
}

/** The saved-search rows of a `savedSearches` listing. */
export function savedSearchRowsOf(
  rows: readonly ZoteroLibraryBrowseItemView[],
): SavedSearchRowView[] {
  return rows.filter((row): row is SavedSearchRowView => row.kind === 'savedSearch')
}

/** One visible tree row: the collection plus its render depth and ARIA set facts. */
export interface FlatCollectionRow {
  readonly row: CollectionRowView
  readonly depth: number
  /** The parent lane's total (`aria-setsize`); undefined while the lane is unknown. */
  readonly setSize: number | undefined
  /** The row's 1-based position in its parent lane (`aria-posinset`). */
  readonly posInSet: number | undefined
}

/**
 * Flatten the lazy tree for rendering: roots in listing order, then each
 * expanded node's children (recursively). The children cache is read through
 * a callback so the projection stays a pure function of (roots, cache, open).
 * Each row's `setSize`/`posInSet` are budgeted here, once per lane lookup,
 * instead of per render cell.
 */
export function flattenTree(
  roots: readonly CollectionRowView[],
  laneOf: (ref: string) =>
    | {
        readonly rows: readonly CollectionRowView[]
        readonly offset: number
        readonly total: number
      }
    | undefined,
  expanded: ReadonlySet<string>,
  rootLane?: { readonly offset: number; readonly total: number },
): FlatCollectionRow[] {
  const flat: FlatCollectionRow[] = []
  const seen = new Set<string>()
  const walk = (
    rows: readonly CollectionRowView[],
    depth: number,
    lane: { readonly offset: number; readonly total: number } | undefined,
  ): void => {
    rows.forEach((row, index) => {
      if (seen.has(row.ref)) return
      seen.add(row.ref)
      const childLane = expanded.has(row.ref) ? laneOf(row.ref) : undefined
      flat.push({
        row,
        depth,
        setSize: lane?.total,
        posInSet: lane === undefined ? undefined : lane.offset + index + 1,
      })
      if (childLane !== undefined) walk(childLane.rows, depth + 1, childLane)
    })
  }
  walk(roots, 0, rootLane)
  return flat
}

/** The library selector's render state over the `libraries` listing. */
export type LibrarySelectorState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; options: readonly { library: SupportedLocalLibrary; name: string }[] }

/** The item list's render state over the latest wire answer. */
export type LibraryListState =
  | { phase: 'loading' }
  | {
      phase: 'ready'
      items: readonly ZoteroSearchItemView[]
      total: number
      offset: number
      /** The page size the host served; the pager steps back by it. */
      limit: number
      nextOffset: number | undefined
    }
  | { phase: 'error'; message: string }

/** Project one search answer into the list state; the loading arm is the hook's. */
export function listStateOf(result: RemoteResult<ZoteroSearchResultView>): LibraryListState {
  if (!result.ok) return { phase: 'error', message: result.error.message }
  return {
    phase: 'ready',
    items: result.value.items,
    total: result.value.total,
    offset: result.value.offset,
    limit: result.value.limit,
    nextOffset: result.value.nextOffset,
  }
}

/** The inspector's render state over the latest detail answer. */
export type LibraryItemState =
  | { phase: 'loading' }
  | { phase: 'ready'; detail: ZoteroItemDetailView }
  | { phase: 'error'; message: string }

/** Project one detail answer into the inspector state. */
export function itemStateOf(result: RemoteResult<ZoteroItemDetailView>): LibraryItemState {
  if (!result.ok) return { phase: 'error', message: result.error.message }
  return { phase: 'ready', detail: result.value }
}

/** One navigation-lane render state, shared by tree levels and saved searches. */
export type LibraryLaneState<T> =
  | { phase: 'loading'; previous?: LibraryLanePage<T> }
  | {
      phase: 'ready'
      rows: readonly T[]
      total: number
      offset: number
      /** The page size the host served; the pager steps back by it. */
      limit: number
      nextOffset: number | undefined
    }
  | { phase: 'error'; message: string; previous?: LibraryLanePage<T> }

export type LibraryLanePage<T> = Extract<LibraryLaneState<T>, { phase: 'ready' }>

/** Keep an already visible page mounted while its replacement is pending. */
export function lanePageOf<T>(
  lane: LibraryLaneState<T> | undefined,
): LibraryLanePage<T> | undefined {
  return lane?.phase === 'ready' ? lane : lane?.previous
}

/**
 * The visible range of one page: `first–last / total`, undefined for an empty
 * page. Shared by the item list and every navigation lane.
 */
export function pageRangeOf(
  page: { offset: number; total: number },
  count: number,
): { start: number; end: number; total: number } | undefined {
  if (count === 0) return undefined
  return { start: page.offset + 1, end: page.offset + count, total: page.total }
}
