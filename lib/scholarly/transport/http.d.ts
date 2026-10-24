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
 *   cannot outrun the process-wide slot budget.
 *
 * A redirect is not a success. Counting each 3xx as one resets the breaker's
 * failure count once per hop for a redirect-looping host.
 *
 * @module dsh-zotero/scholarly/transport/http
 */
import { CircuitBreaker } from './circuit-breaker.js';
import { HostPacer } from './pacing.js';
type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;
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
}
interface CreateScholarlyHttpOptions {
    fetchImpl?: FetchFunction;
    circuitBreaker?: CircuitBreaker;
    pacer?: HostPacer;
    /** Process-wide in-flight ceiling for scholarly requests. */
    maxInFlight?: number;
}
export declare function createScholarlyHttp(options?: CreateScholarlyHttpOptions): ScholarlyHttp;
export {};
//# sourceMappingURL=http.d.ts.map