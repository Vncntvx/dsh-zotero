/** Bounded, order-preserving batch metadata reads. */
import type { ZoteroGetBatchRequest, ZoteroGetBatchResult, ZoteroGetRequest, ZoteroItemDetail } from '../types.js';
export declare const GET_BATCH_MAX = 50;
/** Read up to 50 refs with at most eight child operations in flight. */
export declare function getBatch(getItem: (request: ZoteroGetRequest, signal?: AbortSignal) => Promise<ZoteroItemDetail>, request: ZoteroGetBatchRequest, signal?: AbortSignal): Promise<ZoteroGetBatchResult>;
//# sourceMappingURL=get-batch-domain.d.ts.map