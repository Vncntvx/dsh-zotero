/**
 * Read-merge-write operations for item tags and collection membership.
 * @module dsh-zotero/local/write-item-lists
 */
import { WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js';
import { requireWritableRef } from '../refs.js';
import { collectionRef } from './write-refs.js';
import { collectionState, ensureServerId, mergeList, mergeTagList, normalizeCollectionInput, normalizeWriteList, requireWritableRefAtServer, tagState, withItemStateWrite, } from './write-domain.js';
export async function updateItemTags(deps, request, signal) {
    const localRef = requireWritableRef(request.item, ['item']);
    const add = normalizeWriteList('add', request.add ?? []);
    const remove = normalizeWriteList('remove', request.remove ?? []);
    if (add.length === 0 && remove.length === 0) {
        throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    return await withItemStateWrite(deps, localRef, signal, tagState, async ({ snapshot, serverId, resultRef, send }) => {
        const { merged, added, removed, changed } = mergeTagList(snapshot.tags, remove, add);
        if (!changed) {
            return {
                kind: 'applied',
                ref: resultRef,
                version: snapshot.version,
                tags: merged.map((entry) => entry.tag),
                added: [],
                removed: [],
                unchanged: true,
                serverId,
            };
        }
        const { libraryVersion } = await send({ tags: merged });
        return {
            kind: 'applied',
            ref: resultRef,
            version: libraryVersion,
            tags: merged.map((entry) => entry.tag),
            added,
            removed,
            unchanged: false,
            libraryVersion,
            serverId,
        };
    });
}
export async function updateItemCollections(deps, request, signal) {
    const localRef = requireWritableRef(request.item, ['item']);
    const addInputs = (request.add ?? []).map((value) => normalizeCollectionInput('add', value));
    const removeInputs = (request.remove ?? []).map((value) => normalizeCollectionInput('remove', value));
    if (addInputs.length === 0 && removeInputs.length === 0) {
        throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    const serverId = await ensureServerId(deps, signal);
    const resolved = await deps.resolveCollections([...addInputs, ...removeInputs], signal);
    const addKeys = resolved
        .slice(0, addInputs.length)
        .map((target) => requireWritableRefAtServer(target, ['collection'], serverId).key);
    const removeKeys = resolved
        .slice(addInputs.length)
        .map((target) => requireWritableRefAtServer(target, ['collection'], serverId).key);
    return await withItemStateWrite(deps, localRef, signal, collectionState, async ({ snapshot, serverId: effectiveServerId, resultRef, send }) => {
        const { merged, added, removed, changed } = mergeList(snapshot.collectionKeys, removeKeys, addKeys);
        const toRefs = (keys) => keys.map((key) => collectionRef(key, effectiveServerId));
        if (!changed) {
            return {
                kind: 'applied',
                ref: resultRef,
                version: snapshot.version,
                collections: toRefs(merged),
                added: [],
                removed: [],
                unchanged: true,
                serverId: effectiveServerId,
            };
        }
        const { libraryVersion } = await send({ collections: merged });
        return {
            kind: 'applied',
            ref: resultRef,
            version: libraryVersion,
            collections: toRefs(merged),
            added: toRefs(added),
            removed: toRefs(removed),
            unchanged: false,
            libraryVersion,
            serverId: effectiveServerId,
        };
    });
}
//# sourceMappingURL=write-item-lists.js.map