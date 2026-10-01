/**
 * The `local` provider facade: the Zotero Local API seam implementing
 * {@link ZoteroProvider}. Capabilities are declared only for what this
 * provider implements, so a capability gate can never route work into a
 * method that does not exist. Every domain pipeline lives beside it in
 * `local/*-domain.ts`; this class owns the wiring — the HTTP client, the
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
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { WriteAuthorizer } from '../write-auth.js';
import type { ZoteroWriteHttpClient } from '../write-http.js';
import type { ZoteroAttachmentLocation, ZoteroBrowseRequest, ZoteroBrowseResult, ZoteroCapability, ZoteroChangesRequest, ZoteroChangesResult, ZoteroChildrenRequest, ZoteroChildrenResult, ZoteroCreateCollectionCommittedOutcome, ZoteroCreateCollectionRequest, ZoteroCreateItemCommittedOutcome, ZoteroCreateItemRequest, ZoteroCreateNoteRequest, ZoteroCreateNoteCommittedOutcome, ZoteroDeleteCollectionRequest, ZoteroDeleteCollectionResult, ZoteroDeleteLibraryTagsRequest, ZoteroDeleteLibraryTagsResult, ZoteroExportRequest, ZoteroExportResult, ZoteroGetRequest, ZoteroItemDetail, ZoteroObjectRef, ZoteroProgressEvent, ZoteroProvider, ZoteroRetrieveRequest, ZoteroRetrieveResult, ZoteroSearchRequest, ZoteroSearchResult, ZoteroStatus, ZoteroUpdateItemCollectionsRequest, ZoteroUpdateItemCollectionsResult, ZoteroUpdateItemRequest, ZoteroUpdateItemResult, ZoteroUpdateItemTagsRequest, ZoteroUpdateItemTagsResult } from '../types.js';
export declare class LocalApiProvider implements ZoteroProvider {
    private readonly client;
    private readonly writer?;
    private readonly authorizer?;
    readonly id = "local";
    readonly capabilities: ReadonlySet<ZoteroCapability>;
    private readonly directory;
    private readonly getLimits;
    constructor(client: ZoteroHttpClient, limits: LocalApiLimits | (() => LocalApiLimits), writer?: ZoteroWriteHttpClient | undefined, authorizer?: WriteAuthorizer | undefined);
    /** One deps bundle per call keeps every domain signature explicit. */
    private deps;
    /**
     * The write collaborators, asserted: the service only reaches the write
     * methods through the `write` capability gate, which this provider declares
     * exactly when both collaborators exist — so this assertion guards direct
     * provider callers, not the service path. Collection writes invalidate the
     * scope directory through the injected callback, so a renamed cache never
     * outlives the write that stale-dated it.
     */
    private writeDeps;
    /**
     * Resolve a mixed batch of collection refs and exact names, preserving
     * input order — the partition/ref-listing/name-resolution orchestration
     * lives once in `scope-directory.resolveCollectionsMixed`.
     */
    private resolveCollections;
    /** Memoized field sets per (serving instance, item type), keyed for identity changes. */
    private readonly itemTypeFieldsMemo;
    /** In-flight field-set fetches, shared so parallel updates fetch each set once. */
    private readonly itemTypeFieldsInFlight;
    /**
     * The field names one item type accepts. The set is static for a running
     * Zotero build, so each (instance, item type) pair is fetched once and
     * memoized — a failed or aborted fetch is not cached, and a second update
     * of the same item type costs no request.
     */
    private itemTypeFields;
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
    search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>;
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
    /**
     * Explore one item's or attachment's child-object graph. The domain logic
     * lives in `local/detail`; this is the provider seam.
     */
    children(request: ZoteroChildrenRequest, signal?: AbortSignal): Promise<ZoteroChildrenResult>;
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
     * Discover libraries, collections, saved searches, tags, item types, and
     * metadata fields. The domain logic lives in `local/browse-domain`; this
     * is the seam.
     */
    browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult>;
    /**
     * Create a research note (standalone, or a child note under a parent item)
     * with tags, collections, and source relations. The domain logic lives in
     * `local/write-domain`; this is the seam, and it is only reachable through
     * the `write` capability gate.
     */
    createNote(request: ZoteroCreateNoteRequest, signal?: AbortSignal): Promise<ZoteroCreateNoteCommittedOutcome>;
    /**
     * Update one item's tags (add/remove in one write). The domain logic lives
     * in `local/write-domain`; this is the seam.
     */
    updateItemTags(request: ZoteroUpdateItemTagsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemTagsResult>;
    /**
     * Update one item's collection membership (add/remove in one write). The
     * domain logic lives in `local/write-domain`; this is the seam.
     */
    updateItemCollections(request: ZoteroUpdateItemCollectionsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemCollectionsResult>;
    /**
     * Create a collection, optionally under a parent. The domain logic lives in
     * `local/write-domain`; this is the seam.
     */
    createCollection(request: ZoteroCreateCollectionRequest, signal?: AbortSignal): Promise<ZoteroCreateCollectionCommittedOutcome>;
    /**
     * Delete a collection by ref or name. The domain logic lives in
     * `local/write-domain`; this is the seam.
     */
    deleteCollection(request: ZoteroDeleteCollectionRequest, signal?: AbortSignal): Promise<ZoteroDeleteCollectionResult>;
    /**
     * Create a bibliographic item from the closed field set. The domain logic
     * lives in `local/write-domain`; this is the seam.
     */
    createItem(request: ZoteroCreateItemRequest, signal?: AbortSignal): Promise<ZoteroCreateItemCommittedOutcome>;
    /**
     * Update one item's scalar metadata fields. The domain logic lives in
     * `local/write-domain`; this is the seam.
     */
    updateItem(request: ZoteroUpdateItemRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemResult>;
    /**
     * Delete tags library-wide. The domain logic lives in
     * `local/write-domain`; this is the seam.
     */
    deleteLibraryTags(request: ZoteroDeleteLibraryTagsRequest, signal?: AbortSignal): Promise<ZoteroDeleteLibraryTagsResult>;
}
//# sourceMappingURL=provider.d.ts.map