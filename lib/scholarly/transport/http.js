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
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { ConcurrencyGate } from '../../concurrency.js';
import { DEFAULT_MAX_RESPONSE_BYTES } from '../../constants.js';
import { readBoundedBytes, readBoundedText, ResponseTooLargeError } from '../../transport-bounds.js';
import { errnoCodeOf, errorDetailOf } from '../../errors.js';
import { addressRefusalOf } from '../../transport/public-url.js';
import { assertAllowedScholarlyUrl, isAllowedScholarlyHost, ScholarlySecurityError, } from './allowlist.js';
import { CircuitBreaker, ScholarlyCircuitOpenError } from './circuit-breaker.js';
import { HostPacer, abortableSleep } from './pacing.js';
import { isIpv4Literal, resolvePublicAddresses, } from '../../transport/network.js';
/** Deadline code stamped on a provider timeout, so a call can classify it. */
const SCHOLARLY_TIMEOUT = 'SCHOLARLY_TIMEOUT';
/** Default byte ceiling for one response: the same bound the local transport uses. */
export const DEFAULT_MAX_BYTES = DEFAULT_MAX_RESPONSE_BYTES;
/** Default per-request deadline. */
const DEFAULT_TIMEOUT_MS = 25_000;
/** Redirect statuses the loop follows, one hop per attempt. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
/**
 * Codes that mean the local fetch/dispatcher pairing is unusable, not that the
 * host is unhealthy: undici rejected the handler interface, or an argument had
 * the wrong type. Retrying cannot repair a composition error, and recording it
 * as a host failure would open a circuit against a healthy index.
 */
const NON_RETRYABLE_TRANSPORT_CODES = new Set([
    'UND_ERR_INVALID_ARG',
    'UND_ERR_INVALID_RETURN_VALUE',
    'ERR_INVALID_ARG_TYPE',
]);
/**
 * One non-2xx response from a scholarly host.
 *
 * Carries the **host only**, never the request URL: a scholarly URL can hold a
 * credential (NCBI's eutils accepts `api_key` nowhere else) or a DOI that is
 * itself sensitive research context, and this object is handed to callers and
 * message formatters. The host is all a caller needs to route on.
 */
export class ScholarlyHttpError extends Error {
    status;
    host;
    retryAfterSeconds;
    constructor(status, host, retryAfterSeconds) {
        super(status === 429
            ? `Rate limited by ${host}${retryAfterSeconds === undefined ? '' : ` (retry after ${retryAfterSeconds}s)`}`
            : `HTTP ${status} from ${host}`);
        this.status = status;
        this.host = host;
        this.retryAfterSeconds = retryAfterSeconds;
        this.name = 'ScholarlyHttpError';
    }
}
/**
 * A raw transport rejection with its underlying code preserved.
 *
 * `fetch failed` alone cannot distinguish an unreachable host from a dispatcher
 * built by another undici copy; the code (`UND_ERR_INVALID_ARG`, `ECONNRESET`,
 * …) can. The original rejection stays reachable as `cause`.
 */
export class ScholarlyTransportError extends Error {
    host;
    code;
    constructor(host, code, failure) {
        super(errorDetailOf(failure), { cause: failure });
        this.host = host;
        this.code = code;
        this.name = 'ScholarlyTransportError';
    }
}
/**
 * Restate a raw fetch rejection as a typed transport failure when it carries an
 * errno-style code. A codeless rejection keeps its original shape, so existing
 * failure wording is unchanged.
 * @param error - the rejection from a fetch attempt.
 * @param host - the host the attempt targeted.
 * @returns the typed failure, or undefined when there is no code to report.
 */
function describeTransportFailure(error, host) {
    const code = errnoCodeOf(error);
    return code === undefined ? undefined : new ScholarlyTransportError(host, code, error);
}
/**
 * Extract an HTTP status code from an error, without unchecked type casts.
 * @param error - the rejection from a transport or registry read.
 * @returns the status code, or undefined when the error carries none.
 */
export function httpStatusOf(error) {
    if (error instanceof ScholarlyHttpError)
        return error.status;
    if (typeof error?.status === 'number') {
        return error.status;
    }
    return undefined;
}
/**
 * Whether a caller signal has fired.
 *
 * Read through a function so the compiler does not narrow `aborted` to `false`
 * across the request: the caller may abort at any await point.
 * @param signal - the caller's signal, when given.
 * @returns true when it fired.
 */
