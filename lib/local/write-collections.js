/**
 * Write operations for collection creation, hierarchy, and deletion.
 * @module dsh-zotero/local/write-collections
 */
import { requireNonBlank, writeCollectionNameExistsMessage, writeObjectRefusedMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_NOT_FOUND, ZOTERO_UNEXPECTED, ZoteroError, } from '../errors.js';
import { asRecord, asString, isObjectKey } from '../json.js';
import { formatRef, isRefString, libraryPrefix, parseRef, PERSONAL_LIBRARY } from '../refs.js';
import { readAllPages } from './pagination.js';
import { collectionRef } from './write-refs.js';
import { ensureServerId, normalizeCollectionInput, readRecordForWrite, requireLibraryVersion, requireWritableRefAtServer, withWriteKey, } from './write-domain.js';
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
export async function createCollection(deps, request, signal) {
    const name = requireNonBlank('name', request.name);
    const parentInput = request.parent === undefined ? undefined : normalizeCollectionInput('parent', request.parent);
    const serverId = await ensureServerId(deps, signal);
    const parent = parentInput === undefined
        ? undefined
        : requireWritableRefAtServer(await deps.resolveCollection(parentInput, signal), ['collection'], serverId);
    const parentKey = parent?.key;
    await assertNoSiblingWithName(deps, name, parentKey, serverId, signal);
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
    const read = await readRecordForWrite(deps, 'collection', checked.key, serverId, signal);
    const effectiveServerId = read.serverId;
    const precondition = requireLibraryVersion(read.libraryVersion);
    const resultRef = collectionRef(checked.key, effectiveServerId);
    const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => {
        try {
            return await deps.writer.delete(`${libraryPrefix(PERSONAL_LIBRARY)}/collections/${checked.key}`, { serverId: effectiveServerId, apiKey, ifUnmodifiedSinceVersion: precondition, signal });
        }
        catch (error) {
            if (error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND) {
                throw new ZoteroError(writeObjectRefusedMessage('The collection no longer exists.', 404), ZOTERO_NOT_FOUND);
            }
            throw error;
        }
    });
    deps.onCollectionsChanged?.();
    return {
        kind: 'deleted',
        ref: resultRef,
        key: checked.key,
        deleted: true,
        libraryVersion,
        serverId: effectiveServerId,
    };
}
export async function updateCollection(deps, request, signal) {
    const serverId = await ensureServerId(deps, signal);
    const ref = requireWritableRefAtServer(request.collection, ['collection'], serverId);
    if (request.name === undefined && request.parent === undefined) {
        throw new ZoteroError('At least one of name or parent must be provided.', ZOTERO_INVALID_ARGUMENT);
    }
    const { version } = await readRecordForWrite(deps, 'collection', ref.key, serverId, signal);
    const name = request.name !== undefined ? requireNonBlank('name', request.name) : undefined;
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
    const { libraryVersion } = await withWriteKey(deps, serverId, signal, async (apiKey) => deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/collections/${ref.key}`, patch, {
        serverId,
        apiKey,
        ifUnmodifiedSinceVersion: version,
        signal,
    }));
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