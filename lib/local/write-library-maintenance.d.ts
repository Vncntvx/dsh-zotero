/**
 * Library-wide tag deletion and restoration of trashed items.
 * @module dsh-zotero/local/write-library-maintenance
 */
import type { WriteDomainDeps } from './write-deps.js';
import type { ZoteroDeleteLibraryTagsRequest, ZoteroDeleteLibraryTagsResult, ZoteroRestoreItemsRequest, ZoteroRestoreItemsResult } from '../types.js';
/** Restore trashed items by setting Zotero's deleted flag back to zero. */
export declare function restoreItems(deps: WriteDomainDeps, request: ZoteroRestoreItemsRequest, signal?: AbortSignal): Promise<ZoteroRestoreItemsResult>;
/** Delete selected tags library-wide under the version returned by a read. */
export declare function deleteLibraryTags(deps: WriteDomainDeps, request: ZoteroDeleteLibraryTagsRequest, signal?: AbortSignal): Promise<ZoteroDeleteLibraryTagsResult>;
//# sourceMappingURL=write-library-maintenance.d.ts.map