/**
 * `ctx.zotero`: the stable research-domain boundary of the plugin.
 *
 * The service owns provider selection (a configured id must be registered,
 * with no cross-provider fallback and no request replay), capability gating,
 * and the domain methods the model-facing tools consume. The HTTP
 * transport and the Zotero object model stay below this boundary.
 *
 * The plugin is request-driven by design: loading it never touches Zotero
 * (no probes, no timers, no background work). The only request sources are
 * the tools, invoked because the user asked about their library, and
 * the `/zotero status` command the user invokes explicitly.
 *
 * The effective config is live: every schema field is `volatile`, so a
 * settings commit lands in the running fiber's references without remounting
 * and tools read it per request. Structural flips (transport fields, the
 * write capability) rebuild on `loader/volatile-update` on this same
 * instance, never as a service replacement. A violating commit is vetoed in
 * `internal/config` before it lands, so the live read only ever observes
 * values `resolveConfig` accepts.
 * @module dsh-zotero/service
 */
import { Service, type Context, type Fiber } from '@deepseek-ai/cordis';
import { DiagnosticsRecorder } from './diagnostics.js';
import type { ZoteroAttachmentLocationView } from './contract.js';
import { type Config, type Options, type ResolvedConfig } from './config.js';
import type { ZoteroAttachmentLocation, ZoteroBrowseRequest, ZoteroBrowseResult, ZoteroChangesRequest, ZoteroChangesResult, ZoteroChildrenRequest, ZoteroChildrenResult, ZoteroCreateCollectionCommittedOutcome, ZoteroCreateCollectionRequest, ZoteroCreateItemCommittedOutcome, ZoteroCreateItemRequest, ZoteroCreateNoteRequest, ZoteroCreateNoteCommittedOutcome, ZoteroDeleteCollectionRequest, ZoteroDeleteCollectionResult, ZoteroDeleteLibraryTagsRequest, ZoteroDeleteLibraryTagsResult, ZoteroGetRequest, ZoteroItemDetail, ZoteroObjectRef, ZoteroExportRequest, ZoteroExportResult, ZoteroProgressEvent, ZoteroProvider, ZoteroRetrieveRequest, ZoteroRetrieveResult, ZoteroSearchRequest, ZoteroSearchResult, ZoteroStatus, ZoteroUpdateItemCollectionsRequest, ZoteroUpdateItemCollectionsResult, ZoteroUpdateItemRequest, ZoteroUpdateItemResult, ZoteroUpdateItemTagsRequest, ZoteroUpdateItemTagsResult, ZoteroUpdateNoteRequest, ZoteroUpdateNoteOutcome, ZoteroUpdateCollectionRequest, ZoteroUpdateCollectionOutcome, ZoteroRestoreItemsRequest, ZoteroRestoreItemsOutcome, ZoteroCreateSavedSearchRequest, ZoteroCreateSavedSearchOutcome, ZoteroUpdateSavedSearchRequest, ZoteroUpdateSavedSearchOutcome, ZoteroDeleteSavedSearchRequest, ZoteroDeleteSavedSearchOutcome, ZoteroBatchItemsOutcome, ZoteroBatchItemsRequest, ZoteroWriteCall, ZoteroWriteDeclined } from './types.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        zotero: ZoteroService;
    }
}
/**
 * Whether an `internal/config` waterfall `this` is this plugin's fiber.
 * The Loader passes the fiber itself; `ctx.plugin()` returns
 * `Object.create(fiber)`, so the prototype-linked face counts as the same
 * fiber. Anything else is another plugin's config resolution. Exported for
 * the unit lane: the false arms need a foreign `this` no in-lane waterfall
 * can carry.
 * @param thisArg - the waterfall's bound `this`.
 * @param own - the fiber that owns this service.
 * @returns true when the candidate config belongs to this plugin.
 */
