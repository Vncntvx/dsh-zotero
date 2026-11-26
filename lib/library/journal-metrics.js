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
import { createHash } from 'node:crypto';
import { credentialRef, normalizeApiKey } from '@deepseek-ai/dsh-credentials';
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { journalNameOf } from '../journal-metrics.js';
import { asRecord } from '../json.js';
import { awaitSharedWaiter, raceWithSignal } from '../race-signal.js';
import { readBoundedText, ResponseTooLargeError } from '../transport-bounds.js';
import { LruTtlCache } from '../ttl-cache.js';
import { JOURNAL_METRICS_CACHE_LIMIT, JournalMetricsCache, } from './journal-metrics-cache.js';
const ENDPOINT = 'https://www.easyscholar.cc/open/getPublicationRank';
const RANK_LABELS = ['oneRankText', 'twoRankText', 'threeRankText', 'fourRankText', 'fiveRankText'];
const MIN_INTERVAL_MS = 500;
const MAX_IN_FLIGHT = 4;
const MAX_PENDING = 128;
const MAX_BYTES = 128 * 1024;
const QUOTA_RECHECK_MS = 60_000;
const REFRESH_TIMEOUT_MS = 10 * 60_000;
const FRESH_MS = 6 * 60 * 60 * 1000;
const UNAVAILABLE = { status: 'unavailable' };
const DISABLED = { status: 'disabled' };
const CREDENTIAL = { status: 'credential' };
const QUOTA_EXCEEDED = { status: 'quotaExceeded' };
const INVALID_RESPONSE = { status: 'invalidResponse' };
const REQUEST_REJECTED = { status: 'requestRejected' };
function withPrevious(result, previous) {
    return previous && result.status !== 'ready' && result.status !== 'disabled'
        ? { ...previous, refreshFailure: result.status }
        : result;
}
function parseMetrics(input, secret) {
    const envelope = asRecord(input);
    if (typeof envelope?.code !== 'number')
        return INVALID_RESPONSE;
    if (envelope.code === 40006)
        return QUOTA_EXCEEDED;
    if (envelope.code === 40005)
        return CREDENTIAL;
    if (envelope.code === 40002 && typeof envelope.msg === 'string' && /key|密钥/i.test(envelope.msg))
        return CREDENTIAL;
    if (envelope.code !== 200)
        return REQUEST_REJECTED;
    const data = envelope.data === null ? {} : asRecord(envelope.data);
    if (data === undefined)
        return INVALID_RESPONSE;
    const officialRank = asRecord(data.officialRank);
    const all = asRecord(officialRank?.all);
    const select = asRecord(officialRank?.select);
    const customRank = asRecord(data.customRank);
    if ((data.officialRank != null &&
        (!officialRank ||
            (officialRank.all === undefined && officialRank.select === undefined) ||
            (officialRank.all != null && all === undefined) ||
            (officialRank.select != null && select === undefined))) ||
        (data.customRank != null &&
            (!Array.isArray(customRank?.rankInfo) || !Array.isArray(customRank.rank))))
        return INVALID_RESPONSE;
    const encoded = encodeURIComponent(secret);
    const formEncoded = new URLSearchParams([['', secret]]).toString().slice(1);
    const text = (value) => {
        if (typeof value !== 'string' && typeof value !== 'number')
            return undefined;
        const result = String(value).trim();
        return result && ![secret, encoded, formEncoded].some((key) => result.includes(key))
            ? result
            : undefined;
    };
    const official = Object.entries({ ...select, ...all }).flatMap(([field, raw]) => {
        const value = text(raw);
        return text(field) && value !== undefined ? [{ field, value }] : [];
    });
    const datasets = new Map();
    const rankInfo = Array.isArray(customRank?.rankInfo) ? customRank.rankInfo : [];
    for (const entry of rankInfo) {
        const dataset = asRecord(entry);
        if (dataset && typeof dataset.uuid === 'string')
            datasets.set(dataset.uuid, dataset);
    }
    const custom = new Map();
    const ranks = Array.isArray(customRank?.rank) ? customRank.rank : [];
    for (const entry of ranks) {
        if (typeof entry !== 'string')
            continue;
        const match = /^([A-Za-z0-9_-]+)&&&([1-5])$/.exec(entry);
        if (!match)
            continue;
        const id = match[1];
        const level = match[2];
        const dataset = datasets.get(id);
        const label = text(dataset?.abbName);
        const value = text(dataset?.[RANK_LABELS[Number(level) - 1]]);
        if (text(id) && label !== undefined && value !== undefined)
            custom.set(id, { id, label, value });
    }
    return { status: 'ready', fetchedAt: Date.now(), official, custom: [...custom.values()] };
}
/** A shared queue and cache for every panel caller of this host service. */
export class JournalMetrics {
    deps;
    reference;
    credentialDigest;
    generation = 0;
    disposed = false;
    cache = new LruTtlCache(JOURNAL_METRICS_CACHE_LIMIT, FRESH_MS);
    store;
    refreshes = new Map();
    flights = new Map();
    queued = new Set();
    running = new Set();
    timer;
    nextStart = 0;
    cooldownUntil = 0;
    quotaUntil = 0;
    constructor(deps) {
        this.deps = deps;
        if (deps.cacheDirectory)
            this.store = new JournalMetricsCache(deps.cacheDirectory);
    }
    sync() {
        const current = this.disposed ? undefined : this.deps.reference();
        if (current !== this.reference) {
            this.reference = current;
            this.invalidate();
        }
        return current;
    }
    credentialChanged(reference) {
        if (this.sync() === reference)
            this.invalidate();
    }
    async dispose() {
        this.disposed = true;
        this.invalidate();
        await Promise.allSettled([
            ...this.running,
            ...Array.from(this.refreshes.values(), ({ done }) => done),
        ]);
    }
    invalidate() {
        const previousGeneration = this.generation++;
        this.credentialDigest = undefined;
        this.cache.clear();
        this.refreshes.get(previousGeneration)?.controller.abort();
        this.quotaUntil = 0;
        this.stopFlights(DISABLED);
    }
    stopFlights(result) {
        clearTimeout(this.timer);
        this.timer = undefined;
        for (const flight of this.flights.values()) {
            flight.controller.abort();
            flight.finish(withPrevious(result, flight.previous));
        }
        this.flights.clear();
        this.queued.clear();
    }
    async identity(signal) {
        signal.throwIfAborted();
        const reference = this.sync();
        if (reference === undefined)
            return DISABLED;
        const generation = this.generation;
        let raw;
        try {
            raw = await raceWithSignal(this.deps.credential(credentialRef(reference)), signal);
        }
        catch {
            signal.throwIfAborted();
            return CREDENTIAL;
        }
        signal.throwIfAborted();
        if (this.sync() !== reference || generation !== this.generation)
            return DISABLED;
        const secret = normalizeApiKey(raw ?? '');
        if (!secret.ok)
            return CREDENTIAL;
        const digest = createHash('sha256').update(secret.value).digest('hex');
        if (this.credentialDigest !== undefined && this.credentialDigest !== digest)
            this.invalidate();
        this.credentialDigest = digest;
        return { secret: secret.value, digest, generation: this.generation };
    }
    async refresh(signal) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const identity = await this.identity(signal);
            if ('status' in identity)
                return identity;
            signal.throwIfAborted();
            if (identity.generation !== this.generation)
                return DISABLED;
            if (this.refreshes.has(identity.generation))
                return { status: 'running' };
            const controller = new AbortController();
            const timeout = __addDisposableResource(env_1, deadline(AbortSignal.any([signal, controller.signal]), REFRESH_TIMEOUT_MS, 'zotero/journal-metrics-refresh-timeout'), false);
            const done = this.refreshSaved(identity, timeout.signal);
            this.refreshes.set(identity.generation, { controller, done });
            try {
                const result = await done;
                signal.throwIfAborted();
                return result;
            }
            catch (error) {
                if (identity.generation !== this.generation)
                    return DISABLED;
                throw error;
            }
            finally {
                this.refreshes.delete(identity.generation);
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
    async refreshSaved(identity, signal) {
        const journals = (await this.store?.journals(identity.digest, signal)) ?? [];
        let refreshed = 0;
        let failure;
        let index = 0;
        const stop = new AbortController();
        const lookupSignal = AbortSignal.any([signal, stop.signal]);
        const worker = async () => {
            while (!lookupSignal.aborted) {
                const journal = journals[index++];
                if (journal === undefined)
                    return;
                if (performance.now() < this.cooldownUntil) {
                    failure = 'rateLimited';
                    stop.abort();
                    return;
                }
                const result = await this.lookupJournal(journal, false, identity, lookupSignal, true);
                if (result.status === 'disabled') {
                    stop.abort();
                    return;
                }
                const issue = result.status === 'ready' ? result.refreshFailure : result.status;
                if (issue === undefined)
                    refreshed += 1;
                else if (issue === 'credential' || issue === 'quotaExceeded' || issue === 'rateLimited') {
                    failure = issue;
                    stop.abort();
                }
                else
                    failure ??= issue;
            }
        };
        await Promise.allSettled([worker(), worker()]).then((results) => {
            for (const result of results) {
                if (result.status === 'rejected' && !lookupSignal.aborted)
                    throw result.reason;
            }
        });
        if (identity.generation !== this.generation)
            return DISABLED;
        if (signal.aborted)
            failure ??= 'unavailable';
        return {
            status: 'finished',
            total: journals.length,
            refreshed,
            ...(failure ? { failure } : {}),
        };
    }
    async lookup(request, signal = new AbortController().signal) {
        signal.throwIfAborted();
        const publicationName = journalNameOf(request.publicationName);
        if (publicationName === undefined)
            return UNAVAILABLE;
        const identity = await this.identity(signal);
        if ('status' in identity)
            return identity;
        return await this.lookupJournal(publicationName, request.priority === 'detail', identity, signal);
    }
    async lookupJournal(publicationName, detail, identity, signal, force = false) {
        signal.throwIfAborted();
        let cached = this.cache.get(publicationName);
        if (!cached && this.store) {
            const saved = await raceWithSignal(this.store.read(identity.digest, publicationName), signal);
            cached = this.cache.get(publicationName) ?? saved?.result;
            this.sync();
            if (identity.generation !== this.generation)
                return DISABLED;
            if (cached && Date.now() - cached.fetchedAt < FRESH_MS)
                this.cache.set(publicationName, cached);
            if (saved && saved.publicationName === undefined) {
                await this.save(identity, publicationName, saved.result);
            }
        }
        signal.throwIfAborted();
        this.sync();
        if (identity.generation !== this.generation)
            return DISABLED;
        if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS)
            return cached;
        if (performance.now() < this.quotaUntil)
            return withPrevious(QUOTA_EXCEEDED, cached);
        let flight = this.flights.get(publicationName);
        if (!flight) {
            if (this.flights.size >= MAX_PENDING)
                return withPrevious(UNAVAILABLE, cached);
            let finish;
            const done = new Promise((resolve) => {
                finish = resolve;
            });
            flight = {
                publicationName,
                identity,
                previous: cached,
                controller: new AbortController(),
                done,
                finish,
                waiters: 0,
                detailWaiters: 0,
            };
            this.flights.set(publicationName, flight);
            this.queued.add(flight);
        }
        const task = flight;
        return await awaitSharedWaiter(task.done, signal, {
            onJoin: () => {
                task.waiters += 1;
                if (detail)
                    task.detailWaiters += 1;
                this.pump();
            },
            onLeave: (aborted) => {
                task.waiters -= 1;
                if (detail)
                    task.detailWaiters -= 1;
                if (aborted && task.waiters === 0 && this.flights.get(publicationName) === task) {
                    this.flights.delete(publicationName);
                    this.queued.delete(task);
                    task.controller.abort();
                    task.finish(DISABLED);
                    this.pump();
                }
            },
        });
    }
    pump() {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.queued.size || this.running.size >= MAX_IN_FLIGHT || this.sync() === undefined)
            return;
        const now = performance.now();
        const delay = Math.max(this.nextStart, this.cooldownUntil) - now;
        if (delay > 0) {
            this.timer = setTimeout(() => this.pump(), Math.min(Math.ceil(delay), 2_147_483_647));
            return;
        }
        const queued = [...this.queued];
        const flight = queued.find((entry) => entry.detailWaiters > 0) ?? queued[0];
        if (!flight)
            return;
        this.queued.delete(flight);
        this.nextStart = now + MIN_INTERVAL_MS;
        const running = this.run(flight).finally(() => {
            this.running.delete(running);
            this.pump();
        });
        this.running.add(running);
        this.pump();
    }
    async run(flight) {
        const result = await this.fetchMetrics(flight);
        if (this.flights.get(flight.publicationName) !== flight)
            return;
        if (result.status === 'quotaExceeded') {
            this.quotaUntil = performance.now() + QUOTA_RECHECK_MS;
            this.stopFlights(result);
            return;
        }
        this.flights.delete(flight.publicationName);
        if (result.status === 'ready')
            this.cache.set(flight.publicationName, result);
        flight.finish(withPrevious(result, flight.previous));
        if (result.status === 'ready') {
            await this.save(flight.identity, flight.publicationName, result);
        }
    }
    async save(identity, journal, result) {
        await this.store?.write(identity.digest, journal, result).catch(() => {
            this.deps.onCacheWriteError?.();
        });
    }
    async fetchMetrics(flight) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const timeout = __addDisposableResource(env_2, deadline(flight.controller.signal, 10_000, 'zotero/journal-metrics-timeout'), false);
            try {
                const url = new URL(ENDPOINT);
                url.searchParams.set('publicationName', flight.publicationName);
                url.searchParams.set('secretKey', flight.identity.secret);
                const response = await this.deps.fetch(url, timeout.signal);
                flight.controller.signal.throwIfAborted();
                if (response.status === 429) {
                    const header = response.headers.get('retry-after')?.trim();
                    const retry = !header
                        ? NaN
                        : /^\d+$/.test(header)
                            ? Number(header) * 1000
                            : Date.parse(header) - Date.now();
                    this.cooldownUntil = Math.max(this.cooldownUntil, performance.now() + (Number.isFinite(retry) ? Math.max(0, retry) : 30_000));
                    this.pump();
                }
                if (!response.ok) {
                    await response.body?.cancel();
                    if (response.status === 429)
                        return { status: 'rateLimited' };
                    if (response.status === 401 || response.status === 403)
                        return { status: 'credential' };
                    if (response.status >= 500)
                        return { status: 'serviceUnavailable' };
                    return response.status >= 400 ? REQUEST_REJECTED : INVALID_RESPONSE;
                }
                return parseMetrics(JSON.parse(await readBoundedText(response, MAX_BYTES)), flight.identity.secret);
            }
            catch (error) {
                // Provider errors can echo the credential-bearing URL. Send only a status.
                if (timeoutOf(timeout.signal))
                    return { status: 'timedOut' };
                if (error instanceof SyntaxError || error instanceof ResponseTooLargeError)
                    return INVALID_RESPONSE;
                return { status: 'connectionFailed' };
            }
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
}
//# sourceMappingURL=journal-metrics.js.map