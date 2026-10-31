/**
 * The `collectionPath` read: the exact parent chain of one collection, walked
 * fresh from the target up to the root and fenced by the library version the
 * caller's navigation snapshot was read at. Cached breadcrumbs cannot serve
 * this — a cached name or node would answer for a library that already moved —
 * so every hop is a fresh node read under the caller's version.
 * @module dsh-zotero/local/collection-path
 */
import { ZoteroError, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, isNotFoundError, } from '../errors.js';
import { libraryPrefix, parseRef, requireSupportedLocalRef, sameLibrary, refStringFor, } from '../refs.js';
import { asRecord } from '../json.js';
import { readCollectionNode } from './scope-directory.js';
import { requireLibraryVersionHeader } from './pagination.js';
/** Fresh parent reads: object versions never stand in for the library fence. */
export async function readCollectionPath(client, request, signal) {
    const ref = requireSupportedLocalRef(parseRef(request.ref), ['collection']);
    if (!sameLibrary(ref.library, request.library))
        throw new ZoteroError('Collection belongs to another library.', ZOTERO_INVALID_ARGUMENT);
    const prefix = libraryPrefix(request.library);
    let key = ref.key;
    let serverId = ref.serverId;
    const seen = new Set();
    const chain = [];
    while (key !== undefined) {
        if (seen.has(key))
            throw new ZoteroError('Collection parent chain contains a cycle.', ZOTERO_UNEXPECTED);
        seen.add(key);
        let node;
        try {
            node = await readCollectionNode(client, request.library, key, serverId, signal);
        }
        catch (error) {
            if (chain.length && isNotFoundError(error))
                throw new ZoteroError('Collection ancestor is missing.', ZOTERO_UNEXPECTED);
            throw error;
        }
        serverId = node.servedBy;
        const entry = node.entry;
        // `normalizeScopeEntry` folds an absent, `false`, and unusable parent into
        // `parentKey === undefined`; the raw value tells those apart, and a parent
        // Zotero reported but could not name is protocol drift, not a root.
        const parent = asRecord(asRecord(node.json)?.data)?.parentCollection;
        if (parent !== undefined && parent !== false && entry.parentKey === undefined)
            throw new ZoteroError('Collection parent relationship is invalid.', ZOTERO_UNEXPECTED);
        chain.unshift(entry);
        key = entry.parentKey;
    }
    // The chain reads are fresh, so the library version they ran under can only
    // be proven by a listing read: object versions are per-object, not the fence
    // the navigation snapshot was taken at.
    const probe = await client.getJson(`${prefix}/collections/top`, new URLSearchParams({ limit: '1' }), { signal, serverId });
    const libraryVersion = requireLibraryVersionHeader(probe.headers, 'collection path');
    if (libraryVersion !== request.libraryVersion)
        throw new ZoteroError('Library changed while locating the collection. Reload navigation.', ZOTERO_UNEXPECTED);
    const path = chain.map((entry, index) => ({
        kind: 'collection',
        ref: refStringFor(request.library, 'collection', entry.key, serverId),
        name: entry.name,
        ...(entry.parentKey
            ? { parentRef: refStringFor(request.library, 'collection', entry.parentKey, serverId) }
            : {}),
        path: chain.slice(0, index + 1).map((row) => row.name),
        depth: index,
    }));
    return { library: request.library, libraryVersion, path };
}
//# sourceMappingURL=collection-path.js.map