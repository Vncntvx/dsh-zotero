/**
 * Read-merge-write operations for item tags and collection membership.
 * @module dsh-zotero/local/write-item-lists
 */
import type { ZoteroUpdateItemCollectionsRequest, ZoteroUpdateItemCollectionsResult, ZoteroUpdateItemTagsRequest, ZoteroUpdateItemTagsResult } from '../types.js';
import type { WriteDomainDeps } from './write-deps.js';
export declare function updateItemTags(deps: WriteDomainDeps, request: ZoteroUpdateItemTagsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemTagsResult>;
export declare function updateItemCollections(deps: WriteDomainDeps, request: ZoteroUpdateItemCollectionsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemCollectionsResult>;
//# sourceMappingURL=write-item-lists.d.ts.map