function callerAborted(signal) {
    return signal?.aborted === true;
}
/**
 * Whether a signal fired because the provider's deadline elapsed.
 * @param signal - the fused signal.
 * @returns true when this component's own deadline message is present.
 */
function isProviderTimeout(signal) {
    return timeoutOf(signal, SCHOLARLY_TIMEOUT) !== undefined;
}
export function createScholarlyHttp(options) {
    const fetchImpl = options.fetchImpl;
    const circuitBreaker = options.circuitBreaker ?? new CircuitBreaker();
    const pacer = options.pacer ?? new HostPacer();
    const gate = new ConcurrencyGate(options.maxInFlight ?? 8);
    const publicAccess = options.publicAccess;
    const sleep = options.sleep ?? abortableSleep;
    // One validating connection pool shared by every allowlist fetch: its
    // connector resolves through the DNS seam at connect time and refuses any
    // non-public answer, so every socket's address is judged at the moment it
    // is used. The fake-IP predicate is the reviewed-host exception: the name
    // comes from the same allowlist that gates every request above, and TLS
    // binds the peer's identity. Built lazily, because an http that never
    // fetches builds no agent, and closed by `dispose` with the owning service.
    // The attempt loop already fails loud on an unwired seam before reaching
    // this point; the guard here keeps the closure total.
    let validatingAgent;
    const sharedValidatingDispatcher = () => {
        if (publicAccess === undefined) {
            throw new ScholarlySecurityError('Security rejection: the scholarly transport is not wired to an address resolver, so no external request can be fetched safely.', 'policy');
        }
        validatingAgent ??= publicAccess.createValidatingDispatcher(isAllowedScholarlyHost);
        return validatingAgent;
    };
    const dispose = () => validatingAgent?.close() ?? Promise.resolve();
    const requestWithReader = async (url, reqOptions = {}, reader) => {
        const publicOnly = reqOptions.allowPublicPdf === true;
        let currentUrl = url;
        let redirectCount = 0;
        const maxRedirects = 5;
        const maxRetries = reqOptions.retries ?? 2;
        const timeoutMs = reqOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const maxBytes = reqOptions.maxBytes ?? DEFAULT_MAX_BYTES;
        const probeTokens = new Map();
        const releaseProbe = (host) => {
            const probeToken = probeTokens.get(host);
            circuitBreaker.releaseProbe(host, probeToken);
            probeTokens.delete(host);
        };
        const recordSuccess = (host) => {
            circuitBreaker.recordSuccess(host);
            probeTokens.delete(host);
        };
        const recordFailure = (host) => {
            circuitBreaker.recordFailure(host);
            probeTokens.delete(host);
        };
        // The caller's cancellation is the only abort that stops a retry: their
        // signal is checked directly, never inferred from a fused one. A retry
        // delay is paid *after* the gate slot and the pinned agent are released,
        // so one host's rate-limit wait cannot starve the other sources.
        for (let attempt = 0;; attempt++) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                if (callerAborted(reqOptions.signal)) {
                    releaseProbe(new URL(currentUrl).hostname);
                    throw reqOptions.signal?.reason ?? new Error('Operation aborted');
                }
                // The lexical gate lives in the allowlist module, so the initial URL
                // and every redirect hop are judged by the same rule (including the
                // allowlist arm's HTTPS-only requirement). A same-host redirect may
                // still hold this request's half-open probe token, so a rejection here
                // must release the token it owns before leaving the loop.
                const target = new URL(currentUrl);
                const hostname = target.hostname;
                try {
                    assertAllowedScholarlyUrl(currentUrl, publicOnly);
                }
                catch (error) {
                    if (probeTokens.has(hostname))
                        releaseProbe(hostname);
                    throw error;
                }
                // The breaker, the pacer, and every error message key on the bare
                // hostname: the interval table has no port column, and a keyed-by-port
                // entry would bypass pacing and split breaker circuits.
                const d = __addDisposableResource(env_1, deadline(reqOptions.signal, timeoutMs, SCHOLARLY_TIMEOUT), false);
                const probeToken = circuitBreaker.beforeRequest(hostname, probeTokens.get(hostname));
                if (probeToken === undefined)
                    probeTokens.delete(hostname);
                else
                    probeTokens.set(hostname, probeToken);
                const halfOpenProbe = probeToken !== undefined;
                try {
                    await pacer.pace(hostname, d.signal);
                }
                catch (error) {
                    releaseProbe(hostname);
                    if (isProviderTimeout(d.signal))
                        throw new ScholarlyHttpError(504, hostname);
                    throw error;
                }
                // Every arm must prove its DNS answer public before it may connect.
                // The open-access PDF arm leaves the allowlist, so it resolves and
                // pins a closed per-attempt set: check-then-connect without pinning is
                // exactly the DNS rebinding window. The allowlist arm shares one
                // validating pool whose connector judges each answer at connect time.
                // A composition that never wired the seams fails loud here instead of
                // connecting to an unjudged address.
                let pinned;
                try {
                    if (publicAccess === undefined) {
                        throw new ScholarlySecurityError('Security rejection: the scholarly transport is not wired to an address resolver, so no external request can be fetched safely.', 'policy');
                    }
                    if (publicOnly) {
                        // An HTTPS target binds the peer's identity to the requested name,
                        // so the fake-IP placeholder is acceptable there. A plain-HTTP
                        // target has no such binding, and an IP literal spelled the
                        // placeholder itself rather than a DNS answer.
                        const acceptFakeIp = target.protocol === 'https:' && !isIpv4Literal(hostname);
                        const addresses = await resolvePublicAddresses(hostname, publicAccess.resolver, {
                            signal: d.signal,
                            acceptFakeIp,
                        });
                        pinned = publicAccess.createDispatcher(addresses);
                    }
                }
                catch (error) {
                    releaseProbe(hostname);
                    if (callerAborted(reqOptions.signal))
                        throw error;
                    if (isProviderTimeout(d.signal))
                        throw new ScholarlyHttpError(504, hostname);
                    throw error;
                }
                const dispatcher = pinned ?? sharedValidatingDispatcher();
                let release;
                try {
                    release = await gate.acquire(d.signal);
                }
                catch (error) {
                    releaseProbe(hostname);
                    await pinned?.close();
                    if (isProviderTimeout(d.signal))
                        throw new ScholarlyHttpError(504, hostname);
                    throw error;
                }
                let retryDelayMs;
                try {
                    const response = await fetchImpl(currentUrl, {
                        headers: {
                            'user-agent': 'dsh-zotero/scholarly (https://github.com/Vncntvx/dsh-zotero)',
                            ...reqOptions.headers,
                        },
                        signal: d.signal,
                        redirect: 'manual',
                        dispatcher: dispatcher.dispatcher,
                    });
                    if (REDIRECT_STATUSES.includes(response.status)) {
                        // A redirect is neither success nor failure for the host's health;
                        // counting it as success would reset a count a peer just raised.
                        redirectCount += 1;
                        if (redirectCount > maxRedirects) {
                            throw new ScholarlySecurityError(`Too many redirects (maximum ${maxRedirects})`, 'policy');
                        }
                        const location = response.headers.get('location');
                        if (location === null) {
                            throw new ScholarlyHttpError(response.status, hostname);
                        }
                        await response.body?.cancel();
                        const nextUrl = new URL(location, currentUrl).href;
                        assertAllowedScholarlyUrl(nextUrl, publicOnly);
                        if (new URL(nextUrl).hostname !== hostname)
                            releaseProbe(hostname);
                        currentUrl = nextUrl;
                        // The next hop re-runs the lexical gate and its own resolution at
                        // the top of the loop; no spacing is owed between hops.
                        retryDelayMs = 0;
                    }
                    else if (response.ok) {
                        recordSuccess(hostname);
                        return await reader(response, maxBytes);
                    }
                    else {
                        const status = response.status;
                        // A 4xx answers one resource, not the host's health: a 404 means the
                        // registry does not hold that identifier, which the adapters
                        // normalize to "not found". Only 5xx and the throttling statuses
                        // penalize the circuit; otherwise a few bad DOIs would open it and
                        // hide every later answer behind a circuit error.
                        if (status >= 500 || status === 429 || status === 408)
                            recordFailure(hostname);
                        await response.body?.cancel();
                        const retryAfterHeader = Number(response.headers.get('retry-after'));
                        const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;
                        if ((status === 429 || status === 503) &&
                            attempt < maxRetries &&
                            (retryAfterSeconds ?? 0) <= 20) {
                            retryDelayMs = Math.max((retryAfterSeconds ?? 0) * 1_000, 1_000 * Math.pow(2, attempt));
                        }
                        else {
                            throw new ScholarlyHttpError(status, hostname, retryAfterSeconds);
                        }
                    }
                }
                catch (error) {
                    // Caller cancellation is final: no retry, no translation.
                    if (callerAborted(reqOptions.signal)) {
                        releaseProbe(hostname);
                        throw error;
                    }
                    // undici reports a connector lookup rejection as `fetch failed` with
                    // the real cause attached. Recover the owned deterministic refusal —
                    // whether it is the error itself or sits in the cause chain — and make
                    // it final: the answer is deterministic, it says nothing about the
                    // host's health, and the message is the actionable one. A transient
                    // `resolution-failed` is not a refusal, so it falls through to the
                    // retry and circuit-accounting path below.
                    const addressRejection = addressRefusalOf(error);
                    if (addressRejection !== undefined) {
                        releaseProbe(hostname);
                        throw addressRejection;
                    }
                    if (error instanceof ScholarlyHttpError) {
                        releaseProbe(hostname);
                        throw error;
                    }
                    if (error instanceof ScholarlyCircuitOpenError) {
                        releaseProbe(hostname);
                        throw error;
                    }
                    // An oversized body is a property of the resource, not of the host's
                    // health: retrying it re-downloads the same too-large body.
                    if (error instanceof ResponseTooLargeError) {
                        releaseProbe(hostname);
                        throw error;
                    }
                    // A local composition error — for example a dispatcher from another
                    // undici copy — is deterministic and says nothing about host health:
                    // fail once, do not retry, and leave the breaker alone.
                    const transportFailure = describeTransportFailure(error, hostname);
                    if (transportFailure !== undefined &&
                        NON_RETRYABLE_TRANSPORT_CODES.has(transportFailure.code)) {
                        releaseProbe(hostname);
                        throw transportFailure;
                    }
                    // A half-open admission is one probe, even when the request's normal
                    // retry budget is larger. A failed probe must reopen the circuit now;
                    // retrying it would collide with the probe fence and leave the host
                    // permanently stuck in HALF_OPEN.
                    if (halfOpenProbe) {
                        recordFailure(hostname);
                        throw transportFailure ?? error;
                    }
                    // A provider deadline is one failure of this host; a connection drop is
                    // another. Both are retried, and neither is reported as a caller abort.
                    if (isProviderTimeout(d.signal) || attempt >= maxRetries) {
                        recordFailure(hostname);
                        if (isProviderTimeout(d.signal)) {
                            throw new ScholarlyHttpError(504, hostname);
                        }
                        throw transportFailure ?? error;
                    }
                    retryDelayMs = 1_000 * Math.pow(2, attempt);
                }
                finally {
                    release();
                    // The pinned agent served exactly this attempt's connection; its
                    // response body (success, cancelled, or failed) is already settled by
                    // the time this finally runs, so the pool can close here.
                    await pinned?.close();
                    if (callerAborted(reqOptions.signal))
                        releaseProbe(hostname);
                }
                if (callerAborted(reqOptions.signal)) {
                    releaseProbe(hostname);
                    throw reqOptions.signal?.reason ?? new Error('Operation aborted');
                }
                if (retryDelayMs !== undefined && retryDelayMs > 0) {
                    try {
                        await sleep(retryDelayMs, reqOptions.signal);
                    }
                    catch (error) {
                        releaseProbe(hostname);
                        throw error;
                    }
                }
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
    };
    const bytes = (url, reqOptions) => requestWithReader(url, reqOptions, readBoundedBytes);
    const text = (url, reqOptions) => requestWithReader(url, reqOptions, readBoundedText);
    const json = async (url, reqOptions) => {
        const content = await text(url, {
            ...reqOptions,
            headers: { accept: 'application/json,*/*', ...reqOptions?.headers },
        });
        return JSON.parse(content);
    };
    return {
        bytes,
        text,
        json,
        circuitBreaker,
        pacer,
        dispose,
    };
}
//# sourceMappingURL=http.js.map