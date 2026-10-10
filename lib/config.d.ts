/**
 * Plugin configuration. Every deployment-varying choice is a validated
 * `Config` field; the schema fills defaults and `resolveConfig` enforces the
 * constraints Schemastery cannot express (loopback-only `baseUrl`, positive
 * finite limits) at load time, failing loud on misconfiguration.
 *
 * Fields are `volatile`: the settings page edits the live entry without
 * remounting. `Config` is what the loader hands the constructor (references);
 * `Options` is what humans write (plain values); `resolveConfig` accepts
 * either, unwraps, and validates.
 * @module dsh-zotero/config
 */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export interface Config {
    /** Zotero Local API base URL. Must be plain loopback HTTP. */
    baseUrl?: Volatile<string>;
    /** Provider id to select; the built-in local provider registers as `local`. */
    provider?: Volatile<string>;
    /** Per-request provider deadline in milliseconds. */
    timeoutMs?: Volatile<number>;
    /**
     * Upper bound for concurrent in-flight requests to the Local API. Each
     * domain pool bounds one call's fan-out; this is the process-wide slot
     * count, the real bound on what Zotero is asked to serve at once. Two calls
     * run at full width, and a burst queues instead of stacking.
     */
    maxInFlightRequests?: Volatile<number>;
    /** Upper bound for `zotero_search` `limit`. */
    maxSearchResults?: Volatile<number>;
    /** Upper bound for note records `zotero_search` scans for body matches. */
    maxNoteScanRecords?: Volatile<number>;
    /**
     * Parallel parent-attribution queries `zotero_search` may keep in flight
     * (`ZOTERO_ITEMKEY_BATCH` itemKeys each).
     */
    searchConcurrency?: Volatile<number>;
    /** Total character budget for retrieved evidence passages. */
    maxEvidenceChars?: Volatile<number>;
    /** Upper bound for the number of evidence passages. */
    maxEvidencePassages?: Volatile<number>;
    /** Character budget for the `zotero_get` abstract preview. */
    maxDetailChars?: Volatile<number>;
    /** Character budget for a note item's own body returned by `zotero_get`. */
    maxNoteBodyChars?: Volatile<number>;
    /** Per-note character budget for `zotero_get` note previews. */
    maxNoteChars?: Volatile<number>;
    /** Upper bound for note records returned by `zotero_get`. */
    maxNoteRecords?: Volatile<number>;
    /** Upper bound for annotation records returned by `zotero_get`. */
    maxAnnotationRecords?: Volatile<number>;
    /** Word count of each full-text passage entering evidence ranking. */
    fulltextChunkWords?: Volatile<number>;
    /** Character bound for full text accepted into `zotero_retrieve` ranking. */
    maxFulltextChars?: Volatile<number>;
    /**
     * Upper bound for attachments one `zotero_retrieve` call ranks full text
     * from: each member costs a metadata read and a full-text read and all of
     * their text enters one ranking. `specified` rejects a longer list;
     * `allIndexed` reads the first entries in selection order and reports the
     * rest as unread.
     */
    retrieveAttachmentCap?: Volatile<number>;
    /** Parallel attachment reads `zotero_retrieve` may keep in flight; annotation children ride the single `?itemType=annotation` listing instead. */
    graphConcurrency?: Volatile<number>;
    /** Streaming byte bound for every API response body. */
    maxResponseBytes?: Volatile<number>;
    /** Provider hard limit for export output; the model-facing inline budget is deployment spill policy. */
    maxExportChars?: Volatile<number>;
    /** Upper bound for refs in one `zotero_export` call; citation batches up to this value, the other formats refuse to exceed the API's 50-key request cap. */
    maxExportRefs?: Volatile<number>;
    /** Upper bound for items a browse call may return */
    maxBrowseResults?: Volatile<number>;
    /** Display cap for `zotero_changes` listings; the diff itself always reads the whole range. */
    maxChangesResults?: Volatile<number>;
    /** How long a collections/searches scope listing is trusted before a re-read (ms); the provider reads it live, so an edit applies to the next lookup without rebuilding the transport. */
    scopeListingTtlMs?: Volatile<number>;
    /** CSL style for citation/bibliography formats; must be bundled with Zotero (e.g. `apa`). */
    defaultStyle?: Volatile<string>;
    /** CSL locale for citation/bibliography formats. */
    defaultLocale?: Volatile<string>;
    /**
     * Whether the write tools register and the `local` provider serves writes
     * (research notes, tags, collection membership). Off by default: writing
     * is an explicit opt-in, and the capability stays absent until it is.
     */
    writeEnabled?: Volatile<boolean>;
    /**
     * Whether an Always-Allow grant from Zotero's authorization dialog is
     * persisted into the host credentials store (bound to the Zotero instance
     * that issued it). One-time keys are never persisted regardless.
     */
    writePersistKey?: Volatile<boolean>;
    /** Character budget for one research note body write; the converted HTML rides the batch's successful bucket (bounded by `maxResponseBytes`), and this bound keeps one pathological note from dominating a batch. */
    writeNoteMaxChars?: Volatile<number>;
    /** Upper bound for items in one tags/collection-membership write's list arguments, the same scale as the write batch cap, so one call cannot fan out into many protocol batches. */
    writeListMaxItems?: Volatile<number>;
    /** Deadline for the Zotero authorization dialog during a write (ms). That request waits for a person to read the dialog, so it is independent of `timeoutMs` and deliberately far above it. */
    writeAuthorizeDeadlineMs?: Volatile<number>;
    /**
     * Whether the dedicated Zotero web view (tool cards in a conversation tab) is enabled.
     * Client-only: the host half never reads this (it shares the `zotero`
     * settings namespace so the card and the tab stay on one document); only
     * `src/client/` gates on it. Do not branch host behavior on it.
     */
    webEnabled?: Volatile<boolean>;
    /**
     * Allow the explicit `run_in_background` parameter on heavy tools. Timeout
     * promotion is controlled separately by `promoteOnTimeout`.
     */
    enableRunInBackground?: Volatile<boolean>;
    /** Keep a tool call running as a background job when foreground wait times out. */
    promoteOnTimeout?: Volatile<boolean>;
    /** How long a tool call waits in the foreground before promoting to a background job (ms). */
    foregroundWaitMs?: Volatile<number>;
}
/**
 * Every field is `volatile`: the settings page edits the live entry, and the
 * loader commits volatile edits into the running fiber without remounting
 * (non-volatile edits would remount instead, and the settings write path
 * refuses them). The service re-reads the references per request and reacts
 * to `loader/volatile-update` for structural flips (transport, write tools).
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    baseUrl: Schema<string, string, "volatile-defined">;
    provider: Schema<string, string, "volatile-defined">;
    timeoutMs: Schema<number, number, "volatile-defined">;
    maxInFlightRequests: Schema<number, number, "volatile-defined">;
    maxSearchResults: Schema<number, number, "volatile-defined">;
    maxNoteScanRecords: Schema<number, number, "volatile-defined">;
    searchConcurrency: Schema<number, number, "volatile-defined">;
    maxEvidenceChars: Schema<number, number, "volatile-defined">;
    maxEvidencePassages: Schema<number, number, "volatile-defined">;
    maxDetailChars: Schema<number, number, "volatile-defined">;
    maxNoteBodyChars: Schema<number, number, "volatile-defined">;
    maxNoteChars: Schema<number, number, "volatile-defined">;
    maxNoteRecords: Schema<number, number, "volatile-defined">;
    maxAnnotationRecords: Schema<number, number, "volatile-defined">;
    fulltextChunkWords: Schema<number, number, "volatile-defined">;
    maxFulltextChars: Schema<number, number, "volatile-defined">;
    retrieveAttachmentCap: Schema<number, number, "volatile-defined">;
    graphConcurrency: Schema<number, number, "volatile-defined">;
    maxResponseBytes: Schema<number, number, "volatile-defined">;
    maxExportChars: Schema<number, number, "volatile-defined">;
    maxExportRefs: Schema<number, number, "volatile-defined">;
    maxBrowseResults: Schema<number, number, "volatile-defined">;
    maxChangesResults: Schema<number, number, "volatile-defined">;
    scopeListingTtlMs: Schema<number, number, "volatile-defined">;
    defaultStyle: Schema<string, string, "volatile-defined">;
    defaultLocale: Schema<string, string, "volatile-defined">;
    writeEnabled: Schema<boolean, boolean, "volatile-defined">;
    writePersistKey: Schema<boolean, boolean, "volatile-defined">;
    writeNoteMaxChars: Schema<number, number, "volatile-defined">;
    writeListMaxItems: Schema<number, number, "volatile-defined">;
    writeAuthorizeDeadlineMs: Schema<number, number, "volatile-defined">;
    webEnabled: Schema<boolean, boolean, "volatile-defined">;
    enableRunInBackground: Schema<boolean, boolean, "volatile-defined">;
    promoteOnTimeout: Schema<boolean, boolean, "volatile-defined">;
    foregroundWaitMs: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    baseUrl: Schema<string, string, "volatile-defined">;
    provider: Schema<string, string, "volatile-defined">;
    timeoutMs: Schema<number, number, "volatile-defined">;
    maxInFlightRequests: Schema<number, number, "volatile-defined">;
    maxSearchResults: Schema<number, number, "volatile-defined">;
    maxNoteScanRecords: Schema<number, number, "volatile-defined">;
    searchConcurrency: Schema<number, number, "volatile-defined">;
    maxEvidenceChars: Schema<number, number, "volatile-defined">;
    maxEvidencePassages: Schema<number, number, "volatile-defined">;
    maxDetailChars: Schema<number, number, "volatile-defined">;
    maxNoteBodyChars: Schema<number, number, "volatile-defined">;
    maxNoteChars: Schema<number, number, "volatile-defined">;
    maxNoteRecords: Schema<number, number, "volatile-defined">;
    maxAnnotationRecords: Schema<number, number, "volatile-defined">;
    fulltextChunkWords: Schema<number, number, "volatile-defined">;
    maxFulltextChars: Schema<number, number, "volatile-defined">;
    retrieveAttachmentCap: Schema<number, number, "volatile-defined">;
    graphConcurrency: Schema<number, number, "volatile-defined">;
    maxResponseBytes: Schema<number, number, "volatile-defined">;
    maxExportChars: Schema<number, number, "volatile-defined">;
    maxExportRefs: Schema<number, number, "volatile-defined">;
    maxBrowseResults: Schema<number, number, "volatile-defined">;
    maxChangesResults: Schema<number, number, "volatile-defined">;
    scopeListingTtlMs: Schema<number, number, "volatile-defined">;
    defaultStyle: Schema<string, string, "volatile-defined">;
    defaultLocale: Schema<string, string, "volatile-defined">;
    writeEnabled: Schema<boolean, boolean, "volatile-defined">;
    writePersistKey: Schema<boolean, boolean, "volatile-defined">;
    writeNoteMaxChars: Schema<number, number, "volatile-defined">;
    writeListMaxItems: Schema<number, number, "volatile-defined">;
    writeAuthorizeDeadlineMs: Schema<number, number, "volatile-defined">;
    webEnabled: Schema<boolean, boolean, "volatile-defined">;
    enableRunInBackground: Schema<boolean, boolean, "volatile-defined">;
    promoteOnTimeout: Schema<boolean, boolean, "volatile-defined">;
    foregroundWaitMs: Schema<number, number, "volatile-defined">;
}>>, "plain">;
export interface ResolvedConfig {
    readonly baseUrl: string;
    readonly provider: string;
    readonly timeoutMs: number;
    readonly maxInFlightRequests: number;
    readonly maxSearchResults: number;
    readonly maxNoteScanRecords: number;
    readonly searchConcurrency: number;
    readonly maxEvidenceChars: number;
    readonly maxEvidencePassages: number;
    readonly maxDetailChars: number;
    readonly maxNoteBodyChars: number;
    readonly maxNoteChars: number;
    readonly maxNoteRecords: number;
    readonly maxAnnotationRecords: number;
    readonly fulltextChunkWords: number;
    readonly maxFulltextChars: number;
    readonly retrieveAttachmentCap: number;
    readonly graphConcurrency: number;
    readonly maxResponseBytes: number;
    readonly maxExportChars: number;
    readonly maxExportRefs: number;
    readonly maxBrowseResults: number;
    readonly maxChangesResults: number;
    readonly scopeListingTtlMs: number;
    readonly defaultStyle: string;
    readonly defaultLocale: string;
    readonly writeEnabled: boolean;
    readonly writePersistKey: boolean;
    readonly writeNoteMaxChars: number;
    readonly writeListMaxItems: number;
    readonly writeAuthorizeDeadlineMs: number;
    readonly webEnabled: boolean;
    readonly enableRunInBackground: boolean;
    readonly promoteOnTimeout: boolean;
    readonly foregroundWaitMs: number;
}
/**
 * Hostnames that are loopback by definition. `localhost` is pinned to the
 * IPv4 literal before any request leaves the plugin; the set is the single
 * spelling authority for validation and for the shell-write detector's
 * host anchors, so the two can never drift.
 */
