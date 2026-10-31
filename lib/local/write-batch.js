/**
 * Batched item create, merge, and Trash operations against the Local API.
 * @module dsh-zotero/local/write-batch
 */
import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js';
import { WRITE_LIST_SELECTION_MESSAGE, writeListTooLongMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError, } from '../errors.js';
import { formatRef, libraryPrefix, PERSONAL_LIBRARY, requireWritableRef } from '../refs.js';
import { readTrashGraph } from './trash-item.js';
import { batchCreateUnverified, settleBatchCreates } from './write-verdicts.js';
import { ZoteroWriteCommitUnknownError } from '../write-http.js';
import { collectionRef, itemRef } from './write-refs.js';
import { collectionState, createWireEntry, ensureServerId, isWriteUnauthorized, mergeList, mergeTagList, normalizeCreateFields, normalizeCollectionInput, normalizeWriteList, requireWritableRefAtServer, tagState, withItemStateWrite, withWriteKey, } from './write-domain.js';
function prevalidateBatchDeletes(deletes, serverId) {
    return deletes.map((ref) => {
        const writable = requireWritableRef(ref, ['item']);
        return requireWritableRefAtServer(writable, ['item'], serverId);
    });
}
function prevalidateBatchUpdates(updates, serverId) {
    return updates.map((u) => {
        const writable = requireWritableRef(u.ref, ['item']);
        const ref = requireWritableRefAtServer(writable, ['item'], serverId);
        const addTags = normalizeWriteList('addTags', u.addTags ?? []);
        const removeTags = normalizeWriteList('removeTags', u.removeTags ?? []);
        const addColInputs = (u.addCollections ?? []).map((c) => typeof c === 'string' ? normalizeCollectionInput('addCollections', c) : formatRef(c));
        const removeColInputs = (u.removeCollections ?? []).map((c) => typeof c === 'string' ? normalizeCollectionInput('removeCollections', c) : formatRef(c));
        if (addTags.length === 0 &&
            removeTags.length === 0 &&
            addColInputs.length === 0 &&
            removeColInputs.length === 0) {
            throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT);
        }
        return { ref, addTags, removeTags, addColInputs, removeColInputs };
    });
}
function prevalidateBatchCreates(creates) {
    return creates.map((create) => normalizeCreateFields(create, { collections: 'collections' }));
}
async function resolveBatchCollections(deps, checkedCreates, checkedUpdates, serverId, signal) {
    const allColInputs = [
        ...checkedCreates.flatMap((create) => create.colInputs),
        ...checkedUpdates.flatMap((update) => [...update.addColInputs, ...update.removeColInputs]),
    ];
    const uniqueColInputs = [...new Set(allColInputs)];
    const resolvedColsMap = new Map();
    if (uniqueColInputs.length > 0) {
        const resolved = await deps.resolveCollections(uniqueColInputs, signal);
        for (let i = 0; i < uniqueColInputs.length; i++) {
            const key = requireWritableRefAtServer(resolved[i], ['collection'], serverId).key;
            resolvedColsMap.set(uniqueColInputs[i], key);
        }
    }
    return resolvedColsMap;
}
async function runBatchCreates(deps, checkedCreates, resolvedColsMap, serverId, signal, created, unverified, failed) {
    if (checkedCreates.length === 0)
        return undefined;
    const entries = checkedCreates.map((create) => {
        const collectionKeys = create.colInputs
            .map((input) => resolvedColsMap.get(input))
            .filter((key) => key !== undefined);
        return createWireEntry(create, collectionKeys);
    });
    try {
        const batch = await withWriteKey(deps, serverId, signal, (apiKey) => deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/items`, entries, {
            serverId,
            apiKey,
            signal,
        }));
        settleBatchCreates(batch, checkedCreates, serverId, created, unverified, failed);
        return batch.libraryVersion;
    }
    catch (err) {
        if (isWriteUnauthorized(err))
            throw err;
        if (err instanceof ZoteroWriteCommitUnknownError) {
            for (let i = 0; i < checkedCreates.length; i++) {
                unverified.push(batchCreateUnverified(i, 'commit-unknown', serverId));
            }
        }
        else {
            signal?.throwIfAborted();
            for (let i = 0; i < checkedCreates.length; i++) {
                failed.push({
                    op: 'create',
                    index: i,
                    code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
    return undefined;
}
async function runBatchUpdates(deps, checkedUpdates, resolvedColsMap, serverId, signal, updated, failed) {
    let lastLibraryVersion;
    for (const update of checkedUpdates) {
        try {
            const wantsTags = update.addTags.length > 0 || update.removeTags.length > 0;
            const wantsCollections = update.addColInputs.length > 0 || update.removeColInputs.length > 0;
            const readUpdateState = (data) => ({
                tags: wantsTags ? tagState(data).tags : undefined,
                collectionKeys: wantsCollections ? collectionState(data).collectionKeys : undefined,
            });
            const result = await withItemStateWrite(deps, update.ref, signal, readUpdateState, async ({ snapshot, serverId: effectiveServerId, resultRef, send }) => {
                let tagsChanged = false;
                let nextTags = snapshot.tags;
                let addedTags = [];
                let removedTags = [];
                if (snapshot.tags !== undefined) {
                    const merged = mergeTagList(snapshot.tags, update.removeTags, update.addTags);
                    tagsChanged = merged.changed;
                    nextTags = merged.merged;
                    addedTags = merged.added;
                    removedTags = merged.removed;
                }
                let collectionsChanged = false;
                let nextCollectionKeys = snapshot.collectionKeys;
                let addedCollections = [];
                let removedCollections = [];
                if (snapshot.collectionKeys !== undefined) {
                    const addKeys = update.addColInputs
                        .map((input) => resolvedColsMap.get(input))
                        .filter((key) => key !== undefined);
                    const removeKeys = update.removeColInputs
                        .map((input) => resolvedColsMap.get(input))
                        .filter((key) => key !== undefined);
                    const merged = mergeList(snapshot.collectionKeys, removeKeys, addKeys);
                    collectionsChanged = merged.changed;
                    nextCollectionKeys = merged.merged;
                    addedCollections = merged.added;
                    removedCollections = merged.removed;
                }
                if (!tagsChanged && !collectionsChanged) {
                    return {
                        ref: resultRef,
                        version: snapshot.version,
                        addedTags: [],
                        removedTags: [],
                        addedCollections: [],
                        removedCollections: [],
                        unchanged: true,
                    };
                }
                const patchBody = {};
                if (tagsChanged)
                    patchBody.tags = nextTags;
                if (collectionsChanged)
                    patchBody.collections = nextCollectionKeys;
                const { libraryVersion } = await send(patchBody);
                lastLibraryVersion = libraryVersion;
                return {
                    ref: resultRef,
                    version: libraryVersion,
                    addedTags,
                    removedTags,
                    addedCollections: addedCollections.map((key) => collectionRef(key, effectiveServerId)),
                    removedCollections: removedCollections.map((key) => collectionRef(key, effectiveServerId)),
                    unchanged: false,
                };
            });
            updated.push(result);
        }
        catch (err) {
            failed.push({
                op: 'update',
                ref: itemRef(update.ref.key, serverId),
                code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return lastLibraryVersion;
}
async function runBatchDeletes(deps, checkedDeletes, serverId, signal, deleted, failed) {
    let lastLibraryVersion;
    for (const ref of checkedDeletes) {
        const completedRefs = [];
        try {
            const graph = await readTrashGraph(deps.client, ref.key, serverId, signal);
            for (const node of graph) {
                if (node.deleted)
                    continue;
                const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) => deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${node.key}`, { deleted: 1 }, {
                    serverId,
                    apiKey,
                    ifUnmodifiedSinceVersion: node.version,
                    signal,
                }));
                lastLibraryVersion = libraryVersion;
                completedRefs.push(itemRef(node.key, serverId));
            }
            const saved = await readTrashGraph(deps.client, ref.key, serverId, signal);
            const keys = new Set(graph.map((node) => node.key));
            if (saved.length !== graph.length ||
                saved.some((node) => !node.deleted || !keys.has(node.key))) {
                throw new ZoteroError(`Zotero did not verify the complete graph for ${ref.key} in Trash. Check the completed refs before further action.`, ZOTERO_UNEXPECTED);
            }
            const version = saved[saved.length - 1].version;
            deleted.push({
                ref: itemRef(ref.key, serverId),
                key: ref.key,
                deleted: true,
                version,
                children: graph
                    .filter((node) => node.key !== ref.key)
                    .map((node) => itemRef(node.key, serverId)),
            });
        }
        catch (err) {
            failed.push({
                op: 'delete',
                ref: itemRef(ref.key, serverId),
                code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
                message: err instanceof Error ? err.message : String(err),
                ...(completedRefs.length > 0 ? { completedRefs } : {}),
            });
        }
    }
    return lastLibraryVersion;
}
export async function batchItems(deps, request, signal) {
    const creates = request.create ?? [];
    const updates = request.update ?? [];
    const deletes = request.delete ?? [];
    const total = creates.length + updates.length + deletes.length;
    if (total === 0)
        throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    if (total > ZOTERO_WRITE_OBJECT_BATCH) {
        throw new ZoteroError(writeListTooLongMessage('batch items', ZOTERO_WRITE_OBJECT_BATCH), ZOTERO_INVALID_ARGUMENT);
    }
    const serverId = await ensureServerId(deps, signal);
    const checkedDeletes = prevalidateBatchDeletes(deletes, serverId);
    const checkedUpdates = prevalidateBatchUpdates(updates, serverId);
    const checkedCreates = prevalidateBatchCreates(creates);
    const resolvedColsMap = await resolveBatchCollections(deps, checkedCreates, checkedUpdates, serverId, signal);
    const created = [];
    const updated = [];
    const deleted = [];
    const unverified = [];
    const failed = [];
    let latestLibraryVersion;
    const versions = [
        await runBatchCreates(deps, checkedCreates, resolvedColsMap, serverId, signal, created, unverified, failed),
        await runBatchUpdates(deps, checkedUpdates, resolvedColsMap, serverId, signal, updated, failed),
        await runBatchDeletes(deps, checkedDeletes, serverId, signal, deleted, failed),
    ];
    for (const version of versions) {
        if (version !== undefined)
            latestLibraryVersion = version;
    }
    return {
        kind: 'applied',
        total,
        created,
        updated,
        deleted,
        unverified,
        failed,
        ...(latestLibraryVersion !== undefined ? { libraryVersion: latestLibraryVersion } : {}),
        serverId,
    };
}
//# sourceMappingURL=write-batch.js.map