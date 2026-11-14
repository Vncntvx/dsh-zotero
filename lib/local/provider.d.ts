/**
 * The `local` provider facade: the Zotero Local API seam implementing
 * {@link ZoteroProvider}. Capabilities are declared only for what this
 * provider implements, so a capability gate can never route work into a
 * method that does not exist. Every domain pipeline lives beside it in
 * `local/*-domain.ts`; this class owns the wiring: the HTTP client, the
 * projected limits, and the scope directory whose caches rebuild with the
 * provider on every settings commit.
 *
 * Request-driven by design: loading never touches Zotero, and the only
 * health check is `status()`. Search semantics follow the Local API's
 * documented behavior (server-side paging over `/items/top`, client-side
 * scope-name resolution, literal tag escaping); first-page note-body
 * matches ride in `supplemental`, never inside the paged totals. The
 * provider keeps its limit projection live, so a limit-only settings edit
 * does not rebuild its transport or discard its scope caches.
 * @module dsh-zotero/local/provider
 */
import type { ZoteroCollectionPathRequestView, ZoteroCollectionPathResultView } from '../contract.js';
import type { DiagnosticSink } from '../diagnostics.js';
import type { FulltextEnhancer } from './fulltext-enhancer.js';
import { type EvidenceRanker } from './evidence-ranker.js';
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { WriteAuthorizer } from '../write-auth.js';
import type { ZoteroWriteHttpClient } from '../write-http.js';
import type { ZoteroAttachmentLocation, ZoteroBrowseRequest, ZoteroBrowseResult, ZoteroCapability, ZoteroChangesRequest, ZoteroChangesResult, ZoteroChildPage, ZoteroChildPageRequest, ZoteroCreateCollectionCommittedOutcome, ZoteroCreateCollectionRequest, ZoteroCreateItemCommittedOutcome, ZoteroCreateItemRequest, ZoteroCreateNoteRequest, ZoteroCreateNoteCommittedOutcome, ZoteroDeleteCollectionRequest, ZoteroDeleteCollectionOutcome, ZoteroDeleteLibraryTagsRequest, ZoteroDeleteLibraryTagsOutcome, ZoteroBatchItemsRequest, ZoteroBatchItemsResult, ZoteroExportRequest, ZoteroExportResult, ZoteroExportTextResult, ZoteroGetRequest, ZoteroGetBatchRequest, ZoteroGetBatchResult, ZoteroMatchReferencesRequest, ZoteroMatchReferencesResult, ZoteroItemDetail, ZoteroObjectRef, ZoteroProgressEvent, ZoteroProvider, ZoteroRetrieveRequest, ZoteroRetrieveResult, ZoteroSearchOptions, ZoteroSearchRequest, ZoteroSearchResult, ZoteroStatus, ZoteroUpdateItemCollectionsRequest, ZoteroUpdateItemCollectionsOutcome, ZoteroUpdateItemRequest, ZoteroUpdateItemOutcome, ZoteroUpdateItemTagsRequest, ZoteroUpdateItemTagsOutcome, ZoteroUpdateNoteRequest, ZoteroUpdateNoteOutcome, ZoteroUpdateCollectionRequest, ZoteroUpdateCollectionOutcome, ZoteroRestoreItemsRequest, ZoteroRestoreItemsResult, ZoteroCreateSavedSearchRequest, ZoteroUpdateSavedSearchOutcome, ZoteroSavedSearchResult, ZoteroWriteCommittedUnverified, ZoteroUpdateSavedSearchRequest, ZoteroDeleteSavedSearchRequest, ZoteroDeleteSavedSearchOutcome } from '../types.js';
/** Everything one provider instance needs, named so a swap cannot mis-wire two facts. */
export interface LocalApiProviderOptions {
    readonly client: ZoteroHttpClient;
    readonly limits: () => LocalApiLimits;
    readonly writer?: ZoteroWriteHttpClient;
    readonly authorizer?: WriteAuthorizer;
    readonly sink?: DiagnosticSink;
    readonly fulltextEnhancer?: () => FulltextEnhancer | undefined;
    readonly evidenceRanker?: () => EvidenceRanker;
    /**
     * The stored-grant fact when no authorizer exists (writes disabled). The
     * authorizer wins while it exists: it also knows this process's in-memory
     * key, which a credential read cannot see.
     */
    readonly readGrant?: (serverId: string) => Promise<boolean>;
}
export declare class LocalApiProvider implements ZoteroProvider {
    readonly id = "local";
    readonly capabilities: ReadonlySet<ZoteroCapability>;
    private readonly client;
    private readonly writer?;
    private readonly authorizer?;
    private readonly readGrant?;
    private readonly directory;
    private readonly itemSchema;
    private readonly getLimits;
    private readonly searchCaches;
    private readonly sink;
    private readonly getFulltextEnhancer;
    private readonly getEvidenceRanker;
    constructor(options: LocalApiProviderOptions);
    /** One deps bundle per call keeps every domain signature explicit. */
    private deps;
    /**
     * The write collaborators, asserted: the service only reaches the write
     * methods through the `write` capability gate, which this provider declares
     * exactly when both collaborators exist, so this assertion guards direct
     * provider callers, not the service path. Collection writes invalidate the
     * scope directory through the injected callback, so a renamed cache never
     * outlives the write that stale-dated it.
     */
    private writeDeps;
    /**
     * Resolve a mixed batch of collection refs and exact names, preserving
     * input order. The partition/ref-listing/name-resolution orchestration
     * lives once in `scope-directory.resolveCollectionsMixed`.
     */
    private resolveCollections;
    /**
     * Probe `GET /api/` and report connectivity plus the instance identity
     * headers. Health checks live here, not on every tool call. An explicit
     * caller abort propagates instead of folding into `connected: false`, so a
     * cancel is never mistaken for a connectivity problem.
     */
    status(signal?: AbortSignal): Promise<ZoteroStatus>;
    /**
     * Discover candidates; the provider resolves scopes and serves the compact
     * records. The domain logic lives in `local/search-domain`; this method is
     * the provider seam that carries the client/limits/directory wiring.
     */
    search(request: ZoteroSearchRequest, signal: AbortSignal | undefined, options: ZoteroSearchOptions): Promise<ZoteroSearchResult>;
    /**
     * Diff the library against a local transaction version. The domain logic
     * lives in `local/changes-domain`; this is the seam.
     */
    changes(request: ZoteroChangesRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroChangesResult>;
    /**
     * Read one item's metadata plus optionally requested child content. The
     * domain logic lives in `local/detail`; this is the provider seam.
     */
    getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>;
    getBatch(request: ZoteroGetBatchRequest, signal?: AbortSignal): Promise<ZoteroGetBatchResult>;
    matchReferences(request: ZoteroMatchReferencesRequest, signal?: AbortSignal): Promise<ZoteroMatchReferencesResult>;
    /** One paged child listing; the domain owns the ref/window/cap rules. */
    getChildPage(request: ZoteroChildPageRequest, signal?: AbortSignal): Promise<ZoteroChildPage>;
    /**
     * Resolve an item or attachment ref to a usable location. The domain
     * logic lives in `local/attachment-location`; this is the seam.
     */
    getAttachmentLocation(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<ZoteroAttachmentLocation>;
    /**
     * Gather ranked evidence passages for one item across the requested
     * sources. The domain logic lives in `local/retrieve`; this is the seam.
     */
    retrieve(request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>;
    /**
     * Export citations or formatted output for the requested items. The
     * domain logic lives in `local/export-domain`; this is the seam.
     */
    export(request: ZoteroExportRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroExportResult>;
    /**
     * Export rendered text/citations for the requested items, without the
     * tool-side per-document itemization. The domain logic lives in
     * `local/export-domain`; this is the seam the library panel's endpoint uses.
     */
    exportText(request: ZoteroExportRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroExportTextResult>;
    /**
     * Read one collection's exact parent chain, fresh, under the caller's
     * library version. The path domain lives in `local/collection-path`; this
     * is the seam, and it rides the `browse` capability.
     */
    collectionPath(request: ZoteroCollectionPathRequestView, signal?: AbortSignal): Promise<ZoteroCollectionPathResultView>;
    /**
     * Discover libraries, collections, saved searches, tags, item types, and
     * metadata fields. The domain logic lives in `local/browse-domain`; this
     * is the seam.
     */
    browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult>;
    /**
     * Create a research note (standalone, or a child note under a parent item)
     * with tags, collections, and source relations. The domain logic lives in
     * `local/write-notes`; this is the seam, and it is only reachable through
     * the `write` capability gate.
     */
    createNote(request: ZoteroCreateNoteRequest, signal?: AbortSignal): Promise<ZoteroCreateNoteCommittedOutcome>;
    /**
     * Update one item's tags (add/remove in one write). The domain logic lives
     * in `local/write-item-lists`; this is the seam.
     */
    updateItemTags(request: ZoteroUpdateItemTagsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemTagsOutcome>;
    updateNote(request: ZoteroUpdateNoteRequest, signal?: AbortSignal): Promise<ZoteroUpdateNoteOutcome>;
    /**
     * Update one item's collection membership (add/remove in one write). The
     * domain logic lives in `local/write-item-lists`; this is the seam.
     */
    updateItemCollections(request: ZoteroUpdateItemCollectionsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemCollectionsOutcome>;
    updateCollection(request: ZoteroUpdateCollectionRequest, signal?: AbortSignal): Promise<ZoteroUpdateCollectionOutcome>;
    /**
     * Create a collection, optionally under a parent. The domain logic lives in
     * `local/write-collections`; this is the seam.
     */
    createCollection(request: ZoteroCreateCollectionRequest, signal?: AbortSignal): Promise<ZoteroCreateCollectionCommittedOutcome>;
    /**
     * Delete a collection by ref or name. The domain logic lives in
     * `local/write-collections`; this is the seam.
     */
    deleteCollection(request: ZoteroDeleteCollectionRequest, signal?: AbortSignal): Promise<ZoteroDeleteCollectionOutcome>;
    /**
     * Create a bibliographic item from the closed field set. The domain logic
     * lives in `local/write-domain`; this is the seam.
     */
    createItem(request: ZoteroCreateItemRequest, signal?: AbortSignal): Promise<ZoteroCreateItemCommittedOutcome>;
    /**
     * Update one item's scalar metadata fields. The domain logic lives in
     * `local/write-domain`; this is the seam.
     */
    updateItem(request: ZoteroUpdateItemRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemOutcome>;
    /**
     * Delete tags library-wide. The domain logic lives in
     * `local/write-library-maintenance`; this is the seam.
     */
    deleteLibraryTags(request: ZoteroDeleteLibraryTagsRequest, signal?: AbortSignal): Promise<ZoteroDeleteLibraryTagsOutcome>;
    /**
     * Batch items operation: create/import, update tags/collections, delete.
     */
    batchItems(request: ZoteroBatchItemsRequest, signal?: AbortSignal): Promise<ZoteroBatchItemsResult>;
    restoreItems(request: ZoteroRestoreItemsRequest, signal?: AbortSignal): Promise<ZoteroRestoreItemsResult>;
    createSavedSearch(request: ZoteroCreateSavedSearchRequest, signal?: AbortSignal): Promise<ZoteroSavedSearchResult | ZoteroWriteCommittedUnverified>;
    updateSavedSearch(request: ZoteroUpdateSavedSearchRequest, signal?: AbortSignal): Promise<ZoteroUpdateSavedSearchOutcome>;
    deleteSavedSearch(request: ZoteroDeleteSavedSearchRequest, signal?: AbortSignal): Promise<ZoteroDeleteSavedSearchOutcome>;
}
//# sourceMappingURL=provider.d.ts.map