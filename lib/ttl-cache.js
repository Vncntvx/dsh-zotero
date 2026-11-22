/** Shared bounded read-cache policy. */
import { LRUCache } from 'lru-cache';
/**
 * A real LRU with a TTL: capacity and idle expiry live in `lru-cache` (the
 * harness' own cache primitive), so a hit refreshes recency — the entry a
 * panel keeps paging is the one that survives — and `ttlAutopurge` releases
 * an expired entry's memory instead of leaving it until the next lookup.
 * The wall-clock check stays in the adapter because freshness here must be
 * `Date.now()`-deterministic: the provider's other fences (version, server
 * id) are read at the same clock, and the specs drive expiry with fake timers.
 */
export class LruTtlCache {
    ttlMs;
    entries;
    constructor(limit, ttlMs) {
        this.ttlMs = ttlMs;
        this.entries = new LRUCache({ max: limit, ttl: ttlMs, ttlAutopurge: true });
    }
    get(key) {
        const value = this.entries.get(key);
        if (value === undefined)
            return undefined;
        if (Date.now() - value.fetchedAt >= this.ttlMs) {
            this.entries.delete(key);
            return undefined;
        }
        return value;
    }
    /** The `Map`-compatible spelling, so a bounded cache can back a shared read. */
    set(key, value) {
        this.entries.set(key, value);
    }
    delete(key) {
        this.entries.delete(key);
    }
}
//# sourceMappingURL=ttl-cache.js.map