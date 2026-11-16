/** Kept in its own module so the cache and the embedder agree on one number. */
export const EMBED_BATCH_SIZE = 8

/** Includes padding: at 1024 dimensions the hidden output stays within 128 MiB. */
export const EMBED_BATCH_TOKEN_BUDGET = 32_768
