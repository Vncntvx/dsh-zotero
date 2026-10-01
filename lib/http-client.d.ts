/**
 * The Local API HTTP boundary: plain-loopback `fetch` with a pinned API
 * version, instance-identity protection, a streaming response byte bound,
 * and strict transport-error translation. Every request is request-driven —
 * there is no keep-alive state, no background work, and no redirect
 * following, so a loopback endpoint can never be taken elsewhere.
 * @module dsh-zotero/http-client
 */
import { ZoteroError } from './errors.js';
export interface ZoteroHttpClientOptions {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    /** How many data requests this client keeps in flight. */
    readonly maxInFlight: number;
}
export interface ZoteroHttpGetOptions {
    /** Caller cancellation; an abort preserves harness cancellation semantics, never a timeout. */
    readonly signal?: AbortSignal;
    /** Override the remembered instance id for this request. */
    readonly serverId?: string;
    /** Send the remembered instance id (default true); false suppresses it for identity refreshes. */
    readonly sendServerId?: boolean;
}
export interface ZoteroHttpResponse {
    readonly body: string;
    readonly headers: Headers;
}
/** Shown when the provider deadline elapses before Zotero answers. */
export declare function requestTimeoutMessage(timeoutMs: number): string;
/** Shown when a transport failure carries no more specific diagnosis. */
export declare const UNEXPECTED_REQUEST_MESSAGE = "Zotero local API request failed unexpectedly.";
/** Shown when Zotero answers a request with a redirect, which this client refuses to follow. */
export declare const REDIRECT_REFUSED_MESSAGE = "Zotero responded with a redirect, which this plugin refuses to follow.";
/** Shown when the requested object is not in the library. */
export declare const OBJECT_NOT_FOUND_MESSAGE = "Zotero did not find the requested object.";
/** Shown when Zotero answers with an HTTP status this client has no translation for. */
export declare function httpStatusMessage(status: number): string;
/**
 * Statuses the read and write transports translate identically: bad request
 * (400 -> INVALID_ARGUMENT), redirects (never followed), a missing object
 * (404 -> NOT_FOUND), and anything else unmapped (UNEXPECTED). Each
 * transport's own switch handles its specific codes first and falls through
 * here, so the shared arms cannot shadow a specific one.
 * @param status - the response status.
 * @returns the error to throw.
 */
export declare function sharedHttpStatusError(status: number): ZoteroError;
/** Shown when a response body is not the JSON the API documents. */
export declare const UNPARSEABLE_RESPONSE_MESSAGE = "Zotero returned an unparseable response.";
/** Shown when a response passes the byte bound while streaming. */
export declare function responseTooLargeMessage(maxResponseBytes: number): string;
/**
 * The remedy when the running Zotero refused a version older than its own: it
 * is newer than this plugin line, so the plugin is the side to update.
 */
export declare const NEWER_ZOTERO_ROUTE_MESSAGE = "The running Zotero is newer than this plugin line: update dsh-zotero to a version that speaks its local API version.";
/** The remedy when the running Zotero is older than the refused version. */
export declare function upgradeZoteroRouteMessage(requiredVersion: string): string;
/**
 * Shown when Zotero's local API does not implement the API version this plugin
 * requires. Both sides are named — the version Zotero refused and the version
 * it answered as — because the direction decides which side has to move.
 */
export declare function apiVersionMismatchMessage(rejected: string, serverVersion: string | null): string;
/**
 * Shown when a 501 is about the endpoint or its output format rather than the
 * API version. `path` is the API-relative path that was refused, so the model
 * knows which call this build cannot serve.
 */
export declare function notImplementedRequestMessage(path: string): string;
/**
 * Translate a `fetch` or body-read rejection. Caller cancellation and the
 * provider's own deadline win over transport heuristics; the deadline is
 * classified by its stamped reason rather than by engine error names, and
 * the remaining network errors carry the unreachable-instance diagnosis.
 * Shared with the write transport (`write-http.ts`), which adds the
 * write-specific status translations on top of this base.
 * @param error - the rejection to translate.
 * @param signal - the fused deadline signal; its reason identifies the timeout.
 * @param callerSignal - the caller's own signal; its abort always wins.
 * @param timeoutMs - the deadline the timeout message reports.
 */
