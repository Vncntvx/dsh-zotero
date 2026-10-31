/**
 * Chunked `itemKey=` reads shared by the note scan, the filtered-search page
 * reader, and the collection-membership resolver. One spelling of the wire
 * batch contract: dedupe, `ZOTERO_ITEMKEY_BATCH` chunks, `limit` at the batch
 * size, identity assertion, and cross-batch library-version agreement.
 * @module dsh-zotero/local/item-batch
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { SupportedLocalLibrary } from '../types.js';
/** One batched read's behavior. */
export interface ItemKeyBatchOptions<T> {
    /** The instance claim every batch must match; absent lets the headers choose. */
    readonly serverId?: string;
    /** Whether the request asks Zotero to include trashed rows. */
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
 * Read exactly the requested keys in chunked `itemKey=` batches.
 * @param deps - the transport and its configured concurrency.
 * @param library - the library the keys belong to.
 * @param keys - the object keys to read; duplicates collapse.
 * @param options - batch behavior and the row mapper.
 * @returns the rows by key and the library version every batch agreed on.
 */
export declare function fetchItemKeyBatches<T>(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, library: SupportedLocalLibrary, keys: readonly string[], options: ItemKeyBatchOptions<T>): Promise<ItemKeyBatchResult<T>>;
//# sourceMappingURL=item-batch.d.ts.map