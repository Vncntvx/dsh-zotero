/** Read and verify the complete object graph for a recoverable item deletion. */
import type { ZoteroHttpClient } from '../http-client.js';
export interface TrashSnapshot {
    key: string;
    version: number;
    itemType: string;
    deleted: boolean;
}
/**
 * Children precede their parent so a failed child never hides an untrashed
 * object, and sibling order follows the listing order. One round trip per
 * graph level: the child listings of one node's children are independent
 * reads and run concurrently.
 */
export declare function readTrashGraph(client: ZoteroHttpClient, key: string, serverId: string, signal?: AbortSignal): Promise<TrashSnapshot[]>;
//# sourceMappingURL=trash-item.d.ts.map