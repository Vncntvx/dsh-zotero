/** Bounded, order-preserving batch metadata reads. */
import type { ZoteroGetBatchRequest, ZoteroGetBatchResult, ZoteroGetRequest, ZoteroItemDetail } from '../types.js';
export declare const GET_BATCH_MAX = 50;
/** Validate the entire request before starting any per-ref read. */
export declare function assertGetBatchRequest(request: ZoteroGetBatchRequest): void;
/** Read up to 50 refs within the provider's bulk-read concurrency budget. */
export declare function getBatch(getItem: (request: ZoteroGetRequest, signal?: AbortSignal) => Promise<ZoteroItemDetail>, request: ZoteroGetBatchRequest, signal?: AbortSignal, concurrency?: number): Promise<ZoteroGetBatchResult>;
//# sourceMappingURL=get-batch-domain.d.ts.map