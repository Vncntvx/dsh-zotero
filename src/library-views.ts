/**
 * Domain↔wire mappings for the library panel's five Remote endpoints
 * (browse, search, item detail, child page, export). The
 * browser panel speaks the contract views (`src/contract.ts`); the service
 * speaks the domain records (`src/types.ts`). These pure functions are where
 * the two shapes meet on the host half, and fields the panel does not render
 * are dropped here: the search result's note supplement and the detail's
 * relations/version/serverId/extraFields stay
 * host-side.
 * @module dsh-zotero/library-views
 */

import { parseRef, parseSupportedRef } from './refs.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import type {
  ZoteroAnnotationRecord,
  ZoteroAttachmentRecord,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroChildCollection,
  ZoteroChildPage,
  ZoteroChildPageRequest,
  ZoteroCollectionInfo,
  ZoteroExportRequest,
  ZoteroExportTextResult,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroLibraryInfo,
  ZoteroNoteRecord,
  ZoteroSavedSearchInfo,
  ZoteroTagInfo,
  ZoteroItemTypeInfo,
  ZoteroSearchOptions,
  ZoteroSearchRequest,
  ZoteroSearchResult,
} from './types.js'
import type {
  ZoteroAnnotationRowView,
  ZoteroAttachmentRowView,
  ZoteroChildPageView,
  ZoteroChildRowsView,
  ZoteroCollectionRowView,
  ZoteroItemDetailView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryBrowseResultView,
  ZoteroLibraryChildPageRequestView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
  ZoteroLibraryItemRequestView,
  ZoteroLibraryRowView,
  ZoteroLibrarySearchRequestView,
  ZoteroNoteRowView,
  ZoteroSavedSearchRowView,
  ZoteroSearchItemView,
  ZoteroSearchResultView,
} from './contract.js'

/** Wire browse request → domain request; the panel's three kinds map one-to-one. */
export function browseRequestOf(view: ZoteroLibraryBrowseRequestView): ZoteroBrowseRequest {
  return {
    kind: view.kind,
    ...(view.library !== undefined ? { library: view.library } : {}),
    ...(view.parentRef !== undefined ? { parentRef: view.parentRef } : {}),
    ...(view.q !== undefined && view.q !== '' ? { q: view.q } : {}),
    ...(view.match !== undefined ? { match: view.match } : {}),
    offset: view.offset,
    limit: view.limit,
  }
}

/**
 * Domain browse result → wire view, tagging each row with its wire `kind`.
 * `limit` is the page size the service actually served after clamping the
 * request to `maxBrowseResults`; the client pages by it.
 */
export function browseViewOf(
  result: ZoteroBrowseResult,
  limit: number,
): ZoteroLibraryBrowseResultView {
  return {
    ...itemsViewOf(result),
    total: result.total,
    offset: result.offset,
    returned: result.returned,
    limit,
    ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}),
  }
}

/**
 * The domain rows are one union, and the result's `kind` contractually selects
 * the row shape, so each arm narrows by cast. Every kind outside the panel's
 * five means a tool listing was routed through the panel endpoint.
 */
function itemsViewOf(
  result: ZoteroBrowseResult,
): Pick<ZoteroLibraryBrowseResultView, 'kind' | 'items'> {
  switch (result.kind) {
    case 'libraries':
      return {
        kind: 'libraries',
        items: result.items.map((row): ZoteroLibraryRowView => {
          const library = row as ZoteroLibraryInfo
          return { kind: 'library', library: library.library, name: library.name }
        }),
      }
    case 'collections':
      return {
        kind: 'collections',
        items: result.items.map((row): ZoteroCollectionRowView => {
          const collection = row as ZoteroCollectionInfo
          return {
            kind: 'collection',
            ref: collection.ref,
            name: collection.name,
            ...(collection.parentRef !== undefined ? { parentRef: collection.parentRef } : {}),
            path: collection.path,
            depth: collection.depth,
          }
        }),
      }
    case 'savedSearches':
      return {
        kind: 'savedSearches',
        items: result.items.map((row): ZoteroSavedSearchRowView => {
          const search = row as ZoteroSavedSearchInfo
          // The browse listing already normalized (and refused malformed)
          // condition rows, so the closed records cross as they are.
          return {
            kind: 'savedSearch',
            ref: search.ref,
            name: search.name,
            conditions: search.conditions ?? [],
          }
        }),
      }
    case 'tags':
      return {
        kind: 'tags',
        items: result.items.map((row) => ({ kind: 'tag', tag: (row as ZoteroTagInfo).tag })),
      }
    case 'itemTypes':
      return {
        kind: 'itemTypes',
        items: result.items.map((row) => {
          const item = row as ZoteroItemTypeInfo
          return {
            kind: 'itemType',
            itemType: item.itemType,
            ...(item.localized === undefined ? {} : { localized: item.localized }),
          }
        }),
      }
    case 'itemFields':
      // `itemFields` belongs to the tool browse; the panel wire schema does not
      // carry it, so this arm is an unreachable guard.
      throw new ZoteroError(
        `The library browse view cannot serve kind '${result.kind}'.`,
        ZOTERO_UNEXPECTED,
      )
  }
}

