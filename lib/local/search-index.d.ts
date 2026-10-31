/**
 * The filtered-search index: the host-side store behind the library panel's
 * year and attachment filters. The Local API cannot filter by year or by
 * attachment presence, so an exact answer requires reading every candidate
 * once; the index keeps that read's result (the ordered candidate keys) so
 * paging a filtered list costs one batched key lookup instead of a rescan.
 *
 * Two fences keep the served pages correct:
 * - `cacheGeneration`: the panel bumps its data generation on every refresh
 *   and post-write invalidation, and the key carries it, so a bumped
 *   generation rescans instead of serving the previous scan.
 * - `Last-Modified-Version`: a stored index remembers the library version its
 *   scan read through, and serving a page from it compares that version with
 *   the batch read's; any drift drops the index and rescans once.
 * The TTL bounds memory only; freshness is the version fence's job.
 * @module dsh-zotero/local/search-index
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { ResolvedScopeResult } from './scope-directory.js';
import type { LocalApiLimits } from './limits.js';
import type { SupportedLocalLibrary, ZoteroSearchItem, ZoteroSearchRequest } from '../types.js';
/** Memory bound for both caches. Freshness is the version fence's job. */
export declare const SEARCH_INDEX_TTL_MS = 30000;
/** One scanned candidate: the facts the in-memory filters read. */
export interface FilteredCandidate {
    readonly key: string;
    readonly year?: number;
    /** Present only when the scan indexed attachment presence. */
    readonly hasAttachment?: boolean;
}
/** One filtered listing's scan result: the candidates in listing order. */
export interface FilteredIndex {
    readonly candidates: readonly FilteredCandidate[];
    /** Whether the scan indexed attachment presence for every candidate. */
    readonly attachmentIndexed: boolean;
    readonly serverId?: string;
    readonly libraryVersion?: number;
    readonly fetchedAt: number;
}
/** The parent keys of every attachment in one library, for existence filters. */
export interface AttachmentParents {
    readonly parents: ReadonlySet<string>;
    readonly libraryVersion?: number;
    readonly fetchedAt: number;
}
/**
 * A FIFO-capped, TTL-expiring cache for entries that carry their own
 * `fetchedAt`. Eviction is oldest-insertion; hits do not refresh order.
 */
export declare class LruTtlCache<V extends {
    fetchedAt: number;
}> {
    private readonly limit;
    private readonly ttlMs;
    private readonly entries;
    constructor(limit: number, ttlMs: number);
    get(key: string): V | undefined;
    put(key: string, value: V): void;
    delete(key: string): void;
}
/** The two caches the filtered search rides; one instance per provider. */
export interface SearchIndexCaches {
    readonly filtered: LruTtlCache<FilteredIndex>;
    readonly attachmentParents: LruTtlCache<AttachmentParents>;
}
export declare function createSearchIndexCaches(): SearchIndexCaches;
/**
 * The cache key of one filtered listing: every request field that can change
 * the accepted set or its order, plus the resolved scope and the panel's data
 * generation. A missing field would make two different filters share one
 * index.
 */
export declare function searchIndexKeyOf(scope: ResolvedScopeResult, request: ZoteroSearchRequest, cacheGeneration: number | undefined): string;
/**
 * The cache key of one attachment-presence walk. The walk's freshness is the
 * caller's version fence: the stored entry carries the version it read
 * through, and a hit whose version disagrees with the caller's scan is
 * dropped and re-read.
 */
export declare function attachmentParentsCacheKey(library: SupportedLocalLibrary, serverId: string | undefined, includeTrashed: boolean, cacheGeneration: number | undefined): string;
/**
 * The parent keys of every attachment in one library. Existence filters need
 * the exact set — Zotero's "best attachment" choice cannot prove absence —
 * and one paginated `?itemType=attachment` walk answers every candidate,
 * instead of one `/children` probe per item.
 */
export declare function attachmentParentKeys(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, caches: SearchIndexCaches, library: SupportedLocalLibrary, serverId: string | undefined, includeTrashed: boolean, options: {
    cacheGeneration?: number;
    signal?: AbortSignal;
}): Promise<{
    parents: ReadonlySet<string>;
    libraryVersion?: number;
    fromCache: boolean;
}>;
/**
 * Fetch the item rows for exactly the requested keys, in chunked
 * `itemKey=` batches, and return them keyed by object key. Every batch keeps
 * the identity guard, and all batches must agree on the library version so a
 * page served from the index can be fenced against a stored scan.
 */
export declare function searchRowsByKeys(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, library: SupportedLocalLibrary, serverId: string | undefined, keys: readonly string[], includeTrashed: boolean, signal: AbortSignal | undefined): Promise<{
    byKey: Map<string, ZoteroSearchItem>;
    libraryVersion?: number;
}>;
//# sourceMappingURL=search-index.d.ts.map