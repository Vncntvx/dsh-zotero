/**
 * Write operations for collection creation, hierarchy, and deletion.
 * @module dsh-zotero/local/write-collections
 */
import type { WriteDomainDeps } from './write-deps.js';
import type { ZoteroCreateCollectionCommittedOutcome, ZoteroCreateCollectionRequest, ZoteroDeleteCollectionRequest, ZoteroDeleteCollectionResult, ZoteroUpdateCollectionRequest, ZoteroUpdateCollectionResult } from '../types.js';
export declare function createCollection(deps: WriteDomainDeps, request: ZoteroCreateCollectionRequest, signal?: AbortSignal): Promise<ZoteroCreateCollectionCommittedOutcome>;
export declare function deleteCollection(deps: WriteDomainDeps, request: ZoteroDeleteCollectionRequest, signal?: AbortSignal): Promise<ZoteroDeleteCollectionResult>;
export declare function updateCollection(deps: WriteDomainDeps, request: ZoteroUpdateCollectionRequest, signal?: AbortSignal): Promise<ZoteroUpdateCollectionResult>;
//# sourceMappingURL=write-collections.d.ts.map