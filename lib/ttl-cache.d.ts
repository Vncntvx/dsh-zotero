/**
 * A real LRU with a TTL: capacity and idle expiry live in `lru-cache` (the
 * harness' own cache primitive), so a hit refreshes recency — the entry a
 * panel keeps paging is the one that survives — and `ttlAutopurge` releases
 * an expired entry's memory instead of leaving it until the next lookup.
 * The wall-clock check stays in the adapter because freshness here must be
 * `Date.now()`-deterministic: the provider's other fences (version, server
 * id) are read at the same clock, and the specs drive expiry with fake timers.
 */
export declare class LruTtlCache<V extends {
    fetchedAt: number;
}> {
    private readonly ttlMs;
    private readonly entries;
    constructor(limit: number, ttlMs: number);
    get(key: string): V | undefined;
    /** The `Map`-compatible spelling, so a bounded cache can back a shared read. */
    set(key: string, value: V): void;
    delete(key: string): void;
    clear(): void;
}
//# sourceMappingURL=ttl-cache.d.ts.map