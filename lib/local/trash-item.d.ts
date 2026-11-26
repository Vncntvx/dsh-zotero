/** Read and verify the complete object graph for a recoverable item deletion. */
import type { ZoteroHttpClient } from '../http-client.js';
export interface TrashSnapshot {
    key: string;
    version: number;
    itemType: string;
    deleted: boolean;
    parentKey?: string;
}
/** Read one complete graph from the current server state, including verification reads. */
export declare function readTrashGraph(client: ZoteroHttpClient, key: string, serverId: string, signal?: AbortSignal): Promise<TrashSnapshot[]>;
/**
 * Preflight independent roots concurrently and share their child listings.
 * Consuming a graph invalidates overlapping preflights: an earlier write may
 * have changed their versions, even if that write subsequently failed.
 * Verification always uses readTrashGraph and never this snapshot cache.
 */
export declare function preflightTrashGraphs(client: ZoteroHttpClient, keys: readonly string[], serverId: string, signal?: AbortSignal): Promise<{
    take(key: string): Promise<TrashSnapshot[]>;
}>;
//# sourceMappingURL=trash-item.d.ts.map