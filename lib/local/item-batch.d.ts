/**
 * Exact key-set reads shared by the filtered-search page reader and the
 * collection-membership resolver. Zotero's `itemKey=` listing is a scope, not
 * a key filter: its rows include every child of each requested key, and its
 * `includeTrashed` parameter never reaches that scope, so a trashed key
 * answers zero rows there. Reads that must not see trash go through chunked
 * scope listings without a `limit` (the server's default answers every
 * remaining row, so children cannot displace requested keys); reads that must
 * see trash go one key at a time through `GET /items/{key}`, which answers
 * the object itself whether it is trashed or not. Both paths dedupe, assert
 * instance identity, and require cross-request library-version agreement.
 * @module dsh-zotero/local/item-batch
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { SupportedLocalLibrary } from '../types.js';
/** One batched read's behavior. */
export interface ItemKeyBatchOptions<T> {
    /** The instance claim every request must match; absent lets the headers choose. */
    readonly serverId?: string;
    /**
     * Whether the read must see trashed rows. `true` switches to per-key single
     * reads, because the `itemKey=` scope cannot answer them.
     */
    readonly includeTrashed?: boolean;
    readonly signal?: AbortSignal;
    /** The listing label used in body/version errors. */
    readonly what: string;
    /** Map one row; `key` is the object key the row proved. */
    readonly mapRow: (row: unknown, key: string) => T;
    /** A row without an object key is a breach (`throw`) or ignorable (`skip`). */
    readonly onMissingKey: 'throw' | 'skip';
}
/** The rows one batched read returned, keyed by object key. */
export interface ItemKeyBatchResult<T> {
    readonly byKey: Map<string, T>;
    readonly libraryVersion?: number;
}
/**
 * Read exactly the requested keys.
 * @param deps - the transport and its configured concurrency.
 * @param library - the library the keys belong to.
 * @param keys - the object keys to read; duplicates collapse.
 * @param options - read behavior and the row mapper.
 * @returns the rows by key and the library version every request agreed on.
 */
export declare function fetchItemKeyBatches<T>(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, library: SupportedLocalLibrary, keys: readonly string[], options: ItemKeyBatchOptions<T>): Promise<ItemKeyBatchResult<T>>;
//# sourceMappingURL=item-batch.d.ts.map