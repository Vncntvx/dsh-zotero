/**
 * Bounded cross-request cache of validated embedding vectors.
 *
 * One cache lives per loaded model generation. A key names the physical model,
 * its revision and per-file digests, the inference contract, the `query` or
 * `document` side, and the exact SHA-256 of the text — so a query prefix and a
 * document prefix can never share a value, and a model switch misses every
 * entry. Concurrent misses for one key coalesce: the key is claimed
 * synchronously, so a second caller waits on the same run instead of starting
 * another one, and a failed or cancelled run is never cached.
 *
 * Misses are embedded in batches rather than one text per run. Each run carries
 * the per-text fixed cost of the encoder, so a full-text retrieve (150–200
 * distinct chunks) otherwise paid that cost 150–200 times instead of ~20. A
 * batch is aborted only when every caller waiting on it has gone away: one
 * caller's cancellation never aborts the others, and a batch abandoned by all
 * of them is dropped rather than cached.
 *
 * Capacity is bounded both by item count (16,384) and by a 64 MiB byte budget
 * over vectors and keys. Oversized single vectors are not cached. Values stay
 * private: a stored buffer is copied on write and on read, so a caller can
 * never mutate a cached vector. Retiring a generation aborts the runs still in
 * flight and refuses to let a straggler repopulate the cache.
 * @module dsh-zotero/enrichment/semantic/vector-cache
 */
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js';
import { EMBED_BATCH_SIZE } from './batching.js';
import { awaitSharedWaiter } from '../../waiter-flight.js';
export const VECTOR_CACHE_MAX_ITEMS = 16_384;
export const VECTOR_CACHE_MAX_BYTES = 64 * 1024 * 1024;
function digestOf(value) {
    return createHash('sha256').update(value).digest('hex');
}
/** A stable key over the model identity, inference contract, side and text. */
export function vectorCacheKeyOf(identity, side, text) {
    const contract = [
        identity.key,
        identity.physicalKey,
        identity.revision,
        identity.scoringVersion,
        String(identity.dimension),
        identity.pooling,
        String(identity.normalize),
        identity.queryPrefix,
        identity.documentPrefix,
        ...Object.entries(identity.fileDigests)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, digest]) => `${path}:${digest}`),
    ].join('|');
    return `${digestOf(contract)}|${side}|${digestOf(text)}`;
}
function byteSizeOf(key, vector) {
    return vector.byteLength + key.length * 2;
}
/** A Map-shaped view over the real LRU; writes stop once the generation retires. */
class LruMapView {
    lru;
    retired;
    constructor(lru, retired) {
        this.lru = lru;
        this.retired = retired;
    }
    get(key) {
        const hit = this.lru.get(key);
        return hit === undefined ? undefined : new Float32Array(hit);
    }
    set(key, value) {
        // A run that was already in flight when `dispose` cleared the entries must
        // not put them back: the generation is gone, and the caller that reads
        // through it has already been refused.
        if (this.retired())
            return this;
        const size = byteSizeOf(key, value);
        if (size > VECTOR_CACHE_MAX_BYTES)
            return this;
        this.lru.set(key, new Float32Array(value), { size });
        return this;
    }
}
function createFlight() {
    let resolve = () => undefined;
    let reject = () => undefined;
    const done = new Promise((accept, refuse) => {
        resolve = accept;
        reject = refuse;
    });
    // The rejection is observed by every awaiting caller; a flight whose callers
    // all walked away must not surface as an unhandled rejection.
    done.catch(() => undefined);
    const flight = { done, resolve, reject, waiters: 1 };
    return flight;
}
/**
 * Create one bounded cache for one model generation. `identity` is frozen: a
 * model switch constructs a new cache rather than mutating this one.
 */
