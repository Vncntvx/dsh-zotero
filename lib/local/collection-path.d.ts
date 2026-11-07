/**
 * The `collectionPath` read: the exact parent chain of one collection, walked
 * fresh from the target up to the root and fenced by the library version the
 * caller's navigation snapshot was read at. Cached breadcrumbs cannot serve
 * this — a cached name or node would answer for a library that already moved —
 * so every hop is a fresh node read under the caller's version.
 * @module dsh-zotero/local/collection-path
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { ZoteroCollectionPathRequestView, ZoteroCollectionPathResultView } from '../contract.js';
/** Fresh parent reads: object versions never stand in for the library fence. */
export declare function readCollectionPath(client: ZoteroHttpClient, request: ZoteroCollectionPathRequestView, signal?: AbortSignal): Promise<ZoteroCollectionPathResultView>;
//# sourceMappingURL=collection-path.d.ts.map