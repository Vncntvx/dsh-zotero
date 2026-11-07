/**
 * Library-wide tag deletion and restoration of trashed items.
 * @module dsh-zotero/local/write-library-maintenance
 */
import { ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js';
import { WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError, ZoteroWriteCommitUnknownError, writeListTooLongMessage, writeListEmptyMessage, } from '../errors.js';
import { parseNonNegativeSafeInteger } from '../json.js';
import { libraryPrefix, PERSONAL_LIBRARY, formatRef } from '../refs.js';
import { itemRef } from './write-refs.js';
import { readTrashGraph } from './trash-item.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { ensureServerId, normalizeWriteList, requireLibraryVersion, requireWritableRefAtServer, withWriteKey, } from './write-domain.js';
import { committedUnverified } from './write-verdicts.js';
async function readLibraryVersion(deps, serverId, signal) {
    const params = new URLSearchParams({ limit: '1' });
    const response = await deps.client.get(`${libraryPrefix(PERSONAL_LIBRARY)}/items/top`, params, {
        signal,
        serverId,
    });
    const libraryVersion = requireLibraryVersion(parseNonNegativeSafeInteger(response.headers.get(ZOTERO_LIBRARY_VERSION_HEADER)));
    const observed = serverIdFromHeaders(response.headers);
    assertServerIdMatches(observed, serverId);
    return { libraryVersion, serverId: observed ?? serverId };
}
/**
 * Restore trashed items to the live library. Zotero's own un-delete writes
 * only the object it is asked about (`item.js` removes one `deletedItems`
 * row per save), so restoring the parent alone would strand its attachments,
 * notes, and annotations in the Trash while the tool claimed a full restore.
 * Each item's whole graph is therefore read children-first, restored
 * children-first under its own version precondition, and read back to prove
 * every node is live before the result claims it.
 */
export async function restoreItems(deps, request, signal) {
    if (request.items.length === 0)
        throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    if (request.items.length > ZOTERO_WRITE_OBJECT_BATCH)
        throw new ZoteroError(writeListTooLongMessage('restore items', ZOTERO_WRITE_OBJECT_BATCH), ZOTERO_INVALID_ARGUMENT);
    const restored = [];
    const unverified = [];
    const failed = [];
    const serverId = await ensureServerId(deps, signal);
    for (const item of request.items) {
        const completedRefs = [];
        try {
            const ref = requireWritableRefAtServer(item, ['item'], serverId);
            const graph = await readTrashGraph(deps.client, ref.key, serverId, signal);
            if (!graph.some((node) => node.deleted)) {
                // The whole graph is already live: writing a `deleted: 0` that the
                // server would accept as a no-op must not be reported as a restore.
                const present = graph[graph.length - 1];
                restored.push({
                    ref: itemRef(ref.key, serverId),
                    restored: false,
                    alreadyPresent: true,
                    version: present.version,
                    serverId,
                });
                continue;
            }
            let lastLibraryVersion;
            // Children precede their parent, so a failed child never leaves an
            // orphaned parent behind a claimed full restore.
            for (const node of graph) {
                if (!node.deleted)
                    continue;
                let libraryVersion;
                try {
                    ;
                    ({ libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) => deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${node.key}`, { deleted: 0 }, {
                        serverId,
                        apiKey,
                        ifUnmodifiedSinceVersion: node.version,
                        signal,
                    })));
                }
                catch (error) {
                    if (error instanceof ZoteroWriteCommitUnknownError) {
                        unverified.push(committedUnverified({
                            kind: 'item',
                            key: node.key,
                            serverId,
                            reason: 'receipt-unknown',
                        }));
                    }
                    throw error;
                }
                lastLibraryVersion = libraryVersion;
                completedRefs.push(itemRef(node.key, serverId));
            }
            const saved = await readTrashGraph(deps.client, ref.key, serverId, signal);
            const keys = new Set(graph.map((node) => node.key));
            if (saved.length !== graph.length ||
                saved.some((node) => node.deleted || !keys.has(node.key))) {
                throw new ZoteroError(`Zotero did not verify the restored graph for ${ref.key}. Check the completed refs before further action.`, ZOTERO_UNEXPECTED);
            }
            const parent = saved[saved.length - 1];
            restored.push({
                ref: itemRef(ref.key, serverId),
                restored: true,
                version: parent.version,
                libraryVersion: lastLibraryVersion,
                serverId,
                ...(graph.length > 1
                    ? { children: graph.slice(0, -1).map((node) => ({ ref: itemRef(node.key, serverId) })) }
                    : {}),
            });
        }
        catch (error) {
            if (error instanceof ZoteroWriteCommitUnknownError)
                continue;
            if (!(error instanceof ZoteroError))
                throw error;
            failed.push({
                op: 'update',
                ref: formatRef(item),
                code: error.code,
                message: error.message,
                ...(completedRefs.length > 0 ? { completedRefs } : {}),
            });
        }
    }
    return { kind: 'restored', restored, unverified, failed, serverId };
}
function tagsDeletePath(tags) {
    return `${libraryPrefix(PERSONAL_LIBRARY)}/tags?tag=${tags
        .map((name) => encodeURIComponent(name))
        .join('||')}`;
}
/** Delete selected tags library-wide under the version returned by a read. */
export async function deleteLibraryTags(deps, request, signal) {
    const tags = normalizeWriteList('tags', request.tags ?? []);
    if (tags.length === 0) {
        throw new ZoteroError(writeListEmptyMessage('tags'), ZOTERO_INVALID_ARGUMENT);
    }
    const serverId = await ensureServerId(deps, signal);
    const { libraryVersion: precondition, serverId: effectiveServerId } = await readLibraryVersion(deps, serverId, signal);
    let libraryVersion;
    try {
        ;
        ({ libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => await deps.writer.delete(tagsDeletePath(tags), {
            serverId: effectiveServerId,
            apiKey,
            ifUnmodifiedSinceVersion: precondition,
            tagDeleteLimit: true,
            signal,
        })));
    }
    catch (error) {
        if (error instanceof ZoteroWriteCommitUnknownError)
            return committedUnverified({
                kind: 'item',
                serverId: effectiveServerId,
                reason: 'receipt-unknown',
            });
        throw error;
    }
    return {
        kind: 'deleted',
        deletedTags: [...tags].sort(),
        libraryVersion,
        serverId: effectiveServerId,
    };
}
//# sourceMappingURL=write-library-maintenance.js.map