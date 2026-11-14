/**
 * The shared write walk over one Trash object graph. Restore and batch
 * delete drive the same children-first per-node PATCH and the same read-back
 * proof; polarity, receipts, and error policy stay with the callers, whose
 * failure contracts genuinely differ.
 * @module dsh-zotero/local/write-trash-graph
 */
import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js';
import { ZoteroError, ZOTERO_UNEXPECTED, ZoteroWriteCommitUnknownError } from '../errors.js';
import { readTrashGraph } from './trash-item.js';
import { itemRef } from './write-refs.js';
import { withWriteKey } from './write-domain.js';
/** The empty progress a caller owns for one graph's walk. */
export function trashWalkProgress() {
    return { completedRefs: [] };
}
/**
 * Patch every node whose deleted state differs from `wantDeleted` under its
 * own version precondition. A commit-unknown aborts the walk: the hook
 * observes the node, then the error rethrows to the caller's policy with the
 * progress so far intact.
 */
export async function patchTrashNodes(deps, serverId, signal, nodes, options) {
    for (const node of nodes) {
        if (node.deleted === options.wantDeleted)
            continue;
        try {
            const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) => deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${node.key}`, { deleted: options.wantDeleted ? 1 : 0 }, {
                serverId,
                apiKey,
                ifUnmodifiedSinceVersion: node.version,
                signal,
            }));
            options.progress.libraryVersion = libraryVersion;
        }
        catch (error) {
            if (error instanceof ZoteroWriteCommitUnknownError)
                options.onCommitUnknown?.(node);
            throw error;
        }
        options.progress.completedRefs.push(itemRef(node.key, serverId));
    }
}
/**
 * Read the graph back and prove every node settled into `wantDeleted` with
 * the same key set the baseline read saw. Returns the read-back for the
 * caller's success receipts; a mismatch throws the caller's message as a
 * ZOTERO_UNEXPECTED refusal.
 */
export async function verifyTrashGraph(client, rootKey, serverId, baseline, options, signal) {
    const saved = await readTrashGraph(client, rootKey, serverId, signal);
    const keys = new Set(baseline.map((node) => node.key));
    if (saved.length !== baseline.length ||
        saved.some((node) => node.deleted !== options.wantDeleted || !keys.has(node.key))) {
        throw new ZoteroError(options.message, ZOTERO_UNEXPECTED);
    }
    return saved;
}
//# sourceMappingURL=write-trash-graph.js.map