export declare const LOOPBACK_HOSTNAMES: ReadonlySet<string>;
/** Plain options as humans write them: every `Config` reference unwrapped. */
export type Options = {
    [K in keyof Config]?: NonNullable<Config[K]> extends Volatile<infer T> ? T : never;
};
/**
 * Normalize an entry for the service's live read. Schema-complete input is
 * kept as-is (Loader hands stable volatile references; live commits write
 * those same refs). Partial `Options` cannot observe volatile commits, so the
 * resolved snapshot is stored instead of re-applying Schemastery per request.
 * @param config - the constructor's entry, already accepted by {@link resolveConfig}.
 * @returns the entry the live getter reads.
 */
export declare function toLiveEntry(config: Config | Options): Config | Options;
/**
 * Live read of a schema-complete entry (the Loader/fiber contract: every
 * field is present as a stable volatile reference or a plain value that
 * already passed {@link resolveConfig}). Unwrap and constraint checks only:
 * Schemastery is not re-applied on this path.
 * @throws {Error} on loopback/URL/limit violations, or when a field is missing.
 */
export declare function readResolvedConfig(entry: Config | Options): ResolvedConfig;
/**
 * Validate a raw config and fill schema defaults.
 *
 * The single schema+constraint authority: runs at load (a violating entry
 * fails loud) and as the `internal/config` veto (a violating settings commit
 * is refused before it lands). The service's per-request live read goes
 * through {@link readResolvedConfig} on an entry that already passed this
 * function (or arrived Loader schema-complete), so it never observes a value
 * this function would reject.
 * @throws {Error} on loopback/URL/limit violations; misconfiguration fails the plugin load.
 */
export declare function resolveConfig(config: Config | Options): ResolvedConfig;
//# sourceMappingURL=config.d.ts.map