export declare function isOwnConfigFiber(thisArg: unknown, own: Fiber): boolean;
export declare class ZoteroService extends Service {
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        baseUrl: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        provider: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxInFlightRequests: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxSearchResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteScanRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        searchConcurrency: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxEvidenceChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxEvidencePassages: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxDetailChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteBodyChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxAnnotationRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxAttachmentRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        fulltextChunkWords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxFulltextChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        retrieveAttachmentCap: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        graphConcurrency: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxResponseBytes: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxExportChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxExportRefs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxBrowseResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxChangesResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        scopeListingTtlMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        defaultStyle: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        defaultLocale: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        writeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        writePersistKey: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        writeNoteMaxChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        writeListMaxItems: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        writeAuthorizeDeadlineMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        webEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        enableRunInBackground: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        promoteOnTimeout: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        foregroundWaitMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        debug: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        baseUrl: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        provider: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxInFlightRequests: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxSearchResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteScanRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        searchConcurrency: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxEvidenceChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxEvidencePassages: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxDetailChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteBodyChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxNoteRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxAnnotationRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxAttachmentRecords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        fulltextChunkWords: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxFulltextChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        retrieveAttachmentCap: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        graphConcurrency: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxResponseBytes: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxExportChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxExportRefs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxBrowseResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxChangesResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        scopeListingTtlMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        defaultStyle: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        defaultLocale: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        writeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        writePersistKey: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        writeNoteMaxChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        writeListMaxItems: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        writeAuthorizeDeadlineMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        webEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        enableRunInBackground: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        promoteOnTimeout: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        foregroundWaitMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        debug: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    }>>, "plain">;
    private readonly providers;
    /**
     * The live entry config: Loader-delivered volatile references (commits
     * write those same refs) or a complete plain snapshot. Tools read through
     * {@link config} per request so settings edits apply without a restart.
     */
    private readonly entry;
    /** Disposer of the currently registered `local` provider, released before a rebuild re-registers it. */
    private providerDispose;
    /** Disposers of the conditionally registered write tools, tracked for the writeEnabled flip. */
    private writeToolDisposes;
    /** The resolved config the transport stack was last built from. */
    private lastBuilt;
    /** Cached resolved config; invalidated on any loader/volatile-update. */
    private cachedConfig?;
    /**
     * The plugin's own diagnostics record: ring, threshold, and the sink every
     * instrumented seam holds. Public so the remote endpoints (and the tools,
     * for degradation facts) can read it without a second service.
     */
    readonly diagnostics: DiagnosticsRecorder;
    /** Last observed probe connectivity; `undefined` until the first probe, so the initial state always records. */
    private lastProbeConnected;
    constructor(ctx: Context, config?: Config | Options);
    /**
     * The durable half of `/zotero`: the command handler appends a
     * `zotero/status` event and the card reads it back through this projection
     * instead of re-parsing the text it was handed. Registration resolves
     * asynchronously; the plugin publishes nothing downstream of it, so there
     * is no handle to retain — the registration itself is an effect on this
     * fiber, and disposal releases it. Optional seam: a composition without the
     * registry keeps the live probe as the only source, and the card says
     * nothing it cannot prove. When the seam is absent the inject fiber stays
     * pending (and `await binding` is skipped), so the plugin loads without the
     * projection.
     */
    protected [Service.init](): Promise<void>;
    /**
     * The currently effective configuration, read live from the entry's
     * volatile references on every access, so tools that call this per request
     * see settings edits without a restart. Commits only land after passing
     * {@link resolveConfig} (load gate + `internal/config` veto), so the read
     * observes accepted values. Schemastery is not re-applied here; see
     * {@link readResolvedConfig}.
     * @returns the live resolved config.
     */
    get config(): ResolvedConfig;
    /**
     * Build the transport stack from the given config: HTTP client, write
     * client, write authorizer, and the `local` provider registration (the
     * previous registration is disposed first so the duplicate-id guard never
     * fires). A request already in flight finishes on the client it started
     * with; later calls resolve the fresh provider.
     *
     * The write transport and authorizer exist only while `writeEnabled` is
     * set: without them the provider declares no `write` capability, so the
     * gate answers before any network happens.
     */
    private buildTransport;
    /**
     * Register or retire the write tools as `writeEnabled` flips. When the
     * flag is off the tools are absent from the model's surface entirely. A
     * tool that can only ever answer "write capability is disabled" would
     * invite the model to retry it. Runs once at construction and again on
     * every structural volatile-update.
     */
    private reconcileWriteTools;
    /**
     * The host credentials seam, resolved lazily: a composition without a
     * credentials service keeps write grants in memory only, and the plugin
     * never hard-depends on the seam being mounted.
     */
    private credentials;
    /**
     * Register a provider into the seam. Effect-scoped: unloading the
     * registering fiber removes the provider.
     * @throws {ZoteroError} `ZOTERO_PROVIDER_UNAVAILABLE` on a duplicate id.
     * @returns the registration disposer.
     */
    registerProvider(provider: ZoteroProvider): () => void;
    /**
     * Connectivity probe: the only health check. Ordinary calls fail with typed errors instead.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns live connectivity facts for the configured provider.
     */
    status(signal?: AbortSignal): Promise<ZoteroStatus>;
    /**
     * Discover candidates; the provider resolves scopes and serves the compact records.
     * @param request - the search request with scope, mode, filters, and pagination.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the resolved scope plus the compact hit records and pagination facts.
     */
    search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>;
    /**
     * Read one item's metadata plus optionally requested child content.
     * @param request - the item ref and the child kinds to include.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the normalized item detail.
     */
    get(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>;
    /**
     * Explore one item's or attachment's child-object graph.
     * @param request - the item/attachment ref and the child kinds to return.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the bounded child collections with their totals.
     */
    children(request: ZoteroChildrenRequest, signal?: AbortSignal): Promise<ZoteroChildrenResult>;
    /**
     * Resolve an attachment ref to its on-disk file or linked URL.
     * @param ref - the item or attachment ref to resolve.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the verified file path or linked URL.
     */
    attachment(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<ZoteroAttachmentLocation>;
    /**
     * Resolve an attachment ref string for the Typert Remote caller.
     * @param ref - the item or attachment ref string to resolve.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the resolved location view with local file path or web URL.
     */
    resolveAttachment(ref: string, signal?: AbortSignal): Promise<ZoteroAttachmentLocationView>;
    /**
     * Gather ranked evidence passages for one item across the requested sources.
     * @param request - the item ref, ranking query, sources, and passage cap.
     * @param signal - caller cancellation; forwarded to the provider.
     * @returns the bounded ranked evidence with a truncation flag.
     */
    retrieve(request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>;
    /**
     * Export citations, a bibliography, or translator formats for the requested items.
     * @param request - the item refs and the export format plus optional style/locale.
     * @param signal - caller cancellation; forwarded to the provider.
     * @param onProgress - optional progress reporter.
     * @returns per-ref citations or the joined export text.
     */
    export(request: ZoteroExportRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroExportResult>;
    browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult>;
    /**
     * Diff the library against a local transaction version.
     * @param request - the baseline version and the resource kinds to diff.
     * @param signal - caller cancellation; forwarded to the provider.
     * @param onProgress - optional progress reporter.
     * @returns changed/deleted keys plus the library's current version.
     */
    changes(request: ZoteroChangesRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroChangesResult>;
    /**
     * Shared dispatch for personal library write operations: capability check,
     * provider method presence assertion, user approval gate, and execution.
     */
    private dispatchWrite;
    /**
     * Create a note item, either standalone or attached to an existing item.
     *
     * Write boundary: personal library only (`zotero://user/0/...`); capability
     * answers before any network; the plan-review the user approves happens
     * here, at the seam, so no caller can skip it.
     * @param request - the markdown body, optional parent, collections, tags, and sources.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the created note's ref, version, and the saved collections/tags/relations,
     *   or `declined` when the user did not approve the plan.
     */
    createNote(request: ZoteroCreateNoteRequest, call: ZoteroWriteCall): Promise<ZoteroCreateNoteCommittedOutcome | ZoteroWriteDeclined>;
    /**
     * Update one item's tags (add/remove in one write).
     * @param request - the item ref and the tags to add/remove.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the merged tag list, the actual additions/removals, and versions,
     *   or `declined` when the user did not approve the plan.
     */
    updateItemTags(request: ZoteroUpdateItemTagsRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateItemTagsResult | ZoteroWriteDeclined>;
    updateNote(request: ZoteroUpdateNoteRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateNoteOutcome>;
    /**
     * Update one item's collection membership (add/remove in one write).
     * @param request - the item ref and the collections to add/remove.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the resulting collections, the actual additions/removals, and versions,
     *   or `declined` when the user did not approve the plan.
     */
    updateItemCollections(request: ZoteroUpdateItemCollectionsRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateItemCollectionsResult | ZoteroWriteDeclined>;
    updateCollection(request: ZoteroUpdateCollectionRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateCollectionOutcome>;
    /**
     * Create a collection, optionally under a parent.
     * @param request - the name and the optional parent ref or name.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the created collection, or `declined` when not approved.
     */
    createCollection(request: ZoteroCreateCollectionRequest, call: ZoteroWriteCall): Promise<ZoteroCreateCollectionCommittedOutcome | ZoteroWriteDeclined>;
    /**
     * Delete a collection by ref or name.
     * @param request - the collection ref or name.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the deletion receipt, or `declined` when not approved.
     */
    deleteCollection(request: ZoteroDeleteCollectionRequest, call: ZoteroWriteCall): Promise<ZoteroDeleteCollectionResult | ZoteroWriteDeclined>;
    /**
     * Create a bibliographic item from the closed field set.
     * @param request - the itemType plus title/url/date/doi/abstract/publicationTitle/creators.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the created item, or `declined` when not approved.
     */
    createItem(request: ZoteroCreateItemRequest, call: ZoteroWriteCall): Promise<ZoteroCreateItemCommittedOutcome | ZoteroWriteDeclined>;
    /**
     * Update one item's scalar metadata fields.
     * @param request - the item ref and the closed-set field updates.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the changed fields and versions, or `declined` when not approved.
     */
    updateItem(request: ZoteroUpdateItemRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateItemResult | ZoteroWriteDeclined>;
    /**
     * Delete tags library-wide. Irreversible.
     * @param request - the tag names to delete.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the deletion receipt, or `declined` when not approved.
     */
    deleteLibraryTags(request: ZoteroDeleteLibraryTagsRequest, call: ZoteroWriteCall): Promise<ZoteroDeleteLibraryTagsResult | ZoteroWriteDeclined>;
    /**
     * Batch items operation: create/import, update tags/collections, delete.
     * @param request - the batch operations.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the outcome describing created, updated, and deleted items, or declined.
     */
    batchItems(request: ZoteroBatchItemsRequest, call: ZoteroWriteCall): Promise<ZoteroBatchItemsOutcome>;
    restoreItems(request: ZoteroRestoreItemsRequest, call: ZoteroWriteCall): Promise<ZoteroRestoreItemsOutcome>;
    createSavedSearch(request: ZoteroCreateSavedSearchRequest, call: ZoteroWriteCall): Promise<ZoteroCreateSavedSearchOutcome>;
    updateSavedSearch(request: ZoteroUpdateSavedSearchRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateSavedSearchOutcome>;
    deleteSavedSearch(request: ZoteroDeleteSavedSearchRequest, call: ZoteroWriteCall): Promise<ZoteroDeleteSavedSearchOutcome>;
    /**
     * The confirmation gates every write passes through, in order: the session
     * approval policy (`ctx.approval`, where `never` auto-rejects and the
     * request is audited), then the plan-review card. There is no opt-out and no
     * config field behind either: a write that cannot clear the policy or show
     * the user its plan does not happen. Both asks fail closed, and a missing
     * channel refuses the write rather than letting it through unapproved.
     * @param call - the asking write call.
     * @returns true when the write may proceed.
     */
    private approveWrite;
    private resolveProvider;
    private requireCapability;
    /**
     * Second gate behind `requireCapability`: the method itself must exist.
     * A provider that declares a capability but leaves the method undefined is
     * miswired, so this fails with `ZOTERO_PROVIDER_UNAVAILABLE` (provider bug)
     * rather than the capability code (unsupported domain). The returned
     * function is bound to the provider so class-method `this` survives the
     * detachment.
     */
    private requireMethod;
}
/**
 * Top-level config keys whose change rebuilds the transport stack: the HTTP
 * client identity and bounds (`baseUrl`, `timeoutMs`, `maxResponseBytes`,
 * `maxInFlightRequests`, the last of which sizes the client-wide concurrency
 * gate), the write client's human-scale dialog budget
 * (`writeAuthorizeDeadlineMs`), and the write-capability flip (writer,
 * authorizer, and tool set). `provider` and `writePersistKey` are live reads
 * (`resolveProvider()` and the authorizer's `persistKey` callback) and never
 * rebuild; every remaining bound, the scope-listing TTL included, is read
 * through the provider's live limits getter on the next call.
 */
export declare const TRANSPORT_CONFIG_KEYS: ReadonlySet<keyof ResolvedConfig>;
/**
 * Whether a `loader/volatile-update` path list touches a transport key.
 * A root path (`[]`) means the whole config moved as one reference.
 * @param paths - the changed field paths the loader reported.
 * @returns true when the transport stack may need a rebuild.
 */
export declare function touchesTransport(paths: readonly (readonly string[])[]): boolean;
export default ZoteroService;
//# sourceMappingURL=service.d.ts.map