import { mapWithConcurrency } from '../concurrency.js';
import { asRecord, asString, isNonNegativeSafeInteger, isObjectKey } from '../json.js';
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { fetchChildrenForTrash } from './children-wire.js';
/** Sibling child listings are independent reads; this bounds their parallelism. */
const TRASH_GRAPH_CONCURRENCY = 4;
function snapshotOf(json, key) {
    const row = asRecord(json);
    const data = asRecord(row?.data);
    const itemType = asString(data?.itemType);
    if (row?.key !== key ||
        data?.key !== key ||
        !isNonNegativeSafeInteger(row?.version) ||
        data?.version !== row.version ||
        itemType === undefined ||
        itemType === '' ||
        (data?.deleted !== undefined &&
            data.deleted !== 0 &&
            data.deleted !== 1 &&
            typeof data.deleted !== 'boolean')) {
        throw new ZoteroError(`Zotero returned an invalid Trash snapshot for ${key}.`, ZOTERO_UNEXPECTED);
    }
    return {
        key,
        version: row.version,
        itemType,
        deleted: data.deleted === true || data.deleted === 1,
    };
}
async function readTrashSnapshot(client, key, serverId, signal) {
    const { json, headers } = await client.getJson(`users/0/items/${key}`, undefined, {
        serverId,
        signal,
    });
    assertServerIdMatches(serverIdFromHeaders(headers), serverId);
    return snapshotOf(json, key);
}
/**
 * Children precede their parent so a failed child never hides an untrashed
 * object, and sibling order follows the listing order. One round trip per
 * graph level: the child listings of one node's children are independent
 * reads and run concurrently.
 */
export async function readTrashGraph(client, key, serverId, signal) {
    const seen = new Set();
    const visit = async (node) => {
        if (seen.has(node.key))
            throw new ZoteroError(`Zotero repeated child ${node.key} in the Trash graph.`, ZOTERO_UNEXPECTED);
        seen.add(node.key);
        if (node.itemType === 'annotation')
            return [node];
        const children = await fetchChildrenForTrash({ client }, node.key, serverId, node.itemType === 'attachment', signal);
        const childSnapshots = children.map((json) => {
            const data = asRecord(asRecord(json)?.data);
            const childKey = asString(asRecord(json)?.key);
            if (childKey === undefined || !isObjectKey(childKey) || data?.parentItem !== node.key) {
                throw new ZoteroError(`Zotero returned an invalid child of ${node.key}.`, ZOTERO_UNEXPECTED);
            }
            return snapshotOf(json, childKey);
        });
        const childGraphs = await mapWithConcurrency(childSnapshots, TRASH_GRAPH_CONCURRENCY, visit, {
            signal,
        });
        return [...childGraphs.flat(), node];
    };
    return visit(await readTrashSnapshot(client, key, serverId, signal));
}
//# sourceMappingURL=trash-item.js.map