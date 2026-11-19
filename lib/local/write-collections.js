/**
 * Write operations for collection creation, hierarchy, and deletion.
 * @module dsh-zotero/local/write-collections
 */
import { requireNonBlank, writeCollectionNameExistsMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError, } from '../errors.js';
import { asRecord, asString, isObjectKey } from '../json.js';
import { requireUpdateField } from '../write-item-rules.js';
import { formatRef, isRefString, libraryPrefix, parseRef, PERSONAL_LIBRARY } from '../refs.js';
import { readAllPages } from './pagination.js';
import { collectionRef } from './write-refs.js';
import { ensureServerId, normalizeCollectionInput, readRecordForWrite, requireWritableRefAtServer, withWriteKey, } from './write-domain.js';
import { deleteRecordForWrite, patchRecordForWrite } from './write-record.js';
import { settleCreate } from './write-verdicts.js';
async function assertNoSiblingWithName(deps, name, parentKey, serverId, signal) {
    const listPath = parentKey === undefined
        ? `${libraryPrefix(PERSONAL_LIBRARY)}/collections/top`
        : `${libraryPrefix(PERSONAL_LIBRARY)}/collections/${parentKey}/collections`;
    await readAllPages(deps.client, listPath, {}, serverId, signal, { body: 'the collections listing', page: 'sibling collections' }, undefined, (rows) => {
        for (const row of rows) {
            const record = asRecord(row);
            const key = asString(record?.key);
            const rowName = asString(asRecord(record?.data)?.name);
            if (key === undefined || !isObjectKey(key) || rowName === undefined) {
                throw new ZoteroError('Zotero returned a malformed collection row in the sibling listing', ZOTERO_UNEXPECTED);
            }
            if (rowName === name) {
                throw new ZoteroError(writeCollectionNameExistsMessage(name), ZOTERO_INVALID_ARGUMENT);
            }
        }
    });
}
/** Resolve the exact parent and reject an existing sibling without obtaining a write grant. */
export async function prepareCreateCollection(deps, request, signal) {
    const name = requireNonBlank('name', request.name);
    const parentInput = request.parent === undefined ? undefined : normalizeCollectionInput('parent', request.parent);
    const serverId = await ensureServerId(deps, signal);
    const parent = parentInput === undefined
        ? undefined
        : requireWritableRefAtServer(await deps.resolveCollection(parentInput, signal), ['collection'], serverId);
    const parentKey = parent?.key;
    await assertNoSiblingWithName(deps, name, parentKey, serverId, signal);
    return { name, serverId, parentKey };
}
export async function createCollection(deps, request, signal) {
    const { name, serverId, parentKey } = await prepareCreateCollection(deps, request, signal);
    const entry = {
        name,
        ...(parentKey !== undefined ? { parentCollection: parentKey } : {}),
    };
    const created = await withWriteKey(deps, serverId, signal, async (apiKey) => {
        const proven = (data) => {
            if (asString(data.name) !== name)
                return undefined;
            const savedParent = asString(data.parentCollection);
            return (parentKey ?? undefined) === (savedParent ?? undefined) ? name : undefined;
        };
        const settled = await settleCreate(deps, {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/collections`,
            entry,
            serverId,
            apiKey,
            signal,
            kind: 'collection',
        }, proven);
        if (settled.status === 'unverified')
            return settled.result;
        const { key, version } = settled.entry;
        return {
            kind: 'applied',
            ref: collectionRef(key, serverId),
            key,
            version,
            name,
            ...(parentKey !== undefined ? { parentRef: collectionRef(parentKey, serverId) } : {}),
            libraryVersion: settled.entry.libraryVersion,
            serverId,
        };
    });
    if (created.key !== undefined)
        deps.onCollectionsChanged?.();
    return created;
}
export async function deleteCollection(deps, request, signal) {
    const input = normalizeCollectionInput('collection', request.collection);
    const serverId = await ensureServerId(deps, signal);
    const checked = isRefString(input)
        ? requireWritableRefAtServer(parseRef(input), ['collection'], serverId)
        : requireWritableRefAtServer(await deps.resolveCollection(input, signal), ['collection'], serverId);
    const result = await deleteRecordForWrite(deps, { kind: 'collection', key: checked.key, serverId }, signal);
    if (result.kind === 'deleted')
        deps.onCollectionsChanged?.();
    return result;
}
export async function updateCollection(deps, request, signal) {
    requireUpdateField({ name: request.name, parent: request.parent });
    const name = request.name !== undefined ? requireNonBlank('name', request.name) : undefined;
    const serverId = await ensureServerId(deps, signal);
    const ref = requireWritableRefAtServer(request.collection, ['collection'], serverId);
    const { version } = await readRecordForWrite(deps, 'collection', ref.key, serverId, signal);
    const patch = {};
    if (name !== undefined)
        patch.name = name;
    if (request.parent !== undefined) {
        if (request.parent === null)
            patch.parentCollection = false;
        else {
            const parent = requireWritableRefAtServer(request.parent, ['collection'], serverId);
            patch.parentCollection = parent.key;
        }
    }
    const outcome = await patchRecordForWrite(deps, { kind: 'collection', key: ref.key, serverId }, version, patch, signal);
    if (outcome.status === 'unverified')
        return outcome.value;
    const { libraryVersion } = outcome;
    deps.onCollectionsChanged?.();
    return {
        kind: 'applied',
        ref: collectionRef(ref.key, serverId),
        version: libraryVersion,
        ...(name !== undefined ? { name } : {}),
        ...(request.parent && request.parent !== null ? { parentRef: formatRef(request.parent) } : {}),
        libraryVersion,
        serverId,
    };
}
//# sourceMappingURL=write-collections.js.map