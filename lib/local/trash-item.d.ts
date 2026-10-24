/** Read and verify the complete object graph for a recoverable item deletion. */
import type { ZoteroHttpClient } from '../http-client.js';
interface TrashSnapshot {
    key: string;
    version: number;
    itemType: string;
    deleted: boolean;
}
/** Children precede their parent so a failed child never hides an untrashed object. */
export declare function readTrashGraph(client: ZoteroHttpClient, key: string, serverId: string, signal?: AbortSignal): Promise<TrashSnapshot[]>;
export {};
//# sourceMappingURL=trash-item.d.ts.map