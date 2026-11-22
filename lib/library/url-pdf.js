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
/** User-initiated, bounded PDF downloads. Never constructs scholarly services. */
import { PublicAddressError, isPublicUrl } from '../transport/public-url.js';
import { deadline } from '@deepseek-ai/dsh-timeout';
import { closePinnedQuietly, resolvePublicAddresses, } from '../transport/network.js';
import { readBoundedBytes, ResponseTooLargeError } from '../transport-bounds.js';
import { egressRouteFor } from '../transport/connections.js';
import { ZoteroError, ZOTERO_URL_PDF_DISABLED, ZOTERO_URL_PDF_BUSY, ZOTERO_URL_PDF_NOT_URL, ZOTERO_URL_PDF_REDIRECT, ZOTERO_URL_PDF_HTTP, ZOTERO_URL_PDF_NOT_PDF, ZOTERO_URL_PDF_TIMEOUT, ZOTERO_URL_PDF_FORBIDDEN_TARGET, ZOTERO_URL_PDF_TOO_LARGE, ZOTERO_URL_PDF_NETWORK, } from '../errors.js';
export const URL_PDF_MAX_BYTES = 32 * 1024 * 1024;
const URL_PDF_TIMEOUT_MS = 60_000;
const URL_PDF_MAX_REDIRECTS = 5;
/** The deadline's TimeoutReason code for a panel PDF download. */
const URL_PDF_TIMEOUT_REASON = 'zotero/url-pdf-download-timeout';
export class UrlPdfReader {
    deps;
    running = new Set();
    constructor(deps) {
        this.deps = deps;
    }
    revoke() {
        if (this.deps.allowed())
            return;
        for (const controller of this.running)
            controller.abort(new ZoteroError('URL PDF reading permission was revoked.', ZOTERO_URL_PDF_DISABLED));
    }
    /**
     * Stop every in-flight download because the capability itself is going
     * away (the plugin unmounted). The read's own catch treats an aborted
     * controller as the caller's verdict and rethrows this reason, so teardown
     * does not wait out a download's remaining deadline.
     */
    dispose() {
        for (const controller of this.running)
            controller.abort(new DOMException('URL PDF reading was disposed', 'AbortError'));
    }
    async read(attachment, signal) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            if (!this.deps.allowed())
                throw new ZoteroError('URL PDF reading is disabled in Literature panel settings.', ZOTERO_URL_PDF_DISABLED);
            if (this.running.size >= 2)
                throw new ZoteroError('Two PDF downloads are already running. Try again after one finishes.', ZOTERO_URL_PDF_BUSY);
            const controller = new AbortController();
            this.running.add(controller);
            // The download deadline fused with the caller's cancellation and the
            // reader's release; its TimeoutReason is what the catch below maps to
            // the panel's TIMEOUT refusal.
            const timeoutScope = __addDisposableResource(env_1, deadline(signal, URL_PDF_TIMEOUT_MS, URL_PDF_TIMEOUT_REASON), false);
            const timeout = timeoutScope.signal;
            const combined = AbortSignal.any([timeout, controller.signal]);
            try {
                if (attachment.kind !== 'url' || !attachment.url)
                    throw new ZoteroError('This attachment is not a URL PDF.', ZOTERO_URL_PDF_NOT_URL);
                let url = new URL(attachment.url);
                for (let hop = 0;; hop++) {
                    combined.throwIfAborted();
                    if (!this.deps.allowed())
                        throw new ZoteroError('URL PDF reading is disabled.', ZOTERO_URL_PDF_DISABLED);
                    if (url.username || url.password || !isPublicUrl(url.href))
                        throw new PublicAddressError('PDF address is not a permitted public HTTP(S) address.', 'policy');
                    // The harness proxy policy decides the transport per hop: proxied, the
                    // route's shared dispatcher performs the DNS and is never closed; direct,
                    // the pinned closed set keeps the check-then-connect guarantee.
                    const route = egressRouteFor(url);
                    const addresses = route.proxied
                        ? undefined
                        : await resolvePublicAddresses(url.hostname, this.deps.resolver, {
                            signal: combined,
                        });
                    const connection = route.proxied
                        ? undefined
                        : this.deps.dispatcher(addresses);
                    try {
                        const response = await this.deps.fetch(url.href, {
                            method: 'GET',
                            redirect: 'manual',
                            signal: combined,
                            credentials: 'omit',
                            referrerPolicy: 'no-referrer',
                            headers: { accept: 'application/pdf, application/octet-stream;q=0.8' },
                            dispatcher: route.proxied ? route.dispatcher : connection.dispatcher,
                        });
                        if ([301, 302, 303, 307, 308].includes(response.status)) {
                            const location = response.headers.get('location');
                            await response.body?.cancel();
                            if (!location || hop === URL_PDF_MAX_REDIRECTS)
                                throw new ZoteroError('PDF redirect limit exceeded or Location is missing.', ZOTERO_URL_PDF_REDIRECT);
                            const next = new URL(location, url);
                            if (url.protocol === 'https:' && next.protocol !== 'https:')
                                throw new PublicAddressError('HTTPS PDF redirects may not downgrade to HTTP.', 'policy');
                            url = next;
                            continue;
                        }
                        if (!response.ok) {
                            await response.body?.cancel();
                            throw new ZoteroError(`PDF server returned HTTP ${response.status}.`, ZOTERO_URL_PDF_HTTP);
                        }
                        const length = Number(response.headers.get('content-length'));
                        if (length > URL_PDF_MAX_BYTES) {
                            await response.body?.cancel();
                            throw new ResponseTooLargeError(URL_PDF_MAX_BYTES);
                        }
                        const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
                        if (type && type !== 'application/pdf' && type !== 'application/octet-stream') {
                            await response.body?.cancel();
                            throw new ZoteroError('The attachment website returned a non-PDF response.', ZOTERO_URL_PDF_NOT_PDF);
                        }
                        const bytes = await readBoundedBytes(response, URL_PDF_MAX_BYTES);
                        combined.throwIfAborted();
                        const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, 1024));
                        if (!/^\s*%PDF-\d\.\d(?:\s|$)/.test(prefix))
                            throw new ZoteroError('The response does not contain a PDF file signature.', ZOTERO_URL_PDF_NOT_PDF);
                        return {
                            ref: attachment.ref,
                            title: attachment.title,
                            contentType: 'application/pdf',
                            data: new Uint8Array(bytes),
                        };
                    }
                    finally {
                        // The proxy route's dispatcher is process-wide and shared; only the
                        // pinned per-attempt agent is closed here.
                        await closePinnedQuietly(connection);
                    }
                }
            }
            catch (error) {
                if (signal.aborted || controller.signal.aborted)
                    throw combined.reason;
                if (timeout.aborted)
                    throw new ZoteroError('The PDF download exceeded 60 seconds.', ZOTERO_URL_PDF_TIMEOUT);
                if (error instanceof PublicAddressError) {
                    if (error.reason === 'resolution-failed')
                        throw new ZoteroError('The PDF hostname could not be resolved. Check the local DNS proxy and retry explicitly.', ZOTERO_URL_PDF_NETWORK);
                    throw new ZoteroError(error.message, ZOTERO_URL_PDF_FORBIDDEN_TARGET);
                }
                if (error instanceof ResponseTooLargeError)
                    throw new ZoteroError('The PDF exceeds the 32 MiB reading limit.', ZOTERO_URL_PDF_TOO_LARGE);
                if (error instanceof ZoteroError)
                    throw error;
                // Fetch errors can contain a full signed URL: never surface their raw text.
                throw new ZoteroError('The PDF download failed. Check the source website and retry explicitly.', ZOTERO_URL_PDF_NETWORK);
            }
            finally {
                this.running.delete(controller);
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
}
//# sourceMappingURL=url-pdf.js.map