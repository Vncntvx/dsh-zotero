/** Kept in its own module so the cache and the embedder agree on one number. */
export declare const EMBED_BATCH_SIZE = 8;
/** Includes padding: at 1024 dimensions the hidden output stays within 128 MiB. */
export declare const EMBED_BATCH_TOKEN_BUDGET = 32768;
//# sourceMappingURL=batching.d.ts.map