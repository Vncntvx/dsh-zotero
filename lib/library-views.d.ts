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
import type { ZoteroBrowseRequest, ZoteroBrowseResult, ZoteroChildPage, ZoteroChildPageRequest, ZoteroExportRequest, ZoteroExportTextResult, ZoteroGetRequest, ZoteroItemDetail, ZoteroSearchOptions, ZoteroSearchRequest, ZoteroSearchResult } from './types.js';
import type { ZoteroChildPageView, ZoteroItemDetailView, ZoteroLibraryBrowseRequestView, ZoteroLibraryBrowseResultView, ZoteroLibraryChildPageRequestView, ZoteroLibraryExportRequestView, ZoteroLibraryExportResultView, ZoteroLibraryItemRequestView, ZoteroLibrarySearchRequestView, ZoteroSearchResultView } from './contract.js';
/** Wire browse request → domain request; the panel's three kinds map one-to-one. */
export declare function browseRequestOf(view: ZoteroLibraryBrowseRequestView): ZoteroBrowseRequest;
/**
 * Domain browse result → wire view, tagging each row with its wire `kind`.
 * `limit` is the page size the service actually served after clamping the
 * request to `maxBrowseResults`; the client pages by it.
 */
export declare function browseViewOf(result: ZoteroBrowseResult, limit: number): ZoteroLibraryBrowseResultView;
/** Wire search request → domain request; an absent mode becomes the metadata mode. */
export declare function searchRequestOf(view: ZoteroLibrarySearchRequestView): ZoteroSearchRequest;
/**
 * The panel's search policy: the wire view drops the note supplement (see
 * `searchViewOf`), so panel requests skip the note-body scan, and the panel's
 * data generation keys the host's filtered-search index.
 */
export declare function searchOptionsOf(view: ZoteroLibrarySearchRequestView): ZoteroSearchOptions;
/**
 * Domain search result → wire view; the note supplement is dropped here.
 * `limit` is the page size the service actually served after clamping the
 * request to `maxSearchResults`; the client pages by it.
 */
export declare function searchViewOf(result: ZoteroSearchResult, limit: number): ZoteroSearchResultView;
/** Wire item request → domain get request; the ref grammar does the parsing. */
export declare function itemRequestOf(view: ZoteroLibraryItemRequestView): ZoteroGetRequest;
/** Wire child-page request → domain request; the ref grammar does the parsing. */
export declare function childPageRequestOf(view: ZoteroLibraryChildPageRequestView): ZoteroChildPageRequest;
/**
 * Wire export request → domain request. Refs go through the same parser the
 * tool uses, so a malformed ref (or a non-item/unsupported one) fails with
 * `ZOTERO_INVALID_REF` before any provider call. The format union is the
 * domain union spelled again, so it crosses unchanged. Omitted style/locale
 * stay absent here on purpose: the export domain applies the configured
 * defaults, which keeps the panel's answer identical to the tool's.
 */
export declare function exportRequestOf(view: ZoteroLibraryExportRequestView): ZoteroExportRequest;
/**
 * Domain child page → wire view. `pageMetaOf` guarantees every served page
 * carries its window, so the wire view requires `limit`.
 */
export declare function childPageViewOf(page: ZoteroChildPage): ZoteroChildPageView;
/**
 * Domain text export result → wire view, mapped arm by arm so the wire shape
 * cannot inherit a host-only field by spread. The panel renders rendered text
 * only, so the translator arm carries no per-document itemization. The CSL
 * style/locale are carried only when the domain result actually answered with
 * them (the codec is strict).
 */
export declare function exportViewOf(result: ZoteroExportTextResult): ZoteroLibraryExportResultView;
/** Domain item detail → wire view; relations/version/serverId/extraFields stay host-side. */
export declare function itemViewOf(detail: ZoteroItemDetail): ZoteroItemDetailView;
//# sourceMappingURL=library-views.d.ts.map