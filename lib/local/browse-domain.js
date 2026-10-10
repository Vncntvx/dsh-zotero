/**
 * The `zotero_browse` domain: the six bounded discovery kinds (libraries,
 * server-side collection navigation with breadcrumb walks, saved searches,
 * scoped tag facets, item types, and per-type metadata fields). Argument
 * cross-constraints fail closed at the entry before any request.
 * @module dsh-zotero/local/browse-domain
 */
import { ITEM_FIELDS_ITEM_TYPE_MESSAGE, ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE, ITEM_TYPE_SCOPE_MESSAGE, MATCH_REQUIRES_Q_MESSAGE, OFFSET_NON_NEGATIVE_MESSAGE, PARENT_REF_SCOPE_MESSAGE, Q_MATCH_SCOPE_MESSAGE, SCOPE_FACET_KIND_MESSAGE, SCOPE_NAME_MESSAGE, browseLimitMessage, isNotFoundError, libraryNotAllowedMessage, parentLibraryMismatchMessage, unsupportedBrowseKindMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError, } from '../errors.js';
import { ZOTERO_SERVER_ID_HEADER } from '../constants.js';
import { requireAgreedServerId } from './identity.js';
import { asRecord, asString, isObjectKey } from '../json.js';
import { normalizeScopeEntry } from '../normalize.js';
import { assertPublicationsSupported, formatRef, isRefString, libraryPrefix, parseRef, refForLibrary, requireSupportedLocalRef, sameLibrary, PERSONAL_GROUPS_DISCOVERY, PERSONAL_LIBRARY, } from '../refs.js';
import { requireArrayBody, requireTotalResults, nextOffsetOf, nextOffsetOrFail, } from './pagination.js';
import { itemsSegmentFor, publicationsTagsPath } from './scope-directory.js';
export async function runBrowse(deps, directory, request, signal) {
    const maxBrowse = deps.limits.maxBrowseResults;
    if (!Number.isInteger(request.offset) || request.offset < 0) {
        throw new ZoteroError(OFFSET_NON_NEGATIVE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    if (!Number.isInteger(request.limit) || request.limit <= 0 || request.limit > maxBrowse) {
        throw new ZoteroError(browseLimitMessage(maxBrowse), ZOTERO_INVALID_ARGUMENT);
    }
    // Fail-closed: libraries/itemTypes/itemFields are global, so the library
    // parameter must not be set for them.
    if ((request.kind === 'libraries' ||
        request.kind === 'itemTypes' ||
        request.kind === 'itemFields') &&
        request.library !== undefined) {
        throw new ZoteroError(libraryNotAllowedMessage(request.kind), ZOTERO_INVALID_ARGUMENT);
    }
    if ((request.kind === 'libraries' ||
        request.kind === 'itemTypes' ||
        request.kind === 'collections' ||
        request.kind === 'savedSearches' ||
        request.kind === 'tags') &&
        request.itemType !== undefined) {
        throw new ZoteroError(ITEM_TYPE_SCOPE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    if (request.kind === 'itemFields') {
        if (request.itemType === undefined || !/^[A-Za-z][A-Za-z0-9]*$/.test(request.itemType)) {
            throw new ZoteroError(ITEM_FIELDS_ITEM_TYPE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
        }
        return await browseItemFields(deps, request, signal);
    }
    if ((request.q !== undefined || request.match !== undefined) && request.kind !== 'tags') {
        throw new ZoteroError(Q_MATCH_SCOPE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    if (request.match !== undefined && request.q === undefined) {
        throw new ZoteroError(MATCH_REQUIRES_Q_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    if (request.parentRef !== undefined && request.kind !== 'collections') {
        throw new ZoteroError(PARENT_REF_SCOPE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    if ((request.scope !== undefined ||
        request.itemLevel !== undefined ||
        request.itemQuery !== undefined ||
        request.itemQueryMode !== undefined) &&
        request.kind !== 'tags') {
        throw new ZoteroError(SCOPE_FACET_KIND_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    if (request.scope === undefined) {
        if (request.itemLevel !== undefined || request.itemQuery !== undefined) {
            throw new ZoteroError(ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
        }
    }
    else if (request.scope.kind === 'collection' && !isRefString(request.scope.refOrName)) {
        // Name resolution happens in browseTags via resolveNamed; nothing to
        // check here beyond non-emptiness.
        if (request.scope.refOrName.trim() === '') {
            throw new ZoteroError(SCOPE_NAME_MESSAGE, ZOTERO_INVALID_ARGUMENT);
        }
    }
    switch (request.kind) {
        case 'libraries':
            return await browseLibraries(deps, request, signal);
        case 'collections':
            return await browseCollections(deps, directory, request, signal);
        case 'savedSearches':
            return await browseSavedSearches(deps, request, signal);
        case 'tags':
            return await browseTags(deps, directory, request, signal);
        case 'itemTypes':
            return await browseItemTypes(deps, request, signal);
        default:
            throw new ZoteroError(unsupportedBrowseKindMessage(request.kind), ZOTERO_INVALID_ARGUMENT);
    }
}
/**
 * The shared result envelope for a browse page.
 *
 * Every arm of this module returns the same shape, so a change to paging
 * (an additional cursor field, a different omission rule) belongs here
 * rather than in six places. `kind` decides the payload type, so callers
 * pass the slice they actually return.
 */
function browsePage(kind, page) {
    return {
        kind,
        ...(page.library !== undefined ? { library: page.library } : {}),
        ...(page.serverId !== undefined && page.serverId !== '' ? { serverId: page.serverId } : {}),
        items: page.items,
        total: page.total,
        offset: page.offset,
        returned: page.items.length,
        ...(page.next !== undefined ? { nextOffset: page.next } : {}),
    };
}
async function browseLibraries(deps, request, signal) {
    let serverId;
    const items = [];
    // personal always present
    items.push({ library: PERSONAL_LIBRARY, name: 'My Library' });
    // try to discover groups; Zotero 7/8/9 may 404
    try {
        const { json, headers } = await deps.client.getJson(PERSONAL_GROUPS_DISCOVERY, undefined, {
            signal,
        });
        serverId = headers.get(ZOTERO_SERVER_ID_HEADER) ?? undefined;
        const groups = requireArrayBody(json, 'groups');
        for (const row of groups) {
            const rec = asRecord(row);
            const idRaw = rec?.id ?? rec?.groupID ?? asRecord(rec?.data)?.groupID;
            const nameRaw = asString(rec?.name) ?? asString(asRecord(rec?.data)?.name) ?? asString(rec?.groupName) ?? '';
            const id = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : undefined;
            if (id === undefined || !Number.isInteger(id) || id <= 0)
                continue;
            const name = nameRaw || `Group ${id}`;
            items.push({ library: { type: 'group', id }, name });
        }
    }
    catch (error) {
        if (isNotFoundError(error)) {
            // older Zotero without groups listing: just personal
        }
        else {
            throw error;
        }
    }
    const total = items.length;
    const slice = items.slice(request.offset, request.offset + request.limit);
    return browsePage('libraries', {
        items: slice,
        total,
        offset: request.offset,
        next: nextOffsetOf(request.offset, slice.length, total),
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
/**
 * Browse collections as real tree navigation: no `parentRef` lists
 * top-level collections (`/collections/top`), a `parentRef` lists that
 * collection's children, and both are server-side paged, so a page never
 * depends on the whole library graph. Breadcrumbs resolve lazily: each row's
 * own `parentCollection` field drives a per-key ancestor walk (TTL-cached,
 * cycle-guarded), and an ancestor the API cannot serve truncates the path
 * fail-closed instead of inventing one.
 */
async function browseCollections(deps, directory, request, signal) {
    const library = request.library ?? PERSONAL_LIBRARY;
    const prefix = libraryPrefix(library);
    let listPath = `${prefix}/collections/top`;
    if (request.parentRef !== undefined) {
        const parentRef = requireSupportedLocalRef(parseRef(request.parentRef), ['collection']);
        if (!sameLibrary(parentRef.library, library)) {
            throw new ZoteroError(parentLibraryMismatchMessage(parentRef.library, library), ZOTERO_INVALID_ARGUMENT);
        }
        listPath = `${prefix}/collections/${parentRef.key}/collections`;
    }
    const params = new URLSearchParams();
    params.set('start', String(request.offset));
    params.set('limit', String(request.limit));
    const { json, headers } = await deps.client.getJson(listPath, params, { signal });
    const serverId = headers.get(ZOTERO_SERVER_ID_HEADER) ?? undefined;
    const total = requireTotalResults(headers, 'collections');
    const rows = requireArrayBody(json, 'collections');
    // Ancestor names resolve in parallel: each row's chain is its own TTL-cached
    // walk, and a page of siblings shares most ancestors after the first fetch.
    const resolved = await Promise.all(rows.map(async (row) => {
        const entry = normalizeScopeEntry(row);
        const ancestors = await directory.collectionAncestorNames(library, entry.key, entry.parentKey, serverId, signal);
        const path = [...ancestors, entry.name];
        const info = {
            ref: formatRef(refForLibrary(library, 'collection', entry.key, serverId)),
            name: entry.name,
            ...(entry.parentKey !== undefined
                ? {
                    parentRef: formatRef(refForLibrary(library, 'collection', entry.parentKey, serverId)),
                }
                : {}),
            path,
            depth: path.length - 1,
        };
        return info;
    }));
    const items = resolved;
    // A page-local sort keeps output deterministic without re-sorting the
    // library; ordering across pages belongs to Zotero.
    items.sort((a, b) => a.name.localeCompare(b.name));
    return browsePage('collections', {
        items,
        total,
        offset: request.offset,
        // Server-paged: an in-range page with no rows contradicts the total.
        next: nextOffsetOrFail(request.offset, items.length, total, 'collections'),
        library,
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
async function browseSavedSearches(deps, request, signal) {
    const library = request.library ?? PERSONAL_LIBRARY;
    const prefix = libraryPrefix(library);
    // Browsing pages server-side and reads only its own window; scope-name
    // resolution keeps the full-listing path under the TTL cache. The two
    // acquisition strategies stay separate so a browse page never has to
    // fetch the whole library just to show `limit` rows.
    const params = new URLSearchParams();
    params.set('start', String(request.offset));
    params.set('limit', String(request.limit));
    const { json, headers } = await deps.client.getJson(`${prefix}/searches`, params, {
        signal,
    });
    const serverId = headers.get(ZOTERO_SERVER_ID_HEADER) ?? undefined;
    const rawRows = requireArrayBody(json, 'saved searches');
    const total = requireTotalResults(headers, 'saved searches');
    const entries = rawRows.map((row) => normalizeScopeEntry(row));
    const condByKey = new Map();
    for (const row of rawRows) {
        const rec = asRecord(row);
        const key = asString(rec?.key);
        if (key === undefined || !isObjectKey(key))
            continue;
        const data = asRecord(rec?.data);
        const cond = data?.conditions ?? rec?.conditions;
        // Zotero's saved-search conditions are an array of row objects; anything
        // else on the wire is treated as absence rather than passed through.
        if (Array.isArray(cond) &&
            cond.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
            condByKey.set(key, cond);
        }
    }
    const items = entries
        .map((entry) => ({
        ref: formatRef(refForLibrary(library, 'search', entry.key, serverId)),
        name: entry.name,
        ...(condByKey.has(entry.key) ? { conditions: condByKey.get(entry.key) } : {}),
    }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return browsePage('savedSearches', {
        items,
        total,
        offset: request.offset,
        next: nextOffsetOrFail(request.offset, items.length, total, 'saved searches'),
        library,
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
/**
 * Browse tags, optionally scoped: without a scope this is the
 * whole-library `/tags` listing; with a scope the scoped tag endpoints
 * count tags over a faceted item set (a collection or My Publications,
 * top-level by default or all items, optionally narrowed to items matching
 * an item query). That makes "search → which tags do these hits carry →
 * narrow" a server-side round trip instead of client-side guessing.
 */
async function browseTags(deps, directory, request, signal) {
    const library = request.library ?? PERSONAL_LIBRARY;
    const prefix = libraryPrefix(library);
    const itemsSegment = itemsSegmentFor(request.itemLevel);
    let path = `${prefix}/tags`;
    let serverIdClaim;
    if (request.scope !== undefined) {
        switch (request.scope.kind) {
            case 'library':
                path = `${prefix}/${itemsSegment}/tags`;
                break;
            case 'publications':
                assertPublicationsSupported(library);
                path = publicationsTagsPath();
                break;
            case 'collection': {
                const found = await directory.resolveNamed('collection', request.scope.refOrName, library, signal);
                serverIdClaim = found.ref.serverId;
                path = `${libraryPrefix(found.ref.library)}/collections/${found.ref.key}/${itemsSegment}/tags`;
                break;
            }
        }
    }
    const params = new URLSearchParams();
    if (request.q !== undefined && request.q !== '') {
        params.set('q', request.q);
        params.set('qmode', request.match === 'startsWith' ? 'startsWith' : 'contains');
    }
    if (request.itemQuery !== undefined && request.itemQuery !== '') {
        params.set('itemQ', request.itemQuery);
        params.set('itemQMode', request.itemQueryMode ?? 'titleCreatorYear');
    }
    params.set('start', String(request.offset));
    params.set('limit', String(request.limit));
    const { json, headers } = await deps.client.getJson(path, params, {
        signal,
        ...(serverIdClaim !== undefined ? { serverId: serverIdClaim } : {}),
    });
    const serverId = headers.get(ZOTERO_SERVER_ID_HEADER) ?? serverIdClaim;
    const rawRows = requireArrayBody(json, 'tags');
    const total = requireTotalResults(headers, 'tags');
    const items = rawRows.map((row) => {
        const rec = asRecord(row);
        const tag = asString(rec?.tag) ?? asString(asRecord(rec?.data)?.tag);
        if (tag === undefined) {
            throw new ZoteroError('Zotero returned a malformed tag row without a tag name', ZOTERO_UNEXPECTED);
        }
        const metaCount = asRecord(rec?.meta)?.numItems;
        const directCount = rec?.numItems;
        const count = typeof metaCount === 'number'
            ? metaCount
            : typeof directCount === 'number'
                ? directCount
                : undefined;
        return { tag, ...(count !== undefined ? { count } : {}) };
    });
    return browsePage('tags', {
        items,
        total,
        offset: request.offset,
        // Measured on the raw rows: a malformed row throws rather than being
        // dropped, so raw and normalized row counts agree here.
        next: nextOffsetOrFail(request.offset, rawRows.length, total, 'tags'),
        library,
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
async function browseItemTypes(deps, request, signal) {
    const { json, headers } = await deps.client.getJson('itemTypes', undefined, { signal });
    const serverId = headers.get(ZOTERO_SERVER_ID_HEADER) ?? undefined;
    const raw = requireArrayBody(json, 'item types')
        .map((row) => {
        const rec = asRecord(row);
        const it = asString(rec?.itemType) ?? asString(rec?.name);
        if (it === undefined)
            return null;
        const loc = asString(rec?.localized) ?? asString(rec?.displayName);
        return { itemType: it, ...(loc ? { localized: loc } : {}) };
    })
        .filter((x) => x !== null);
    raw.sort((a, b) => a.itemType.localeCompare(b.itemType));
    const items = raw;
    const total = items.length;
    const slice = items.slice(request.offset, request.offset + request.limit);
    return browsePage('itemTypes', {
        items: slice,
        total,
        offset: request.offset,
        // Client-sliced: a request past the end of the list is legitimate.
        next: nextOffsetOf(request.offset, slice.length, total),
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
/**
 * The metadata fields and creator types valid for one item type, with the
 * localized labels Zotero reports for the user's locale. This is the
 * schema-aware read behind `fields:"all"`: when a dataset or patent's
 * fields would be dropped by the normalized model, the model can look up
 * what exists and ask for it by name.
 */
async function browseItemFields(deps, request, signal) {
    const itemType = request.itemType;
    const params = new URLSearchParams();
    params.set('itemType', itemType);
    const [fields, creatorTypes] = await Promise.all([
        deps.client.getJson('itemTypeFields', params, { signal }),
        deps.client.getJson('itemTypeCreatorTypes', params, { signal }),
    ]);
    // Two parallel reads compose one result, so they must not straddle an
    // instance switch: the rows would be attributed to whichever answered first.
    const serverId = requireAgreedServerId(fields.headers.get(ZOTERO_SERVER_ID_HEADER), creatorTypes.headers.get(ZOTERO_SERVER_ID_HEADER));
    const fieldItems = [];
    for (const row of requireArrayBody(fields.json, 'item type fields')) {
        const rec = asRecord(row);
        const field = asString(rec?.field);
        if (field === undefined)
            continue;
        const localized = asString(rec?.localized);
        fieldItems.push({ field, ...(localized !== undefined ? { localized } : {}) });
    }
    fieldItems.sort((a, b) => a.field.localeCompare(b.field));
    const creatorTypeItems = [];
    for (const row of requireArrayBody(creatorTypes.json, 'creator types')) {
        const rec = asRecord(row);
        const creatorType = asString(rec?.creatorType);
        if (creatorType === undefined)
            continue;
        const localized = asString(rec?.localized);
        creatorTypeItems.push({ creatorType, ...(localized !== undefined ? { localized } : {}) });
    }
    creatorTypeItems.sort((a, b) => a.creatorType.localeCompare(b.creatorType));
    const items = [
        ...fieldItems,
        ...creatorTypeItems,
    ];
    const total = items.length;
    const slice = items.slice(request.offset, request.offset + request.limit);
    return browsePage('itemFields', {
        items: slice,
        total,
        offset: request.offset,
        next: nextOffsetOf(request.offset, slice.length, total),
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
//# sourceMappingURL=browse-domain.js.map