/** Wire search request → domain request; an absent mode becomes the metadata mode. */
export function searchRequestOf(view: ZoteroLibrarySearchRequestView): ZoteroSearchRequest {
  return {
    scope: view.scope,
    ...(view.library !== undefined ? { library: view.library } : {}),
    ...(view.q !== undefined && view.q !== '' ? { query: view.q } : {}),
    mode: view.mode ?? 'metadata',
    sort: view.sort,
    direction: view.direction,
    offset: view.offset,
    limit: view.limit,
    ...(view.itemLevel !== undefined ? { itemLevel: view.itemLevel } : {}),
    ...(view.itemTypes !== undefined ? { itemTypes: [...view.itemTypes] } : {}),
    ...(view.tags !== undefined ? { tags: [...view.tags] } : {}),
    ...(view.tagMatch !== undefined ? { tagMatch: view.tagMatch } : {}),
    ...(view.yearFrom !== undefined ? { yearFrom: view.yearFrom } : {}),
    ...(view.yearTo !== undefined ? { yearTo: view.yearTo } : {}),
    ...(view.hasAttachment !== undefined ? { hasAttachment: view.hasAttachment } : {}),
  }
}

/**
 * The panel's search policy: the wire view drops the note supplement (see
 * `searchViewOf`), so panel requests skip the note-body scan, and the panel's
 * data generation keys the host's filtered-search index.
 */
export function searchOptionsOf(view: ZoteroLibrarySearchRequestView): ZoteroSearchOptions {
  return {
    includeSupplemental: false,
    ...(view.cacheGeneration !== undefined ? { cacheGeneration: view.cacheGeneration } : {}),
  }
}

/** One domain hit → wire row; absent optionals stay absent (the codec is strict). */
function searchItemViewOf(row: ZoteroSearchResult['items'][number]): ZoteroSearchItemView {
  return {
    ref: row.ref,
    title: row.title,
    creatorSummary: row.creatorSummary,
    ...(row.year !== undefined ? { year: row.year } : {}),
    itemType: row.itemType,
    ...(row.parentRef !== undefined ? { parentRef: row.parentRef } : {}),
    ...(row.bestAttachmentRef !== undefined ? { bestAttachmentRef: row.bestAttachmentRef } : {}),
    ...(row.bestAttachmentType !== undefined ? { bestAttachmentType: row.bestAttachmentType } : {}),
    ...(row.attachmentSize !== undefined ? { attachmentSize: row.attachmentSize } : {}),
    ...(row.extra !== undefined ? { extra: row.extra } : {}),
    ...(row.doi !== undefined ? { doi: row.doi } : {}),
  }
}

/**
 * Domain search result → wire view; the note supplement is dropped here.
 * `limit` is the page size the service actually served after clamping the
 * request to `maxSearchResults`; the client pages by it.
 */
export function searchViewOf(result: ZoteroSearchResult, limit: number): ZoteroSearchResultView {
  return {
    scope: result.scope,
    items: result.items.map(searchItemViewOf),
    total: result.total,
    offset: result.offset,
    returned: result.returned,
    limit,
    ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}),
  }
}

