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
 * instance, never as a service replacement and never with a new
 * `ConnectivityRecovery` (that gate is service-lifetime state; swapping it on
 * rebuild would stack duplicate connectivity cards). A violating commit is vetoed in
 * `internal/config` before it lands, so the live read only ever observes
 * values `resolveConfig` accepts.
 * @module dsh-zotero/service
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import { ConnectivityRecovery } from './ask.js';
import { type Config, type Options, type ResolvedConfig } from './config.js';
import type { ZoteroAttachmentLocation, ZoteroBrowseRequest, ZoteroBrowseResult, ZoteroChangesRequest, ZoteroChangesResult, ZoteroChildrenRequest, ZoteroChildrenResult, ZoteroCreateCollectionCommittedOutcome, ZoteroCreateCollectionRequest, ZoteroCreateItemCommittedOutcome, ZoteroCreateItemRequest, ZoteroCreateNoteRequest, ZoteroCreateNoteCommittedOutcome, ZoteroDeleteCollectionRequest, ZoteroDeleteCollectionResult, ZoteroDeleteLibraryTagsRequest, ZoteroDeleteLibraryTagsResult, ZoteroGetRequest, ZoteroItemDetail, ZoteroObjectRef, ZoteroExportRequest, ZoteroExportResult, ZoteroProgressEvent, ZoteroProvider, ZoteroRetrieveRequest, ZoteroRetrieveResult, ZoteroSearchRequest, ZoteroSearchResult, ZoteroStatus, ZoteroUpdateItemCollectionsRequest, ZoteroUpdateItemCollectionsResult, ZoteroUpdateItemRequest, ZoteroUpdateItemResult, ZoteroUpdateItemTagsRequest, ZoteroUpdateItemTagsResult, ZoteroWriteCall, ZoteroWriteDeclined } from './types.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        zotero: ZoteroService;
    }
}
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
    }>>, "plain">;
    private readonly providers;
    /**
     * Connectivity recovery gate for this service instance.
     *
     * Concurrent tool calls that hit the same ask-worthy failure (Zotero down,
     * local API disabled, no shared API version, timeout) share one question
     * instead of stacking a card per call. The gate's Map holds only in-flight
     * asks; each entry is deleted when that question settles, so a later
     * failure asks again.
     *
     * Owned by the `ZoteroService` instance for the fiber lifetime, **not** by
     * a config generation. A volatile commit calls `buildTransport`, which
     * replaces HTTP clients and the `local` provider on this same instance; it
     * must not replace this gate. Swapping recovery on rebuild would fork the
     * conversation (in-flight waiters on the old gate, new failures on a new
     * one) and stack duplicate cards, the opposite of this class's purpose.
     * Retry paths re-enter `service.*` at call time and therefore see the
     * rebuilt provider without touching the gate.
     */
    readonly recovery: ConnectivityRecovery;
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
    /** Disposers of the conditionally registered heavy tools (export, changes), tracked for the background flip. */
    private heavyToolDisposes;
    private heavyToolsBackgroundState;
    /** The resolved config the transport stack was last built from. */
    private lastBuilt;
    /** Cached resolved config; invalidated on any loader/volatile-update. */
    private cachedConfig?;
    constructor(ctx: Context, config?: Config | Options);
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
     * Register or re-register the heavy tools (export, changes) dynamically as
     * `enableRunInBackground` or `ctx.jobs` flips. Exposes the `run_in_background`
     * parameter to the model only when background execution is actually usable.
     */
    private reconcileHeavyTools;
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
    /**
     * Update one item's collection membership (add/remove in one write).
     * @param request - the item ref and the collections to add/remove.
     * @param call - the asking write call: its plan and its tool run.
     * @returns the resulting collections, the actual additions/removals, and versions,
     *   or `declined` when the user did not approve the plan.
     */
    updateItemCollections(request: ZoteroUpdateItemCollectionsRequest, call: ZoteroWriteCall): Promise<ZoteroUpdateItemCollectionsResult | ZoteroWriteDeclined>;
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
export declare const HEAVY_TOOL_CONFIG_KEYS: ReadonlySet<keyof ResolvedConfig>;
/**
 * Whether a `loader/volatile-update` path list touches the heavy tools' background capability.
 * A root path (`[]`) means the whole config moved as one reference.
 * @param paths - the changed field paths the loader reported.
 * @returns true when heavy tools may need re-registration.
 */
export declare function touchesHeavyTools(paths: readonly (readonly string[])[]): boolean;
export default ZoteroService;
//# sourceMappingURL=service.d.ts.map