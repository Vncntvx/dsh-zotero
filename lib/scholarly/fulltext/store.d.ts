/**
 * The open-access full-text store: one cache directory, one in-memory index.
 *
 * **Why not `ctx.storageDomain`.** That seam's `KvTable.get()` is a synchronous
 * read of a fully resident table (`@deepseek-ai/dsh-storage-domain`
 * `domain.ts`), so every cached paper body would live in memory — the bodies
 * are 50–200 KB each and `maxContentChars` allows 50 000 characters. The
 * harness's own answer for large blob caches is the path seam
 * `dshCachePath()` (`@deepseek-ai/dsh-home-paths`), which
 * `packages/attachment/attachment-local` already uses for attachment caches.
 * This store follows that precedent: bodies on disk under the resolved cache
 * root, nothing but a small index in memory.
 *
 * **One value states one fact.** A read distinguishes three outcomes:
 *
 * - `hit` — a record was returned.
 * - `miss` — no record was ever stored.
 * - `corrupt` — a record exists but cannot be trusted (unreadable, wrong size,
 *   malformed JSON); it is evicted and reported, never returned as a miss.
 *
 * A write failure is reported to the caller instead of being swallowed: a
 * cache directory that silently refuses writes turns every read into a fetch
 * while the operator believes caching is on.
 *
 * @module dsh-zotero/scholarly/fulltext/store
 */
/** One retrieved full text, as stored. */
export interface FullTextRecord {
    text: string;
    source: string;
    structured: boolean;
    url?: string;
}
/** What one read produced. */
export type FullTextRead = {
    readonly kind: 'hit';
    readonly record: FullTextRecord;
} | {
    readonly kind: 'miss';
} | {
    readonly kind: 'corrupt';
    readonly reason: string;
};
/**
 * The full-text cache. Bodies live as one JSON document per key under the
 * resolved cache root; a small LRU map fronts them for the repeated reads one
 * conversation makes.
 *
 * A cache fault is never a quiet miss: `get` answers `corrupt` with the
 * reason, the record is evicted, and the resolver carries that reason into
 * the terminal error the model reads (`resolve.ts`). The scholarly
 * subsystem deliberately runs no diagnostics ring of its own — the plugin's
 * ring belongs to the `zotero` namespace, and the scholarly row is isolated
 * from `ctx.zotero` by design (`docs/architecture.md`) — so the fault's
 * observable channel is the reader's, not an operator's.
 */
export declare class ScholarlyTextStore {
    /** Resolved cache root; defaults to the harness cache path for this component. */
    readonly root: string;
    private readonly memoryItems;
    private readonly memory;
    private disposed;
    private rootEnsured;
    constructor(
    /** Resolved cache root; defaults to the harness cache path for this component. */
    root?: string, memoryItems?: number);
    private ensureRoot;
    /**
     * Read one record.
     * @param key - the logical cache key.
     * @returns a discriminated outcome; a corrupt record is evicted, not returned.
     */
    get(key: string): Promise<FullTextRead>;
    /**
     * Store one record durably.
     *
     * The write is atomic (temp document + rename) so a killed process cannot
     * leave a valid-looking prefix behind.
     * @param key - the logical cache key.
     * @param record - the body to store.
     * @throws when the cache root refuses the write; the caller decides whether
     *   that should fail the read it is serving.
     */
    set(key: string, record: FullTextRecord): Promise<void>;
    /** Release the in-memory index. Idempotent. */
    dispose(): void;
    private evict;
    private remember;
}
//# sourceMappingURL=store.d.ts.map