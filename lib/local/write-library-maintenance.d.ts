/**
 * Library-wide tag deletion and restoration of trashed items.
 * @module dsh-zotero/local/write-library-maintenance
 */
import type { WriteDomainDeps } from './write-deps.js';
import type { ZoteroDeleteLibraryTagsRequest, ZoteroDeleteLibraryTagsResult, ZoteroRestoreItemsRequest, ZoteroRestoreItemsResult, ZoteroWriteCommittedUnverified } from '../types.js';
/**
 * Restore trashed items to the live library. Zotero's own un-delete writes
 * only the object it is asked about (`item.js` removes one `deletedItems`
 * row per save), so restoring the parent alone would strand its attachments,
 * notes, and annotations in the Trash while the tool claimed a full restore.
 * Each item's whole graph is therefore read children-first, restored
 * children-first under its own version precondition, and read back to prove
 * every node is live before the result claims it.
 */
export declare function restoreItems(deps: WriteDomainDeps, request: ZoteroRestoreItemsRequest, signal?: AbortSignal): Promise<ZoteroRestoreItemsResult>;
/** Delete selected tags library-wide under the version returned by a read. */
export declare function deleteLibraryTags(deps: WriteDomainDeps, request: ZoteroDeleteLibraryTagsRequest, signal?: AbortSignal): Promise<ZoteroDeleteLibraryTagsResult | ZoteroWriteCommittedUnverified>;
//# sourceMappingURL=write-library-maintenance.d.ts.map