export declare function translateFetchError(error: unknown, signal: AbortSignal, callerSignal: AbortSignal | undefined, timeoutMs: number): never;
/**
 * Read a response body as text, enforcing the byte bound while streaming.
 * The body is never buffered past the bound, so oversized responses fail
 * before their full size reaches memory. Shared with the write transport,
 * which applies the same bound to every write response.
 */
export declare function readBody(response: Response, maxResponseBytes: number): Promise<string>;
/**
 * Read what a failure response states, under the response byte bound; shared
 * with the write transport. Caller cancellation and the deadline still win
 * over the statement: the request did reach Zotero, but an aborted read is
 * the caller's failure, not a fact about the refusal. Any other read failure
 * leaves the statement unavailable — the status itself is still the finding.
 */
export declare function readFailureStatement(response: Response, maxResponseBytes: number, signal: AbortSignal, callerSignal: AbortSignal | undefined, timeoutMs: number): Promise<string>;
/**
 * Zotero's own statement that a write's instance id did not match
 * (`Zotero-Server-ID does not match this server`, `server_localAPI.js:635`
 * at 10.0.2). Zotero shares the 412 status between this identity refusal and
 * version preconditions failing; the statement, not the status, tells them
 * apart. The write transport matches this exact substring and answers
 * everything else with the version-conflict diagnosis, which is the common
 * case for keyed writes.
 */
export declare const SERVER_ID_MISMATCH_STATEMENT = "does not match this server";
export declare class ZoteroHttpClient {
    private readonly options;
    private currentServerId;
    private readonly baseUrlWithSlash;
    /**
     * One gate for every data request this client makes. Pools bound each
     * call's fan-out, but nothing bounded their product: five concurrent tool
     * calls held twenty requests open against the local server at once. The
     * slots are held for the whole request — connection, body, streamed read —
     * because the bytes are what the bound is for.
     */
    private readonly gate;
    constructor(options: ZoteroHttpClientOptions);
    /** The instance id remembered from the latest response carrying one (Zotero 10+). */
    get serverId(): string | undefined;
    /**
     * The authority this client actually dials, e.g. `127.0.0.1:23119`. The
     * connectivity probe reports it, so a status card names the endpoint it
     * reached rather than a configured default that may not be this one. It is
     * the dialled value, not a re-read of the configuration: a provider behind a
     * different transport reports its own.
     */
    get endpoint(): string;
    /**
     * GET a path relative to the API base (no leading slash; `''` is `/api/`).
     * @param path - relative path, e.g. `users/0/items/ABCD1234`.
     * @param search - query parameters, serialized verbatim.
     */
    get(path: string, search?: URLSearchParams, opts?: ZoteroHttpGetOptions): Promise<ZoteroHttpResponse>;
    /**
     * GET with the single-refresh guard carried as a positional parameter —
     * deliberately not part of `ZoteroHttpGetOptions`, so no caller can set
     * (or bypass) the identity-refresh recursion guard from outside.
     */
    private doGet;
    /**
     * Take one gate slot; a queued abort reports as the caller's cancellation.
     */
    private takeSlot;
    /** Send one request and read its body; the caller holds a slot for this. */
    private send;
    /** GET and parse a JSON response. */
    getJson<T>(path: string, search?: URLSearchParams, opts?: ZoteroHttpGetOptions): Promise<{
        json: T;
        body: string;
        headers: Headers;
    }>;
    private rememberServerId;
    /** Re-read `/api/` without the remembered id so a stale id cannot 412 the refresh. */
    private refreshIdentity;
}
//# sourceMappingURL=http-client.d.ts.map