/** Wire item request → domain get request; the ref grammar does the parsing. */
export function itemRequestOf(view: ZoteroLibraryItemRequestView): ZoteroGetRequest {
  return {
    ref: parseRef(view.ref),
    include: new Set<ZoteroInclude>(view.include),
    childPages: { ...view.childPages },
  }
}

/** Wire child-page request → domain request; the ref grammar does the parsing. */
export function childPageRequestOf(
  view: ZoteroLibraryChildPageRequestView,
): ZoteroChildPageRequest {
  return {
    ref: parseRef(view.ref),
    kind: view.kind,
    offset: view.offset,
    limit: view.limit,
  }
}

/**
 * Wire export request → domain request. Refs go through the same parser the
 * tool uses, so a malformed ref (or a non-item/unsupported one) fails with
 * `ZOTERO_INVALID_REF` before any provider call. The format union is the
 * domain union spelled again, so it crosses unchanged. Omitted style/locale
 * stay absent here on purpose: the export domain applies the configured
 * defaults, which keeps the panel's answer identical to the tool's.
 */
export function exportRequestOf(view: ZoteroLibraryExportRequestView): ZoteroExportRequest {
  return {
    refs: view.refs.map((value) => parseSupportedRef(value, ['item'])),
    format: view.format,
    ...(view.style !== undefined ? { style: view.style } : {}),
    ...(view.locale !== undefined ? { locale: view.locale } : {}),
  }
}

/**
 * Domain child page → wire view. `pageMetaOf` guarantees every served page
 * carries its window, so the wire view requires `limit`.
 */
export function childPageViewOf(page: ZoteroChildPage): ZoteroChildPageView {
  switch (page.kind) {
    case 'notes':
      return { kind: 'notes', page: rowsPageOf(page.page, noteRowOf) }
    case 'attachments':
      return { kind: 'attachments', page: rowsPageOf(page.page, attachmentRowOf) }
    case 'annotations':
      return { kind: 'annotations', page: rowsPageOf(page.page, annotationRowOf) }
  }
}

/**
 * Domain text export result → wire view, mapped arm by arm so the wire shape
 * cannot inherit a host-only field by spread. The panel renders rendered text
 * only, so the translator arm carries no per-document itemization. The CSL
 * style/locale are carried only when the domain result actually answered with
 * them (the codec is strict).
 */
export function exportViewOf(result: ZoteroExportTextResult): ZoteroLibraryExportResultView {
  switch (result.format) {
    case 'citation':
      return {
        format: 'citation',
        ...styleLocaleViewOf(result),
        citations: result.citations.map((entry) => ({ ref: entry.ref, text: entry.text })),
      }
    case 'bibliography':
      return {
        format: 'bibliography',
        ...styleLocaleViewOf(result),
        text: result.text,
      }
    default:
      return {
        format: result.format,
        ...styleLocaleViewOf(result),
        text: result.text,
      }
  }
}

/** The optional CSL facts an export result may carry; absent stays absent. */
function styleLocaleViewOf(result: { readonly style?: string; readonly locale?: string }): {
  style?: string
  locale?: string
} {
  return {
    ...(result.style !== undefined ? { style: result.style } : {}),
    ...(result.locale !== undefined ? { locale: result.locale } : {}),
  }
}

/** One domain note row → wire row. */
function noteRowOf(row: ZoteroNoteRecord): ZoteroNoteRowView {
  return {
    ref: row.ref,
    text: row.text,
    truncated: row.truncated,
    ...(row.parentRef !== undefined ? { parentRef: row.parentRef } : {}),
  }
}

/** One domain annotation row → wire row. */
function annotationRowOf(row: ZoteroAnnotationRecord): ZoteroAnnotationRowView {
  return {
    ref: row.ref,
    type: row.type,
    text: row.text,
    ...(row.comment !== undefined ? { comment: row.comment } : {}),
    ...(row.color !== undefined ? { color: row.color } : {}),
    ...(row.pageLabel !== undefined ? { pageLabel: row.pageLabel } : {}),
    ...(row.parentRef !== undefined ? { parentRef: row.parentRef } : {}),
  }
}

/** One domain attachment row → wire row. */
function attachmentRowOf(row: ZoteroAttachmentRecord): ZoteroAttachmentRowView {
  return { ref: row.ref, title: row.title, contentType: row.contentType }
}

