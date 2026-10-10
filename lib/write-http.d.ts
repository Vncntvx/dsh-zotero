/**
 * The Local API write boundary. Zotero 10 gates every local write behind a
 * locally issued API key and the serving instance id, and applies batched
 * objects one transaction each, so this client carries the protocol the
 * running Zotero implements (source-level facts:
 * `chrome/content/zotero/xpcom/server/server_localAPI.js` at 10.0.2):
 *
 * - every write requires the `Zotero-Server-ID` header (428 without, 412 on
 *   mismatch) and a `Zotero-API-Key` issued by `/api/local/authorize`;
 * - single-use keys are consumed at authentication time, before the write
 *   runs, so a failed batch still burns them and 401 means "authorize again";
 * - batches are NOT atomic: each object commits in its own transaction and
 *   per-object outcomes land in the response buckets, so callers map the
 *   buckets and never replay blindly;
 * - `PATCH` merges arrays wholesale (they replace, never union), which is
 *   why the tag/collection domain reads-merges-writes around this client.
 *
 * The transport runs zero retries and no identity refresh: a 401 is reported
 * to the domain, which may authorize once and replay the same batch; a 412
 * that is not an identity mismatch is a version conflict and reaches the
 * model as `ZOTERO_WRITE_CONFLICT`.
 * @module dsh-zotero/write-http
 */
import { ZoteroError, type ZoteroErrorCode } from './errors.js';
export interface ZoteroWriteHttpClientOptions {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    /**
     * Deadline for the Zotero authorization dialog: that request waits for a
     * human, so it is independent of the per-request data deadline.
     */
    readonly authorizeDeadlineMs: number;
}
/** Options every write carries: cancellation, the serving instance, the local API key. */
export interface ZoteroWriteOptions {
    /** Caller cancellation; an abort preserves harness cancellation semantics. */
    readonly signal?: AbortSignal;
    /**
     * The serving instance id, taken from a read response. Zotero refuses a
     * write without it (428) and refuses a mismatched one (412), so this binds
     * every write to the instance the plugin last read from.
     */
    readonly serverId: string;
    /** The local API key `/api/local/authorize` issued. */
    readonly apiKey: string;
}
export interface ZoteroAuthorizeOptions {
    readonly signal?: AbortSignal;
    /** The authorize endpoint is a write-method request: Zotero requires the instance id here too. */
    readonly serverId: string;
}
/** One failed object inside a write batch, with Zotero's own status and statement. */
export interface ZoteroWriteObjectFailure {
    readonly key: string;
    readonly code: number;
    readonly message: string;
}
/**
 * The per-object outcome buckets of a write batch. `successful` carries the
 * full response JSON of each written object (key, version, data), the
 * read-back Zotero performs for the caller, so no follow-up GET is needed
 * for created notes.
 */
export interface ZoteroBatchWrite {
    readonly successful: Record<string, Record<string, unknown>>;
    readonly success: Record<string, string>;
    readonly unchanged: Record<string, string>;
    readonly failed: Record<string, ZoteroWriteObjectFailure>;
    /** The library version the batch advanced the library to. */
    readonly libraryVersion: number;
}
/**
 * A write request that reached the response/commit boundary but whose
 * outcome could not be proven. Callers that create non-idempotent objects
 * must surface this as a non-retryable, commit-unknown result rather than
 * inviting a second write.
 */
