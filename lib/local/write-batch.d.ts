/**
 * Batched item create, merge, and Trash operations against the Local API.
 * @module dsh-zotero/local/write-batch
 */
import type { ZoteroBatchItemsRequest, ZoteroBatchItemsResult } from '../types.js';
import type { WriteDomainDeps } from './write-deps.js';
export declare function batchItems(deps: WriteDomainDeps, request: ZoteroBatchItemsRequest, signal?: AbortSignal): Promise<ZoteroBatchItemsResult>;
//# sourceMappingURL=write-batch.d.ts.map