/**
 * One bounded child listing the detail view serves. The panel's `item`
 * endpoint always pages, so every child collection it normalizes carries page
 * metadata; a missing `limit` here is a host bug (an unpaged collection
 * reached the wire view) and fails loud.
 */
function rowsPageOf<T, V>(
  collection: ZoteroChildCollection<T>,
  rowOf: (row: T) => V,
): ZoteroChildRowsView<V> {
  if (collection.limit === undefined) {
    throw new ZoteroError(
      'The paged detail view served a child listing without page metadata.',
      ZOTERO_UNEXPECTED,
    )
  }
  return {
    total: collection.total,
    returned: collection.returned,
    offset: collection.offset ?? 0,
    limit: collection.limit,
    ...(collection.nextOffset === undefined ? {} : { nextOffset: collection.nextOffset }),
    items: collection.items.map(rowOf),
  }
}

function rowsViewOf<T, V>(
  collection: ZoteroChildCollection<T> | undefined,
  rowOf: (row: T) => V,
): ZoteroChildRowsView<V> | undefined {
  if (collection === undefined) return undefined
  return rowsPageOf(collection, rowOf)
}

/** Domain item detail → wire view; relations/version/serverId/extraFields stay host-side. */
export function itemViewOf(detail: ZoteroItemDetail): ZoteroItemDetailView {
  const notes = rowsViewOf(detail.notes, (row): ZoteroNoteRowView => ({
    ref: row.ref,
    text: row.text,
    truncated: row.truncated,
    ...(row.parentRef !== undefined ? { parentRef: row.parentRef } : {}),
  }))
  const annotations = rowsViewOf(detail.annotations, (row): ZoteroAnnotationRowView => ({
    ref: row.ref,
    type: row.type,
    text: row.text,
    ...(row.comment !== undefined ? { comment: row.comment } : {}),
    ...(row.color !== undefined ? { color: row.color } : {}),
    ...(row.pageLabel !== undefined ? { pageLabel: row.pageLabel } : {}),
    ...(row.parentRef !== undefined ? { parentRef: row.parentRef } : {}),
  }))
  const attachments = rowsViewOf(detail.attachments, (row): ZoteroAttachmentRowView => ({
    ref: row.ref,
    title: row.title,
    contentType: row.contentType,
  }))
  const bestAttachment: ZoteroAttachmentRowView | undefined =
    detail.bestAttachment === undefined
      ? undefined
      : {
          ref: detail.bestAttachment.ref,
          title: detail.bestAttachment.title,
          contentType: detail.bestAttachment.contentType,
        }
  return {
    ref: detail.ref,
    itemType: detail.itemType,
    title: detail.title,
    creators: detail.creators.map((creator) => ({
      creatorType: creator.creatorType,
      ...(creator.name !== undefined ? { name: creator.name } : {}),
      ...(creator.firstName !== undefined ? { firstName: creator.firstName } : {}),
      ...(creator.lastName !== undefined ? { lastName: creator.lastName } : {}),
    })),
    ...(detail.extra !== undefined ? { extra: detail.extra } : {}),
    ...(detail.date !== undefined ? { date: detail.date } : {}),
    ...(detail.year !== undefined ? { year: detail.year } : {}),
    ...(detail.venue !== undefined ? { venue: detail.venue } : {}),
    ...(detail.doi !== undefined ? { doi: detail.doi } : {}),
    ...(detail.url !== undefined ? { url: detail.url } : {}),
    ...(detail.abstract !== undefined ? { abstract: detail.abstract } : {}),
    abstractTruncated: detail.abstractTruncated,
    ...(detail.noteBody !== undefined
      ? { noteBody: { text: detail.noteBody.text, truncated: detail.noteBody.truncated } }
      : {}),
    tags: detail.tags,
    collections: detail.collections.map((collection) => ({
      ref: collection.ref,
      ...(collection.name !== undefined ? { name: collection.name } : {}),
    })),
    children: { total: detail.children.total },
    ...(bestAttachment !== undefined ? { bestAttachment } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(annotations !== undefined ? { annotations } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
  }
}
