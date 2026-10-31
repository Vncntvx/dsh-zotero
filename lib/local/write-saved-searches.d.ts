/**
 * Write operations for saved-search records.
 * @module dsh-zotero/local/write-saved-searches
 */
import type { WriteDomainDeps } from './write-deps.js';
import type { ZoteroCreateSavedSearchRequest, ZoteroDeleteSavedSearchRequest, ZoteroDeleteSavedSearchResult, ZoteroSavedSearchResult, ZoteroUpdateSavedSearchRequest, ZoteroWriteCommittedUnverified } from '../types.js';
export declare function createSavedSearch(deps: WriteDomainDeps, request: ZoteroCreateSavedSearchRequest, signal?: AbortSignal): Promise<ZoteroSavedSearchResult | ZoteroWriteCommittedUnverified>;
export declare function updateSavedSearch(deps: WriteDomainDeps, request: ZoteroUpdateSavedSearchRequest, signal?: AbortSignal): Promise<ZoteroSavedSearchResult>;
export declare function deleteSavedSearch(deps: WriteDomainDeps, request: ZoteroDeleteSavedSearchRequest, signal?: AbortSignal): Promise<ZoteroDeleteSavedSearchResult>;
//# sourceMappingURL=write-saved-searches.d.ts.map