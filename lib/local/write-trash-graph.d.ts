/**
 * The shared write walk over one Trash object graph. Restore and batch
 * delete drive the same children-first per-node PATCH and the same read-back
 * proof; polarity, receipts, and error policy stay with the callers, whose
 * failure contracts genuinely differ.
 * @module dsh-zotero/local/write-trash-graph
 */
import type { ZoteroHttpClient } from '../http-client.js';
import { type TrashSnapshot } from './trash-item.js';
import type { WriteDomainDeps } from './write-deps.js';
/** The bookkeeping one graph's patch accumulates as its nodes settle. */
interface TrashWalkProgress {
    /** Refs of the nodes patched so far, in patch order. */
    readonly completedRefs: string[];
    /** The library version of the newest acknowledged PATCH, when one landed. */
    libraryVersion?: number;
}
/** The empty progress a caller owns for one graph's walk. */
export declare function trashWalkProgress(): TrashWalkProgress;
interface PatchTrashNodesOptions {
    /** The polarity the PATCH writes and the settled nodes must end up in. */
    readonly wantDeleted: boolean;
    /** Caller-owned; mutated in place so partial progress survives a throw. */
    readonly progress: TrashWalkProgress;
    /**
     * Called before a commit-unknown rethrows, so the caller records its own
     * receipt shape for the node whose outcome is unknown.
     */
    readonly onCommitUnknown?: (node: TrashSnapshot) => void;
}
/**
 * Patch every node whose deleted state differs from `wantDeleted` under its
 * own version precondition. A commit-unknown aborts the walk: the hook
 * observes the node, then the error rethrows to the caller's policy with the
 * progress so far intact.
 *
 * A settled refusal (a version conflict, for example) blocks that node's
 * ancestors instead: a parent must never be patched over a child whose write
 * did not settle. Independent branches keep going, so one root's refusal in a
 * merged cross-root wave does not leave every other root unwritten; the first
 * refusal is rethrown once no independent node remains.
 */
export declare function patchTrashNodes(deps: WriteDomainDeps, serverId: string, signal: AbortSignal | undefined, nodes: readonly TrashSnapshot[], options: PatchTrashNodesOptions): Promise<void>;
/**
 * Read the graph back and prove every node settled into `wantDeleted` with
 * the same key set the baseline read saw. Returns the read-back for the
 * caller's success receipts; a mismatch throws the caller's message as a
 * ZOTERO_UNEXPECTED refusal.
 */
export declare function verifyTrashGraph(client: ZoteroHttpClient, rootKey: string, serverId: string, baseline: readonly TrashSnapshot[], options: {
    readonly wantDeleted: boolean;
    readonly message: string;
}, signal: AbortSignal | undefined): Promise<readonly TrashSnapshot[]>;
export {};
//# sourceMappingURL=write-trash-graph.d.ts.map