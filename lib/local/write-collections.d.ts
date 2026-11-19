/**
 * Write operations for collection creation, hierarchy, and deletion.
 * @module dsh-zotero/local/write-collections
 */
import type { WriteDomainDeps } from './write-deps.js';
import type { ZoteroCreateCollectionCommittedOutcome, ZoteroCreateCollectionRequest, ZoteroDeleteCollectionRequest, ZoteroDeleteCollectionResult, ZoteroUpdateCollectionRequest, ZoteroUpdateCollectionResult, ZoteroWriteCommittedUnverified } from '../types.js';
/** Resolve the exact parent and reject an existing sibling without obtaining a write grant. */
export declare function prepareCreateCollection(deps: WriteDomainDeps, request: ZoteroCreateCollectionRequest, signal?: AbortSignal): Promise<{
    name: string;
    serverId: string;
    parentKey: string | undefined;
}>;
export declare function createCollection(deps: WriteDomainDeps, request: ZoteroCreateCollectionRequest, signal?: AbortSignal): Promise<ZoteroCreateCollectionCommittedOutcome>;
export declare function deleteCollection(deps: WriteDomainDeps, request: ZoteroDeleteCollectionRequest, signal?: AbortSignal): Promise<ZoteroDeleteCollectionResult | ZoteroWriteCommittedUnverified>;
export declare function updateCollection(deps: WriteDomainDeps, request: ZoteroUpdateCollectionRequest, signal?: AbortSignal): Promise<ZoteroUpdateCollectionResult | ZoteroWriteCommittedUnverified>;
//# sourceMappingURL=write-collections.d.ts.map