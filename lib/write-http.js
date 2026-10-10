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
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { deadline } from '@deepseek-ai/dsh-timeout';
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
import { acquireSlot, ConcurrencyGate } from './concurrency.js';
import { ZOTERO_API_VERSION_HEADER, ZOTERO_AUTHORIZE_PATH, ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_LOCAL_API_VERSION, ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS, ZOTERO_RETRY_AFTER_HEADER, ZOTERO_SERVER_ID_HEADER, ZOTERO_WRITE_OBJECT_BATCH, } from './constants.js';
import { API_DISABLED_MESSAGE, SERVER_MISMATCH_MESSAGE, WRITE_AUTH_DENIED_MESSAGE, WRITE_AUTH_SHAPE_MESSAGE, WRITE_BATCH_REFUSED_MESSAGE, WRITE_CONFLICT_MESSAGE, WRITE_IDENTITY_MISSING_MESSAGE, WRITE_LIBRARY_VERSION_MISSING_MESSAGE, WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE, WRITE_PRECONDITION_REFUSED_MESSAGE, WRITE_UNAUTHORIZED_MESSAGE, ZOTERO_API_DISABLED, ZOTERO_INVALID_ARGUMENT, ZOTERO_SERVER_MISMATCH, ZOTERO_TIMEOUT, ZOTERO_UNEXPECTED, ZOTERO_WRITE_CONFLICT, ZOTERO_WRITE_RATE_LIMITED, ZOTERO_WRITE_UNAUTHORIZED, ZoteroError, writeBatchShapeMessage, writeRateLimitedMessage, writeTagDeleteLimitMessage, } from './errors.js';
import { SERVER_ID_MISMATCH_STATEMENT, UNEXPECTED_REQUEST_MESSAGE, UNPARSEABLE_RESPONSE_MESSAGE, readBody, readFailureStatement, sharedHttpStatusError, translateFetchError, } from './http-client.js';
import { asRecord, asString, parseNonNegativeSafeInteger } from './json.js';
/**
 * A write request that reached the response/commit boundary but whose
 * outcome could not be proven. Callers that create non-idempotent objects
 * must surface this as a non-retryable, commit-unknown result rather than
 * inviting a second write.
 */
export class ZoteroWriteCommitUnknownError extends ZoteroError {
    constructor(message, code, options) {
        super(message, code, options);
        this.name = 'ZoteroWriteCommitUnknownError';
    }
}
/** Preserve a typed error's code/message while marking its commit state unknown. */
function asCommitUnknown(error) {
    const code = (error instanceof ZoteroError ? error.code : ZOTERO_UNEXPECTED);
    const message = error instanceof Error ? error.message : UNEXPECTED_REQUEST_MESSAGE;
    return new ZoteroWriteCommitUnknownError(message, code, { cause: error });
}
/** Statuses whose response proves the write was refused before object commit. */
const PRE_COMMIT_WRITE_STATUSES = new Set([
    400, 401, 403, 404, 405, 409, 410, 412, 413, 415, 422, 426, 428, 429, 501,
]);
/**
 * 3xx arrives as a response, because the request is sent with
 * `redirect: 'manual'` and never followed, so like the statuses above it
 * proves the write was refused before any object commit.
 */
function isPreCommitWriteStatus(status) {
    return (status >= 300 && status < 400) || PRE_COMMIT_WRITE_STATUSES.has(status);
}
/** The Local API endpoint that issues write keys; local-only, no web API analog. */
const AUTHORIZE_PATH = ZOTERO_AUTHORIZE_PATH;
/**
 * Zotero documents 5–32 characters for `Zotero-Write-Token`; a UUID without
 * its dashes is exactly 32 and unique per attempt, which is the contract the
 * token implements (a retried identical batch must reach Zotero as a new
 * attempt, never as a replay).
 */
