/**
 * Library-wide tag deletion and restoration of trashed items.
 * @module dsh-zotero/local/write-library-maintenance
 */
import { ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js';
import { WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZOTERO_WRITE_CONFLICT, ZoteroError, ZoteroWriteCommitUnknownError, writeListTooLongMessage, writeListEmptyMessage, } from '../errors.js';
import { asRecord, asString, parseNonNegativeSafeInteger } from '../json.js';
import { readAllPages, requireLibraryVersionHeader } from './pagination.js';
import { libraryPrefix, PERSONAL_LIBRARY, formatRef } from '../refs.js';
import { itemRef } from './write-refs.js';
import { preflightTrashGraphs } from './trash-item.js';
import { patchTrashNodes, trashWalkProgress, verifyTrashGraph } from './write-trash-graph.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { ensureServerId, normalizeWriteList, requireLibraryVersion, requireWritableRefAtServer, withWriteKey, } from './write-domain.js';
import { committedUnverified, receiptOfCommitUnknown } from './write-verdicts.js';
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
    const checked = request.items.map((item) => {
        try {
            return { item, ref: requireWritableRefAtServer(item, ['item'], serverId) };
        }
        catch (error) {
            return { item, error };
        }
    });
    const graphs = await preflightTrashGraphs(deps.client, checked.flatMap((entry) => (entry.ref === undefined ? [] : [entry.ref.key])), serverId, signal);
    for (const entry of checked) {
        const { item } = entry;
        const progress = trashWalkProgress();
        try {
            if (entry.ref === undefined)
                throw entry.error;
            const ref = entry.ref;
            const graph = await graphs.take(ref.key);
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
            // Children precede their parent, so a failed child never leaves an
            // orphaned parent behind a claimed full restore.
            await patchTrashNodes(deps, serverId, signal, graph, {
                wantDeleted: false,
                progress,
                onCommitUnknown: (node) => {
                    // The receipt must reconcile the whole graph write: the parent it
                    // was issued for, the child whose outcome is unknown, and the
                    // siblings acknowledged before it.
                    unverified.push(committedUnverified({
                        kind: 'item',
                        key: node.key,
                        serverId,
                        reason: 'receipt-unknown',
                        parentRef: itemRef(ref.key, serverId),
                        ...(progress.completedRefs.length > 0
                            ? { completedRefs: progress.completedRefs }
                            : {}),
                    }));
                },
            });
            const saved = await verifyTrashGraph(deps.client, ref.key, serverId, graph, {
                wantDeleted: false,
                message: `Zotero did not verify the restored graph for ${ref.key}. Check the completed refs before further action.`,
            }, signal);
            const parent = saved[saved.length - 1];
            restored.push({
                ref: itemRef(ref.key, serverId),
                restored: true,
                version: parent.version,
                libraryVersion: progress.libraryVersion,
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
                ...(progress.completedRefs.length > 0 ? { completedRefs: progress.completedRefs } : {}),
            });
        }
    }
    const kind = failed.length > 0 && restored.length === 0 && unverified.length === 0
        ? 'failed'
        : failed.length > 0 || unverified.length > 0
            ? 'partial'
            : 'restored';
    return { kind, restored, unverified, failed, serverId };
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
    const present = new Set();
    const wanted = new Set(tags);
    await readAllPages(deps.client, `${libraryPrefix(PERSONAL_LIBRARY)}/tags`, {}, effectiveServerId, signal, { body: 'tags', page: 'tag deletion snapshot' }, undefined, (rows, headers) => {
        if (requireLibraryVersionHeader(headers, 'tag deletion snapshot') !== precondition)
            throw new ZoteroError('The library changed while reading tags; review the deletion again.', ZOTERO_WRITE_CONFLICT);
        for (const row of rows) {
            const record = asRecord(row);
            const tag = asString(record?.tag) ?? asString(asRecord(record?.data)?.tag);
            if (tag === undefined)
                throw new ZoteroError('Zotero returned a tag without a name.', ZOTERO_UNEXPECTED);
            if (wanted.has(tag))
                present.add(tag);
        }
    });
    const selectedTags = tags.filter((tag) => present.has(tag));
    const deletedTags = [...selectedTags].sort();
    const absentTags = tags.filter((tag) => !present.has(tag)).sort();
    const receipt = {
        kind: 'deleted',
        deletedTags,
        ...(absentTags.length === 0 ? {} : { absentTags }),
        serverId: effectiveServerId,
    };
    if (deletedTags.length === 0)
        return { ...receipt, libraryVersion: precondition };
    let libraryVersion;
    try {
        ;
        ({ libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => await deps.writer.delete(tagsDeletePath(selectedTags), {
            serverId: effectiveServerId,
            apiKey,
            ifUnmodifiedSinceVersion: precondition,
            tagDeleteLimit: true,
            signal,
        })));
    }
    catch (error) {
        return receiptOfCommitUnknown(error, { kind: 'tag', serverId: effectiveServerId });
    }
    return {
        ...receipt,
        libraryVersion,
    };
}
//# sourceMappingURL=write-library-maintenance.js.map