export function createVectorCache(identity) {
    const lru = new LRUCache({
        max: VECTOR_CACHE_MAX_ITEMS,
        maxSize: VECTOR_CACHE_MAX_BYTES,
        sizeCalculation: (value, key) => byteSizeOf(key, value),
    });
    let disposed = false;
    const view = new LruMapView(lru, () => disposed);
    const retire = new AbortController();
    /** One flight per distinct key; its `batch` is what a leaving waiter asks. */
    const flights = new Map();
    const retired = () => new ZoteroError('The semantic vector cache generation is retired; the selected model changed.', ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE);
    /** Resolve a flight, caching the value first so the next reader hits it. */
    const settleFlight = (key, flight, vector) => {
        view.set(key, vector);
        flight.resolve(new Float32Array(vector));
    };
    /**
     * Run one batch of claimed keys. The signal merges the batch's own controller
     * with the generation's retire signal, so a teardown cancels the encoder
     * instead of leaving it to finish against a cache nobody will read.
     */
    const startBatch = (entries, run) => {
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, retire.signal]);
        const batch = {
            leave: () => {
                // Only a batch every waiter abandoned is dropped: one caller going away
                // must not cancel the work another caller is still waiting for.
                if (entries.every((entry) => entry.flight.waiters === 0)) {
                    controller.abort(new Error('every caller of this embedding batch left'));
                    // A fresh caller must not join a flight whose last waiter cancelled:
                    // its own request would fail with a cancellation it never caused.
                    // Removing the flights here (identity-checked) lets `embed` claim new
                    // ones before the aborted run settles; the run's finally will not
                    // delete those newer flights.
                    for (const entry of entries) {
                        if (flights.get(entry.key) === entry.flight)
                            flights.delete(entry.key);
                    }
                }
            },
        };
        for (const entry of entries)
            entry.flight.batch = batch;
        void (async () => {
            try {
                const vectors = await run(entries.map((entry) => entry.text), signal);
                // Every caller walked away (or the generation retired): the run's
                // result belongs to nobody and must never repopulate the cache.
                if (signal.aborted)
                    return;
                if (vectors.length !== entries.length) {
                    throw new Error('the embedder returned the wrong number of vectors');
                }
                for (const [index, entry] of entries.entries()) {
                    const vector = vectors[index];
                    if (vector === undefined || vector.length !== identity.dimension) {
                        throw new Error('the embedder returned no vector for a cached text');
                    }
                    settleFlight(entry.key, entry.flight, vector);
                }
            }
            catch (error) {
                for (const entry of entries)
                    entry.flight.reject(error);
            }
            finally {
                for (const entry of entries) {
                    if (flights.get(entry.key) === entry.flight)
                        flights.delete(entry.key);
                }
            }
        })();
    };
    /** Await one flight under the caller's own cancellation. */
    const awaitFlight = async (flight, signal) => {
        if (signal === undefined)
            return await flight.done;
        return await awaitSharedWaiter(flight.done, signal, {
            onLeave: (aborted) => {
                if (!aborted)
                    return;
                // Only a caller that walked away releases its place; a settlement
                // leaves the flight for its finally to remove.
                flight.waiters -= 1;
                flight.batch?.leave();
            },
        });
    };
    return {
        async embed(texts, side, run, signal) {
            if (disposed)
                throw retired();
            signal?.throwIfAborted();
            const keys = texts.map((text) => vectorCacheKeyOf(identity, side, text));
            const results = new Array(texts.length);
            const missing = new Map();
            for (const [index, key] of keys.entries()) {
                const hit = view.get(key);
                if (hit !== undefined)
                    results[index] = hit;
                else
                    missing.set(key, [...(missing.get(key) ?? []), index]);
            }
            if (missing.size === 0)
                return results;
            // Claim every absent key synchronously, before the first await: a
            // concurrent embed of the same text then joins this flight instead of
            // starting a second run for it.
            const claimed = [];
            const joined = [];
            for (const [key, positions] of missing) {
                const existing = flights.get(key);
                if (existing !== undefined) {
                    existing.waiters += 1;
                    joined.push({ key, flight: existing });
                    continue;
                }
                const flight = createFlight();
                flights.set(key, flight);
                claimed.push({ key, text: texts[positions[0]], flight });
            }
            for (let start = 0; start < claimed.length; start += EMBED_BATCH_SIZE) {
                startBatch(claimed.slice(start, start + EMBED_BATCH_SIZE), run);
            }
            await Promise.all([...claimed, ...joined].map(async ({ key, flight }) => {
                const vector = await awaitFlight(flight, signal);
                for (const position of missing.get(key))
                    results[position] = new Float32Array(vector);
            }));
            return results;
        },
        dispose() {
            disposed = true;
            // The retire signal is what reaches the encoder: every batch merged it
            // into its run signal, so this cancels real inference rather than a
            // controller nothing observes. Pending flights are refused here too, so a
            // caller never depends on the encoder noticing the abort.
            retire.abort(retired());
            for (const flight of flights.values())
                flight.reject(retired());
            flights.clear();
            lru.clear();
        },
    };
}
//# sourceMappingURL=vector-cache.js.map