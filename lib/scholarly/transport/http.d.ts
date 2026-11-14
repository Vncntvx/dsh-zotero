/**
 * Resilient HTTP client for external scholarly services.
 *
 * It composes pieces the harness already supplies instead of restating them:
 *
 * - **Deadlines** come from `@deepseek-ai/dsh-timeout`'s `deadline()` /
 *   `timeoutOf()`, so a provider timeout and a caller abort stay
 *   distinguishable. A `setTimeout` signal cannot say which one fired, and the
 *   retry decision differs: a caller who aborted must not be retried at all.
 * - **Bounded reads** come from `transport-bounds.ts`, shared with the local
 *   Zotero transport.
 * - **Host acceptance and pacing** come from `hosts.ts`, the single host table.
 * - **In-flight bounds** come from `ConcurrencyGate`, so a seven-source fan-out
 *   cannot outrun the process-wide slot budget. A slot covers one attempt's
 *   fetch plus its body read: retry backoff happens outside the gate, so one
 *   host's rate-limit wait cannot starve the other sources of their slots.
 * - **Address safety** is two gates: `allowlist.ts` judges the name lexically
 *   (and refuses non-standard ports and allowlist-arm downgrades), and
 *   `network.ts` resolves the hostname and refuses non-public answers before
 *   the connection. One documented exception: when the local DNS proxy answers
 *   with its fake-IP placeholder, the allowlist arm accepts it for the reviewed
 *   hostnames and the open-access PDF arm accepts it for HTTPS targets only,
 *   where the TLS certificate binds the peer to the requested name. Plain-HTTP
 *   PDF targets and every other non-public answer stay refused. The validated
 *   set is pinned into the connection through an undici `Agent`, so DNS
 *   rebinding cannot re-bind the socket. Every redirect hop re-runs both gates
 *   against its own URL. A deterministic address refusal is final — neither
 *   retried nor recorded against the host's circuit — while a transient DNS
 *   resolution failure is retried and counted like any other transport failure.
 *
 * A redirect is not a success. Counting each 3xx as one resets the breaker's
 * failure count once per hop for a redirect-looping host.
 *
 * @module dsh-zotero/scholarly/transport/http
 */
import { CircuitBreaker } from './circuit-breaker.js';
import { HostPacer } from './pacing.js';
import { type AddressResolver, type HostnamePredicate, type PinnedDispatcher, type ResolvedAddress } from '../../transport/network.js';
type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * The host seams both scholarly arms need: the DNS resolver that answers a
 * hostname, the factory that pins a validated closed address set into the
 * open-access PDF arm's per-attempt connection, and the factory for the
 * validating pool the allowlist arm connects through. The host composition
 * supplies them from `host-connections.ts`; a test supplies stubs. When the
 * transport runs without them, every external request fails loud instead of
 * connecting to an unjudged address. The pool factory takes the allowlist's
 * fake-IP acceptance predicate; the PDF arm's policy is decided per URL by
 * the transport and its dispatcher factory is unchanged.
 */
export interface ScholarlyPublicAccess {
    readonly resolver: AddressResolver;
    readonly createDispatcher: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher;
    readonly createValidatingDispatcher: (acceptFakeIpFor?: HostnamePredicate) => PinnedDispatcher;
}
/** Default byte ceiling for one response: the same bound the local transport uses. */
export declare const DEFAULT_MAX_BYTES: number;
/**
 * One non-2xx response from a scholarly host.
 *
 * Carries the **host only**, never the request URL: a scholarly URL can hold a
 * credential (NCBI's eutils accepts `api_key` nowhere else) or a DOI that is
 * itself sensitive research context, and this object is handed to callers and
 * message formatters. The host is all a caller needs to route on.
 */
export declare class ScholarlyHttpError extends Error {
    readonly status: number;
    readonly host: string;
    readonly retryAfterSeconds?: number | undefined;
    constructor(status: number, host: string, retryAfterSeconds?: number | undefined);
}
/**
 * A raw transport rejection with its underlying code preserved.
 *
 * `fetch failed` alone cannot distinguish an unreachable host from a dispatcher
 * built by another undici copy; the code (`UND_ERR_INVALID_ARG`, `ECONNRESET`,
 * …) can. The original rejection stays reachable as `cause`.
 */
export declare class ScholarlyTransportError extends Error {
    readonly host: string;
    readonly code: string;
    constructor(host: string, code: string, failure: unknown);
}
/**
 * Extract an HTTP status code from an error, without unchecked type casts.
 * @param error - the rejection from a transport or registry read.
 * @returns the status code, or undefined when the error carries none.
 */
export declare function httpStatusOf(error: unknown): number | undefined;
interface ScholarlyRequestOptions {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    retries?: number;
    allowPublicPdf?: boolean;
}
export interface ScholarlyHttp {
    bytes(url: string, options?: ScholarlyRequestOptions): Promise<Uint8Array>;
    text(url: string, options?: ScholarlyRequestOptions): Promise<string>;
    json<T = unknown>(url: string, options?: ScholarlyRequestOptions): Promise<T>;
    circuitBreaker: CircuitBreaker;
    pacer: HostPacer;
    /** Close the shared validating connection pool. Safe to call once. */
    dispose(): Promise<void>;
}
interface CreateScholarlyHttpOptions {
    /**
     * The fetch seam. It must accept the dispatchers `publicAccess` builds, so
     * the host composition passes `publicFetch` — the fetch from this package's
     * own undici copy. The runtime's global `fetch` ships a different undici
     * and rejects those dispatchers at the handler interface before a socket
     * opens. Required: neither a default nor a fallback may pick a fetch.
     */
    fetchImpl: FetchFunction;
    circuitBreaker?: CircuitBreaker;
    pacer?: HostPacer;
    /**
     * The host seams both arms connect through: the DNS resolver, the
     * closed-set pinned dispatcher factory for the open-access PDF arm, and
     * the validating pool factory for the allowlist arm. Absent means the
     * transport is not wired, and every external request fails loud instead
     * of connecting to an unjudged address.
     */
    publicAccess?: ScholarlyPublicAccess;
    /** The backoff seam; production sleeps abortably, tests substitute it. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Process-wide in-flight ceiling for scholarly requests. */
    maxInFlight?: number;
}
export declare function createScholarlyHttp(options: CreateScholarlyHttpOptions): ScholarlyHttp;
export {};
//# sourceMappingURL=http.d.ts.map