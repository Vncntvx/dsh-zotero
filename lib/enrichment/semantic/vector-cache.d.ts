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
export declare const VECTOR_CACHE_MAX_ITEMS = 16384;
export declare const VECTOR_CACHE_MAX_BYTES: number;
/** The identity and inference contract a cached vector belongs to. */
export interface VectorCacheIdentity {
    readonly key: string;
    readonly physicalKey: string;
    readonly revision: string;
    /** SHA-256 of each pinned catalog file, by relative path. */
    readonly fileDigests: Readonly<Record<string, string>>;
    readonly dimension: number;
    readonly pooling: string;
    readonly normalize: boolean;
    readonly queryPrefix: string;
    readonly documentPrefix: string;
    readonly scoringVersion: string;
}
export type EmbeddingSide = 'query' | 'document';
/** A stable key over the model identity, inference contract, side and text. */
export declare function vectorCacheKeyOf(identity: VectorCacheIdentity, side: EmbeddingSide, text: string): string;
export interface VectorCache {
    /** Embed only the missing texts; hits come from the cache. */
    embed(texts: readonly string[], side: EmbeddingSide, run: (missing: readonly string[], signal: AbortSignal) => Promise<readonly Float32Array[]>, signal?: AbortSignal): Promise<readonly Float32Array[]>;
    /** Drop every entry and cancel pending cooperative work. */
    dispose(): void;
}
/**
 * Create one bounded cache for one model generation. `identity` is frozen: a
 * model switch constructs a new cache rather than mutating this one.
 */
export declare function createVectorCache(identity: VectorCacheIdentity): VectorCache;
//# sourceMappingURL=vector-cache.d.ts.map