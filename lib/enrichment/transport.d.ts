/**
 * The MinerU HTTP client.
 *
 * One request path covers submit, signed upload, poll, result download, and
 * the cache's HEAD revalidation. It composes the same public-address double
 * gate the URL-PDF reader uses: `isPublicUrl` (lexical: HTTP(S), port 80/443,
 * no private/literal hosts) and `resolvePublicAddresses` + a pinned dispatcher
 * (DNS answers judged public and pinned into the socket, so rebinding cannot
 * re-point it). Every redirect hop re-runs both gates against its own URL.
 *
 * Every MinerU address is HTTPS (the API schemas refuse plain HTTP), so an
 * HTTPS target accepts the local proxy's fake-IP placeholder the way the
 * open-access PDF arm does: the TLS certificate binds the peer to the
 * requested name, which the placeholder itself does not. A plain-HTTP target
 * and an IP literal keep the strict judgment — the exception applies to a
 * resolver's answer, never to an address a URL spells.
 *
 * Credentials are dispatched **by host**: the Bearer token is attached only to
 * the fixed `mineru.net` API host. Signed upload URLs, result CDN links, and
 * source-URL HEAD requests are returned by the API or supplied by the caller
 * on arbitrary public hosts and must never receive it.
 *
 * A non-2xx response's bounded body is reduced to a sanitized one-line detail
 * (JSON `msg`/`message`, XML `Message`/`Code`, or the first line) so a signed
 * upload's `SignatureDoesNotMatch` is visible in the error without
 * leaking the signed URL.
 * @module dsh-zotero/enrichment/transport
 */
import { type AddressResolver, type PinnedDispatcher, type ResolvedAddress } from '../transport/network.js';
type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;
/** The host seams, injectable so unit tests never open a real socket. */
export interface MineruTransportDeps {
    readonly resolver: AddressResolver;
    readonly dispatcher: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher;
    readonly fetch: FetchFunction;
}
/** One non-2xx response. Carries host and a sanitized detail, never a URL. */
export declare class MineruHttpError extends Error {
    readonly status: number;
    readonly host: string;
    readonly detail?: string | undefined;
    readonly apiCode?: string | number | undefined;
    readonly traceId?: string | undefined;
    readonly retryAfterMs?: number | undefined;
    constructor(status: number, host: string, detail?: string | undefined, apiCode?: string | number | undefined, traceId?: string | undefined, retryAfterMs?: number | undefined);
}
export interface MineruRequestOptions {
    readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT';
    readonly headers?: Record<string, string>;
    readonly body?: string | Uint8Array;
    /** Resolved precise-API token; attached only to `mineru.net` requests. */
    readonly token?: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly maxBytes?: number;
}
export interface MineruResponse {
    readonly status: number;
    readonly bytes: Uint8Array;
    readonly headers: Headers;
    /** The validated terminal request URL, independent of Response.url. */
    readonly finalUrl: string;
}
/** Reduce an error body to a bounded, URL-free one-liner. */
export declare function sanitizedErrorDetail(text: string): string | undefined;
export declare class MineruClient {
    private readonly deps;
    private readonly gate;
    private blockedUntil;
    constructor(deps: MineruTransportDeps);
    /**
     * Perform one request, following redirects with per-hop re-validation.
     * @returns the bounded bytes, status, headers, and validated terminal URL.
     */
    private attempt;
    /** Retry only idempotent operations, bounded by one shared request deadline. */
    request(url: string, options: MineruRequestOptions): Promise<MineruResponse>;
    /** JSON request/response with a bounded body. */
    json<T>(url: string, options: MineruRequestOptions): Promise<T>;
    /** Raw-byte request/response (signed upload, result download). */
    bytes(url: string, options: MineruRequestOptions): Promise<Uint8Array>;
    /** GET returning the bounded body and its response headers. */
    get(url: string, options: MineruRequestOptions): Promise<{
        bytes: Uint8Array;
        headers: Headers;
        finalUrl: string;
    }>;
    /** HEAD used by the cache to revalidate a URL source without downloading it. */
    head(url: string, options: MineruRequestOptions): Promise<{
        status: number;
        headers: Headers;
        finalUrl: string;
    }>;
    /** Decode bounded bytes as UTF-8 text (Markdown download). */
    static textOf(bytes: Uint8Array, maxBytes: number): string;
}
export {};
//# sourceMappingURL=transport.d.ts.map