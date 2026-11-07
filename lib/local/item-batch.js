/**
 * Exact key-set reads shared by the filtered-search page reader and the
 * collection-membership resolver. Zotero's `itemKey=` listing is a scope, not
 * a key filter: its rows include every child of each requested key, and its
 * `includeTrashed` parameter never reaches that scope, so a trashed key
 * answers zero rows there. Reads that must not see trash go through chunked
 * scope listings without a `limit` (the server's default answers every
 * remaining row, so children cannot displace requested keys); reads that must
 * see trash go one key at a time through `GET /items/{key}`, which answers
 * the object itself whether it is trashed or not. Both paths dedupe, assert
 * instance identity, and require cross-request library-version agreement.
 * @module dsh-zotero/local/item-batch
 */
import { ZOTERO_LIBRARY_VERSION_HEADER } from '../constants.js';
import { mapWithConcurrency } from '../concurrency.js';
import { ZOTERO_NOT_FOUND, ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js';
import { asRecord, asString, parseNonNegativeSafeInteger } from '../json.js';
import { libraryPrefix } from '../refs.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { chunkItemKeyBatches } from './pagination.js';
/**
 * Read exactly the requested keys.
 * @param deps - the transport and its configured concurrency.
 * @param library - the library the keys belong to.
 * @param keys - the object keys to read; duplicates collapse.
 * @param options - read behavior and the row mapper.
 * @returns the rows by key and the library version every request agreed on.
 */
export async function fetchItemKeyBatches(deps, library, keys, options) {
    const unique = [...new Set(keys)];
    if (unique.length === 0)
        return { byKey: new Map(), libraryVersion: undefined };
    return options.includeTrashed === true
        ? fetchSingleItemObjects(deps, library, unique, options)
        : fetchItemKeyScopes(deps, library, unique, options);
}
/**
 * Chunked scope listings for reads that must not see trash. The request
 * carries no `limit`: the server's default answers every remaining row, and a
 * `limit` at the key count would let scope-expanded children displace
 * requested keys out of the answer window.
 */
async function fetchItemKeyScopes(deps, library, unique, options) {
    const chunks = chunkItemKeyBatches(unique);
    const batches = await mapWithConcurrency(chunks, deps.limits.searchConcurrency, async (chunk, poolSignal) => {
        const params = new URLSearchParams({ itemKey: chunk.join(',') });
        const { json, headers } = await deps.client.getJson(`${libraryPrefix(library)}/items`, params, { signal: poolSignal, serverId: options.serverId });
        assertServerIdMatches(serverIdFromHeaders(headers, options.serverId), options.serverId);
        const version = parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER));
        return { byKey: rowsByKey(requireArrayRows(json, options), options), version };
    }, { signal: options.signal });
    return mergeResults(batches, options.what);
}
/**
 * One `GET /items/{key}` per key for reads that must see trashed rows. A key
 * that no longer answers (dropped from the trash, or deleted after the index
 * scanned it) is a missing key, not an error: the caller's own missing-key
 * fence decides what absence means.
 */
async function fetchSingleItemObjects(deps, library, unique, options) {
    const singles = await mapWithConcurrency(unique, deps.limits.searchConcurrency, async (key, poolSignal) => {
        let json;
        let headers;
        try {
            const answer = await deps.client.getJson(`${libraryPrefix(library)}/items/${key}`, undefined, { signal: poolSignal, serverId: options.serverId });
            json = answer.json;
            headers = answer.headers;
        }
        catch (error) {
            if (error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND) {
                return { byKey: new Map(), version: undefined };
            }
            throw error;
        }
        assertServerIdMatches(serverIdFromHeaders(headers, options.serverId), options.serverId);
        const version = parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER));
        const row = asRecord(json);
        if (asString(row?.key) !== key) {
            throw new ZoteroError(`The ${options.what} for ${key} answered a different object key.`, ZOTERO_UNEXPECTED);
        }
        return { byKey: rowsByKey([json], options), version };
    }, { signal: options.signal });
    return mergeResults(singles, options.what);
}
/** Map listing rows to keyed values, honoring the missing-key policy. */
function rowsByKey(rows, options) {
    const byKey = new Map();
    for (const row of rows) {
        const key = asString(asRecord(row)?.key);
        if (key === undefined) {
            if (options.onMissingKey === 'skip')
                continue;
            throw new ZoteroError(`A ${options.what} row arrived without an object key.`, ZOTERO_UNEXPECTED);
        }
        byKey.set(key, options.mapRow(row, key));
    }
    return byKey;
}
/** The scope listing must answer an array; anything else is a broken read. */
function requireArrayRows(json, options) {
    if (!Array.isArray(json)) {
        throw new ZoteroError(`The ${options.what} answered a non-array body.`, ZOTERO_UNEXPECTED);
    }
    return json;
}
/** Merge per-request results and enforce one library version across them. */
function mergeResults(results, what) {
    const byKey = new Map();
    let libraryVersion;
    for (const result of results) {
        for (const [key, item] of result.byKey)
            byKey.set(key, item);
        if (result.version !== undefined) {
            if (libraryVersion !== undefined && libraryVersion !== result.version) {
                throw new ZoteroError(`Zotero's library version changed while the ${what} was fetched.`, ZOTERO_UNEXPECTED);
            }
            libraryVersion = result.version;
        }
    }
    return { byKey, libraryVersion };
}
//# sourceMappingURL=item-batch.js.map