function nextWriteToken() {
    return crypto.randomUUID().replaceAll('-', '');
}
/** Parse the library version off a write response, or undefined when absent or malformed. */
function libraryVersionOf(headers) {
    return parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER));
}
/** Require the library version off a write response; absence is protocol drift. */
function requireLibraryVersion(headers) {
    const libraryVersion = libraryVersionOf(headers);
    if (libraryVersion === undefined) {
        throw new ZoteroError(WRITE_LIBRARY_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED);
    }
    return libraryVersion;
}
/**
 * The write transport of the Zotero Local API. One request in flight, no
 * retries, no identity refresh. The write path has exactly one legitimate
 * replay (re-authorize after 401, then send the same batch again) and that
 * replay belongs to the domain, not to transport heuristics.
 */
export class ZoteroWriteHttpClient {
    options;
    baseUrlWithSlash;
    gate;
    constructor(options) {
        this.options = options;
        this.baseUrlWithSlash = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
        this.gate = new ConcurrencyGate(ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS);
    }
    /**
     * POST a JSON array of write objects. Zotero answers 200 with the
     * per-object buckets and the library version it advanced to; a non-atomic
     * batch reports successes and failures side by side.
     */
    async batch(path, entries, opts) {
        const writeToken = nextWriteToken();
        const { body, headers } = await this.send(path, 'POST', opts, { 'Zotero-Write-Token': writeToken }, JSON.stringify(entries), undefined, true);
        return this.parseBatchWrite(body, requireLibraryVersion(headers));
    }
    /**
     * PATCH a single object (merge semantics per the web API). Zotero answers
     * 204 with the library version only, and the written object's version is
     * that same library version, so no follow-up GET is needed.
     */
    async patch(path, body, opts) {
        const { headers } = await this.send(path, 'PATCH', opts, { 'If-Unmodified-Since-Version': String(opts.ifUnmodifiedSinceVersion) }, JSON.stringify(body), undefined, true);
        return { libraryVersion: requireLibraryVersion(headers) };
    }
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
    async delete(path, opts) {
        const extraHeaders = opts.ifUnmodifiedSinceVersion === undefined
            ? {}
            : { 'If-Unmodified-Since-Version': String(opts.ifUnmodifiedSinceVersion) };
        const { headers } = await this.send(path, 'DELETE', opts, extraHeaders, undefined, undefined, false, opts.tagDeleteLimit === true);
        return { libraryVersion: requireLibraryVersion(headers) };
    }
    /**
     * Request a local write key. Zotero shows its user a dialog: Allow (the
     * key works once, then is consumed), Always Allow (persistent), or Deny.
     * A denial and every other refusal arrive as `ZoteroError`s with
     * write-specific codes and messages; only a grant returns.
     */
    async authorize(appName, opts) {
        const { body } = await this.send(AUTHORIZE_PATH, 'POST', { signal: opts.signal, serverId: opts.serverId, apiKey: '' }, {}, JSON.stringify({ appName }), 
        // The dialog waits for a human: the data deadline must not cut it off.
        this.options.authorizeDeadlineMs);
        let json;
        try {
            json = JSON.parse(body);
        }
        catch (error) {
            throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED, { cause: error });
        }
        const record = asRecord(json);
        const key = record === undefined ? undefined : asString(record.key);
        if (key === undefined || key === '') {
            throw new ZoteroError(WRITE_AUTH_SHAPE_MESSAGE, ZOTERO_UNEXPECTED);
        }
        return { key, remember: record?.remember === true };
    }
    /**
     * Send one write request. The gate slot is held across connection, body
     * and streamed response read, exactly like the read transport; the
     * deadline starts after the slot so queue time is never Zotero latency.
     */
    async send(path, method, opts, extraHeaders, body, deadlineMs = this.options.timeoutMs, commitSensitive = false, tagDeleteLimit = false) {
        if (opts.serverId === '') {
            throw new ZoteroError(WRITE_IDENTITY_MISSING_MESSAGE, ZOTERO_UNEXPECTED);
        }
        const url = new URL(path, this.baseUrlWithSlash);
        const release = await this.takeSlot(opts.signal);
        try {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const d = __addDisposableResource(env_1, deadline(opts.signal, deadlineMs, ZOTERO_TIMEOUT), false);
                const headers = {
                    [ZOTERO_API_VERSION_HEADER]: ZOTERO_LOCAL_API_VERSION,
                    [ZOTERO_SERVER_ID_HEADER]: opts.serverId,
                    ...extraHeaders,
                };
                if (opts.apiKey !== '')
                    headers['Zotero-API-Key'] = opts.apiKey;
                if (method !== 'DELETE')
                    headers['Content-Type'] = 'application/json';
                // If cancellation or the provider deadline won before dispatch, no write
                // can have committed and the caller must see the ordinary cancellation or
                // timeout rather than a false commit-unknown outcome.
                if (opts.signal?.aborted || d.signal.aborted) {
                    translateFetchError(new Error(), d.signal, opts.signal, deadlineMs);
                }
                let response;
                try {
                    response = await fetch(url, {
                        method,
                        headers,
                        ...(body === undefined ? {} : { body }),
                        redirect: 'manual',
                        signal: d.signal,
                    });
                }
                catch (error) {
                    // Translate first so timeout/abort keep their typed codes; a
                    // commit-sensitive write then marks that typed failure as
                    // commit-unknown without collapsing the code to UNEXPECTED.
                    try {
                        translateFetchError(error, d.signal, opts.signal, deadlineMs);
                    }
                    catch (translated) {
                        if (opts.signal?.aborted ||
                            (translated instanceof HarnessError && translated.code === TOOL_ABORTED)) {
                            throw translated;
                        }
                        if (commitSensitive)
                            throw asCommitUnknown(translated);
                        throw translated;
                    }
                }
                const observedServerId = response.headers.get(ZOTERO_SERVER_ID_HEADER);
                // A response from another instance is never translated as this write's
                // refusal. This check also covers error responses, whose bodies may use
                // different wording than the read transport's identity statement.
                if (observedServerId !== null && observedServerId !== opts.serverId) {
                    void response.body?.cancel();
                    throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH);
                }
                if (!response.ok) {
                    // Zotero states its refusals in the body for the statuses the write
                    // path distinguishes (the 403 deny grant, the 412 identity-vs-version
                    // fork, and the 413 tag-delete limit); read those under the bound,
                    // everything else by status.
                    let detail = '';
                    try {
                        const needsBody = response.status === 401 ||
                            response.status === 403 ||
                            response.status === 412 ||
                            (method === 'DELETE' && response.status === 413);
                        if (needsBody) {
                            detail = await readFailureStatement(response, this.options.maxResponseBytes, d.signal, opts.signal, deadlineMs);
                        }
                        else {
                            void response.body?.cancel();
                        }
                        this.translateWriteStatus(response, detail, tagDeleteLimit);
                    }
                    catch (error) {
                        if (commitSensitive && !isPreCommitWriteStatus(response.status)) {
                            throw asCommitUnknown(error);
                        }
                        throw error;
                    }
                }
                if (observedServerId === null) {
                    const error = new ZoteroError(WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE, ZOTERO_UNEXPECTED);
                    throw commitSensitive ? asCommitUnknown(error) : error;
                }
                let responseBody;
                try {
                    responseBody = await readBody(response, this.options.maxResponseBytes);
                }
                catch (error) {
                    try {
                        translateFetchError(error, d.signal, opts.signal, deadlineMs);
                    }
                    catch (translated) {
                        throw commitSensitive ? asCommitUnknown(translated) : translated;
                    }
                }
                return { body: responseBody, headers: response.headers };
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
        finally {
            release();
        }
    }
    /**
     * Take the single write slot; a queued abort reports as the caller's
     * cancellation.
     */
    takeSlot(signal) {
        return acquireSlot(this.gate, signal);
    }
    /**
     * Translate a non-2xx write response. The write path maps Zotero's own
     * statuses onto the plugin's write vocabulary: 401/403/429/412 carry
     * write-specific codes, a 413 on a delete the domain marked as a name-list
     * payload carries the tag limit, and the two statuses that cannot happen
     * if the plugin is correct (428, batch 413) fail loud as protocol drift
     * instead of being disguised as domain errors.
     */
    translateWriteStatus(response, detail, tagDeleteLimit) {
        const status = response.status;
        switch (status) {
            case 401:
                throw new ZoteroError(WRITE_UNAUTHORIZED_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED);
            case 403: {
                // The status carries two different facts: the local API being
                // disabled in Zotero's preferences (plain text) and the authorize
                // dialog being declined (a JSON grant refusal). The body tells them
                // apart; unparseable detail means the API-disabled statement.
                let json;
                try {
                    json = JSON.parse(detail);
                }
                catch {
                    json = undefined;
                }
                if (asRecord(json)?.denied === true) {
                    throw new ZoteroError(WRITE_AUTH_DENIED_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED);
                }
                throw new ZoteroError(API_DISABLED_MESSAGE, ZOTERO_API_DISABLED);
            }
            case 412:
                if (detail.includes(SERVER_ID_MISMATCH_STATEMENT)) {
                    throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH);
                }
                throw new ZoteroError(WRITE_CONFLICT_MESSAGE, ZOTERO_WRITE_CONFLICT);
            case 428:
                throw new ZoteroError(WRITE_PRECONDITION_REFUSED_MESSAGE, ZOTERO_UNEXPECTED);
            case 429: {
                const raw = response.headers.get(ZOTERO_RETRY_AFTER_HEADER);
                const waitSeconds = raw === null ? undefined : Number(raw);
                throw new ZoteroError(writeRateLimitedMessage(waitSeconds !== undefined && Number.isFinite(waitSeconds) ? waitSeconds : undefined), ZOTERO_WRITE_RATE_LIMITED);
            }
            case 413:
                if (tagDeleteLimit) {
                    throw new ZoteroError(writeTagDeleteLimitMessage(ZOTERO_WRITE_OBJECT_BATCH, detail), ZOTERO_INVALID_ARGUMENT);
                }
                throw new ZoteroError(WRITE_BATCH_REFUSED_MESSAGE, ZOTERO_UNEXPECTED);
            default:
                throw sharedHttpStatusError(status);
        }
    }
    /**
     * Parse the batch outcome buckets. The documented write shape names four
     * buckets and Zotero answers with all of them; a bucket that is present
     * but malformed is protocol drift and fails loud rather than being
     * silently reshaped.
     */
    parseBatchWrite(body, libraryVersion) {
        let json;
        try {
            json = JSON.parse(body);
        }
        catch (error) {
            throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED, { cause: error });
        }
        const record = asRecord(json);
        if (record === undefined) {
            throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED);
        }
        const failed = {};
        for (const [index, entry] of Object.entries(bucketOf(record, 'failed'))) {
            const shape = asRecord(entry);
            const key = shape === undefined ? undefined : asString(shape.key);
            const message = shape === undefined ? undefined : asString(shape.message);
            const code = shape === undefined ? undefined : shape.code;
            if (key === undefined ||
                message === undefined ||
                typeof code !== 'number' ||
                !Number.isFinite(code)) {
                throw new ZoteroError(writeBatchShapeMessage('failed'), ZOTERO_UNEXPECTED);
            }
            failed[index] = { key, code, message };
        }
        const successful = {};
        for (const [index, entry] of Object.entries(bucketOf(record, 'successful'))) {
            const shape = asRecord(entry);
            if (shape === undefined) {
                throw new ZoteroError(writeBatchShapeMessage('successful'), ZOTERO_UNEXPECTED);
            }
            successful[index] = shape;
        }
        return {
            successful,
            success: stringBucketOf(record, 'success'),
            unchanged: stringBucketOf(record, 'unchanged'),
            failed,
            libraryVersion,
        };
    }
}
/** Read one bucket of the batch response, tolerating absence, refusing malformed shapes. */
function bucketOf(record, name) {
    const value = record[name];
    if (value === undefined)
        return {};
    const bucket = asRecord(value);
    if (bucket === undefined) {
        throw new ZoteroError(writeBatchShapeMessage(name), ZOTERO_UNEXPECTED);
    }
    return bucket;
}
/** Read a key→string bucket (success/unchanged), tolerating absence, refusing malformed shapes. */
function stringBucketOf(record, name) {
    const bucket = {};
    for (const [index, entry] of Object.entries(bucketOf(record, name))) {
        const key = asString(entry);
        if (key === undefined) {
            throw new ZoteroError(writeBatchShapeMessage(name), ZOTERO_UNEXPECTED);
        }
        bucket[index] = key;
    }
    return bucket;
}
//# sourceMappingURL=write-http.js.map