export declare class ZoteroWriteCommitUnknownError extends ZoteroError {
    constructor(message: string, code: ZoteroErrorCode, options?: ErrorOptions);
}
export interface ZoteroPatchWriteOptions extends ZoteroWriteOptions {
    /** The object version the caller read; Zotero refuses a stale write with 412. */
    readonly ifUnmodifiedSinceVersion: number;
}
export interface ZoteroDeleteWriteOptions extends ZoteroWriteOptions {
    /**
     * The library version the caller read before the delete; Zotero refuses a
     * stale delete with 412. Absence means no version precondition is sent; the
     * domain always sends one, so absence here is only for tests.
     */
    readonly ifUnmodifiedSinceVersion?: number;
    /**
     * Marks the delete payload as a bounded name list (the library-tags
     * delete). A 413 then means the name list exceeded the server cap, a
     * caller-facing argument error, instead of the batch-size protocol drift a
     * 413 means everywhere else. The domain sets this on the tags path it
     * builds; no caller should guess it from the URL.
     */
    readonly tagDeleteLimit?: boolean;
}
export interface ZoteroAuthorizeGrant {
    readonly key: string;
    /** True when the user picked "Always Allow"; the key persists until revoked in Zotero. */
    readonly remember: boolean;
}
/**
 * The write transport of the Zotero Local API. One request in flight, no
 * retries, no identity refresh. The write path has exactly one legitimate
 * replay (re-authorize after 401, then send the same batch again) and that
 * replay belongs to the domain, not to transport heuristics.
 */
export declare class ZoteroWriteHttpClient {
    private readonly options;
    private readonly baseUrlWithSlash;
    private readonly gate;
    constructor(options: ZoteroWriteHttpClientOptions);
    /**
     * POST a JSON array of write objects. Zotero answers 200 with the
     * per-object buckets and the library version it advanced to; a non-atomic
     * batch reports successes and failures side by side.
     */
    batch(path: string, entries: readonly unknown[], opts: ZoteroWriteOptions): Promise<ZoteroBatchWrite>;
    /**
     * PATCH a single object (merge semantics per the web API). Zotero answers
     * 204 with the library version only, and the written object's version is
     * that same library version, so no follow-up GET is needed.
     */
    patch(path: string, body: object, opts: ZoteroPatchWriteOptions): Promise<{
        libraryVersion: number;
    }>;
    /**
     * DELETE one object or tag set. Zotero answers 204 with the library version
     * the delete advanced to. Deletes are idempotent by key/name, so failures
     * stay typed (never commit-unknown) and a retry is safe.
     * @param path - the API-relative delete path, built by the domain.
     * @param opts - the serving instance, the API key, the library/object version
     *   precondition, and (for the library-tags delete) the `tagDeleteLimit` mark
     *   that turns a 413 into the caller-facing tag-limit error.
     * @returns the library version the delete advanced to.
     */
    delete(path: string, opts: ZoteroDeleteWriteOptions): Promise<{
        libraryVersion: number;
    }>;
    /**
     * Request a local write key. Zotero shows its user a dialog: Allow (the
     * key works once, then is consumed), Always Allow (persistent), or Deny.
     * A denial and every other refusal arrive as `ZoteroError`s with
     * write-specific codes and messages; only a grant returns.
     */
    authorize(appName: string, opts: ZoteroAuthorizeOptions): Promise<ZoteroAuthorizeGrant>;
    /**
     * Send one write request. The gate slot is held across connection, body
     * and streamed response read, exactly like the read transport; the
     * deadline starts after the slot so queue time is never Zotero latency.
     */
    private send;
    /**
     * Take the single write slot; a queued abort reports as the caller's
     * cancellation.
     */
    private takeSlot;
    /**
     * Translate a non-2xx write response. The write path maps Zotero's own
     * statuses onto the plugin's write vocabulary: 401/403/429/412 carry
     * write-specific codes, a 413 on a delete the domain marked as a name-list
     * payload carries the tag limit, and the two statuses that cannot happen
     * if the plugin is correct (428, batch 413) fail loud as protocol drift
     * instead of being disguised as domain errors.
     */
    private translateWriteStatus;
    /**
     * Parse the batch outcome buckets. The documented write shape names four
     * buckets and Zotero answers with all of them; a bucket that is present
     * but malformed is protocol drift and fails loud rather than being
     * silently reshaped.
     */
    private parseBatchWrite;
}
//# sourceMappingURL=write-http.d.ts.map