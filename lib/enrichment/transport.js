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
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { isPublicUrl, PublicAddressError } from '../transport/public-url.js';
import { deadline } from '@deepseek-ai/dsh-timeout';
import { closePinnedQuietly, isIpv4Literal, resolvePublicAddresses, } from '../transport/network.js';
import { readBoundedBytes, readBoundedText, ResponseTooLargeError } from '../transport-bounds.js';
import { errnoCodeOf } from '../errors.js';
import { egressRouteFor } from '../transport/connections.js';
import { isMineruApiHost, MINERU_API_ORIGIN } from './hosts.js';
import { ConcurrencyGate } from '../concurrency.js';
import { redactParseText } from './parse-target.js';
import { setTimeout as delay } from 'node:timers/promises';
/** One non-2xx response. Carries host and a sanitized detail, never a URL. */
export class MineruHttpError extends Error {
    status;
    host;
    detail;
    apiCode;
    traceId;
    retryAfterMs;
    constructor(status, host, detail, apiCode, traceId, retryAfterMs) {
        super(`HTTP ${status} from ${host}${detail === undefined ? '' : `: ${detail}`}${apiCode === undefined ? '' : ` (MinerU ${apiCode})`}${traceId === undefined ? '' : ` [trace ${traceId}]`}`);
        this.status = status;
        this.host = host;
        this.detail = detail;
        this.apiCode = apiCode;
        this.traceId = traceId;
        this.retryAfterMs = retryAfterMs;
        this.name = 'MineruHttpError';
    }
}
const DEFAULT_TIMEOUT_MS = 60_000;
/** The deadline's TimeoutReason code: a MinerU transport timeout, not a caller abort. */
const MINERU_TIMEOUT_REASON = 'mineru/transport-timeout';
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const ERROR_DETAIL_MAX_BYTES = 4 * 1024;
const ERROR_DETAIL_MAX_CHARS = 256;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const MAX_REDIRECTS = 5;
/** Errnos that mark a transient network failure worth retrying; read through
 * the cause chain, since undici keeps the errno off the top-level error. */
const RETRYABLE_ERRNOS = [
    'EAI_AGAIN',
    'ECONNRESET',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
];
/** Reduce an error body to a bounded, URL-free one-liner. */
export function sanitizedErrorDetail(text) {
    const trimmed = text.trim();
    if (trimmed === '')
        return undefined;
    let message;
    try {
        const parsed = JSON.parse(trimmed);
        const candidate = parsed.msg ?? parsed.message ?? parsed.Message;
        const code = parsed.code ?? parsed.Code;
        if (typeof candidate === 'string' && candidate.trim() !== '')
            message = candidate;
        else if (typeof code === 'string' && code.trim() !== '')
            message = code;
    }
    catch {
        // Not JSON; try XML below.
    }
    if (message === undefined) {
        const xmlMessage = /<Message>([^<]*)<\/Message>/i.exec(trimmed)?.[1];
        const xmlCode = /<Code>([^<]*)<\/Code>/i.exec(trimmed)?.[1];
        message = xmlMessage?.trim() || xmlCode?.trim();
    }
    if (message === undefined)
        message = trimmed.split(/\r?\n/)[0];
    const cleaned = redactParseText(message ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (cleaned === '')
        return undefined;
    if (cleaned.length <= ERROR_DETAIL_MAX_CHARS)
        return cleaned;
    // Keep the diagnosis and the recovery action after redacting the full input.
    return `${cleaned.slice(0, 96)}…${cleaned.slice(-(ERROR_DETAIL_MAX_CHARS - 97))}`;
}
async function errorOf(response, hostname) {
    let detail;
    let apiCode;
    let traceId;
    try {
        const body = await readBoundedText(response, ERROR_DETAIL_MAX_BYTES);
        detail = sanitizedErrorDetail(body);
        try {
            const data = JSON.parse(body);
            if (typeof data.code === 'number' ||
                (typeof data.code === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(data.code)))
                apiCode = data.code;
            if (typeof data.trace_id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(data.trace_id))
                traceId = data.trace_id;
        }
        catch {
            /* Non-JSON errors still retain their sanitized detail. */
        }
    }
    catch {
        /* An oversized error body is discarded. */
    }
    const raw = response.headers.get('retry-after');
    const seconds = raw === null ? NaN : Number(raw);
    const retryAfterMs = raw === null
        ? undefined
        : Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : Math.max(0, Date.parse(raw) - Date.now());
    return new MineruHttpError(response.status, hostname, detail, apiCode, traceId, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
}
async function pause(ms, signal) {
    try {
        await delay(ms, undefined, { signal });
    }
    catch (error) {
        signal.throwIfAborted();
        throw error;
    }
}
export class MineruClient {
    deps;
    gate = new ConcurrencyGate(4);
    blockedUntil = 0;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * Perform one request, following redirects with per-hop re-validation.
     * @returns the bounded bytes, status, headers, and validated terminal URL.
     */
    async attempt(url, options) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
            // The deadline fuses the caller's cancellation with the request timeout;
            // its TimeoutReason keeps a MinerU timeout distinguishable from an abort.
            const timeout = __addDisposableResource(env_1, deadline(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MINERU_TIMEOUT_REASON), false);
            const combined = timeout.signal;
            let currentUrl = url;
            for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                combined.throwIfAborted();
                let parsed;
                try {
                    parsed = new URL(currentUrl);
                }
                catch {
                    throw new PublicAddressError('MinerU address is not a valid URL.', 'policy');
                }
                if (parsed.username || parsed.password || !isPublicUrl(parsed.href)) {
                    throw new PublicAddressError('MinerU address is not a permitted public HTTP(S) address.', 'policy');
                }
                const hostname = parsed.hostname;
                if (isMineruApiHost(hostname) && parsed.origin !== MINERU_API_ORIGIN)
                    throw new PublicAddressError('MinerU API requests require the fixed HTTPS origin.', 'policy');
                // The harness proxy policy decides the transport per hop: proxied, the
                // route's shared dispatcher performs the DNS and is never closed; direct,
                // the pinned closed set keeps the check-then-connect guarantee. The
                // token stays host-scoped either way.
                const route = egressRouteFor(parsed);
                const addresses = route.proxied
                    ? undefined
                    : await resolvePublicAddresses(hostname, this.deps.resolver, {
                        signal: combined,
                        acceptFakeIp: parsed.protocol === 'https:' && !isIpv4Literal(hostname),
                    });
                const connection = route.proxied
                    ? undefined
                    : this.deps.dispatcher(addresses);
                // Authorization is host-scoped: only the fixed API host ever sees it.
                const suppliedHeaders = Object.fromEntries(Object.entries(options.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization'));
                const headers = {
                    ...suppliedHeaders,
                    ...(options.token !== undefined && isMineruApiHost(hostname)
                        ? { authorization: `Bearer ${options.token}` }
                        : {}),
                };
                try {
                    const response = await this.deps.fetch(parsed.href, {
                        method: options.method,
                        headers,
                        body: options.body,
                        redirect: 'manual',
                        signal: combined,
                        credentials: 'omit',
                        referrerPolicy: 'no-referrer',
                        dispatcher: route.proxied ? route.dispatcher : connection.dispatcher,
                    });
                    if (REDIRECT_STATUSES.includes(response.status)) {
                        const location = response.headers.get('location');
                        await response.body?.cancel();
                        if (location === null || hop === MAX_REDIRECTS) {
                            throw new MineruHttpError(response.status, hostname);
                        }
                        const next = new URL(location, parsed);
                        if (parsed.protocol === 'https:' && next.protocol !== 'https:') {
                            throw new PublicAddressError('HTTPS MinerU redirects may not downgrade to HTTP.', 'policy');
                        }
                        if (isMineruApiHost(hostname) ||
                            (options.method === 'PUT' && response.status !== 307 && response.status !== 308) ||
                            options.method === 'POST')
                            throw new MineruHttpError(response.status, hostname, 'Unsafe request redirect refused');
                        currentUrl = next.href;
                        continue;
                    }
                    if (!response.ok) {
                        throw await errorOf(response, hostname);
                    }
                    if (response.status === 206)
                        throw new MineruHttpError(206, hostname, 'Partial response refused');
                    const length = Number(response.headers.get('content-length'));
                    if (Number.isFinite(length) && length > maxBytes) {
                        await response.body?.cancel();
                        throw new ResponseTooLargeError(maxBytes);
                    }
                    if (options.method === 'HEAD') {
                        combined.throwIfAborted();
                        return {
                            status: response.status,
                            bytes: new Uint8Array(),
                            headers: response.headers,
                            finalUrl: parsed.href,
                        };
                    }
                    const bytes = await readBoundedBytes(response, maxBytes);
                    combined.throwIfAborted();
                    return { status: response.status, bytes, headers: response.headers, finalUrl: parsed.href };
                }
                finally {
                    // The proxy route's dispatcher is process-wide and shared; only the
                    // pinned per-attempt agent is closed here.
                    await closePinnedQuietly(connection);
                }
            }
            throw new MineruHttpError(310, new URL(currentUrl).hostname);
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    /** Retry only idempotent operations, bounded by one shared request deadline. */
    async request(url, options) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const timeout = __addDisposableResource(env_2, deadline(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MINERU_TIMEOUT_REASON), false);
            const signal = timeout.signal;
            // Cache revalidation is one HEAD operation; a failed probe cannot create
            // extra network requests or silently acquire the document with GET.
            const attempts = options.method === 'POST' || options.method === 'HEAD' ? 1 : 3;
            for (let attempt = 0; attempt < attempts; attempt++) {
                signal.throwIfAborted();
                if (this.blockedUntil > Date.now())
                    await pause(this.blockedUntil - Date.now(), signal);
                let release;
                let retryMs = 0;
                try {
                    release = await this.gate.acquire(signal);
                    if (this.blockedUntil > Date.now())
                        await pause(this.blockedUntil - Date.now(), signal);
                    const response = await this.attempt(url, { ...options, signal });
                    signal.throwIfAborted();
                    return response;
                }
                catch (error) {
                    signal.throwIfAborted();
                    const transient = error instanceof MineruHttpError
                        ? [408, 429, 500, 502, 503, 504].includes(error.status)
                        : error instanceof PublicAddressError
                            ? error.reason === 'resolution-failed'
                            : RETRYABLE_ERRNOS.includes(errnoCodeOf(error) ?? '');
                    retryMs =
                        error instanceof MineruHttpError && error.retryAfterMs !== undefined
                            ? error.retryAfterMs
                            : 1000 * 2 ** attempt;
                    if (error instanceof MineruHttpError && error.status === 429)
                        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryMs);
                    if (!transient || attempt + 1 === attempts)
                        throw error;
                }
                finally {
                    release?.();
                }
                await pause(retryMs, signal);
            }
            throw new Error('MinerU retry budget exhausted');
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    /** JSON request/response with a bounded body. */
    async json(url, options) {
        const { bytes } = await this.request(url, {
            ...options,
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                ...options.headers,
            },
        });
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        try {
            return JSON.parse(text);
        }
        catch (error) {
            throw new Error('MinerU returned a malformed JSON response.', { cause: error });
        }
    }
    /** Raw-byte request/response (signed upload, result download). */
    async bytes(url, options) {
        return (await this.request(url, options)).bytes;
    }
    /** GET returning the bounded body and its response headers. */
    async get(url, options) {
        const { bytes, headers, finalUrl } = await this.request(url, { ...options, method: 'GET' });
        return { bytes, headers, finalUrl };
    }
    /** HEAD used by the cache to revalidate a URL source without downloading it. */
    async head(url, options) {
        const { status, headers, finalUrl } = await this.request(url, { ...options, method: 'HEAD' });
        return { status, headers, finalUrl };
    }
    /** Decode bounded bytes as UTF-8 text (Markdown download). */
    static textOf(bytes, maxBytes) {
        if (bytes.byteLength > maxBytes)
            throw new ResponseTooLargeError(maxBytes);
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
}
//# sourceMappingURL=transport.js.map