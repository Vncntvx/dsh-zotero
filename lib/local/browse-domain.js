/**
 * The `zotero_browse` domain: the six bounded discovery kinds (libraries,
 * server-side collection navigation with breadcrumb walks, saved searches,
 * scoped tag facets, item types, and per-type metadata fields). Argument
 * cross-constraints fail closed at the entry before any request.
 * @module dsh-zotero/local/browse-domain
 */
import { ITEM_FIELDS_ITEM_TYPE_MESSAGE, ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE, ITEM_TYPE_SCOPE_MESSAGE, MATCH_REQUIRES_Q_MESSAGE, OFFSET_NON_NEGATIVE_MESSAGE, PARENT_REF_SCOPE_MESSAGE, Q_MATCH_SCOPE_MESSAGE, SCOPE_FACET_KIND_MESSAGE, SCOPE_NAME_MESSAGE, browseLimitMessage, isNotFoundError, libraryNotAllowedMessage, parentLibraryMismatchMessage, unsupportedBrowseKindMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError, } from '../errors.js';
import { isItemTypeIdentifier } from '../ref-grammar.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { asRecord, asString, isObjectKey } from '../json.js';
import { normalizeSavedSearchConditions } from '../normalize-saved-search.js';
import { normalizeScopeEntry } from '../normalize-scope.js';
import { assertPublicationsSupported, isRefString, libraryPrefix, parseRef, refStringFor, requireSupportedLocalRef, sameLibrary, PERSONAL_GROUPS_DISCOVERY, PERSONAL_LIBRARY, } from '../refs.js';
import { nextOffsetOf, nextOffsetOrFail, requireArrayBody, requireLibraryVersionHeader, requireTotalResults, setPage, } from './pagination.js';
import { itemsSegmentFor, publicationsTagsPath } from './scope-paths.js';
export async function runBrowse(deps, directory, itemSchema, request, signal) {
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
        if (request.itemType === undefined || !isItemTypeIdentifier(request.itemType)) {
            throw new ZoteroError(ITEM_FIELDS_ITEM_TYPE_MESSAGE, ZOTERO_INVALID_ARGUMENT);
        }
        return await browseItemFields(itemSchema, request, signal);
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
            return await browseItemTypes(itemSchema, request, signal);
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
        ...(page.libraryVersion !== undefined ? { libraryVersion: page.libraryVersion } : {}),
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
        serverId = serverIdFromHeaders(headers);
        const groups = requireArrayBody(json, 'groups');
        for (const row of groups) {
            // Zotero serializes each group as `{ id, version, links, meta, data: {
            // id, version, name, description } }` — `Zotero.Group.prototype
            // .toResponseJSON` under the local API's `includeGroupDetails`, verified
            // against the Zotero 10 bundle (app/omni.ja →
            // chrome/content/zotero/xpcom/data/group.js). The id is read from the
            // top level and the name from the inner `data` block, the two places the
            // serializer puts them. No other spelling is read: an unrecognized row
            // is skipped rather than guessed at, so a future shape change fails
            // loudly instead of silently mislabelling a library.
            const rec = asRecord(row);
            const idRaw = rec?.id;
            const name = asString(rec?.name) ?? asString(asRecord(rec?.data)?.name) ?? '';
            const id = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : undefined;
            if (id === undefined || !Number.isInteger(id) || id <= 0)
                continue;
            items.push({ library: { type: 'group', id }, name: name || `Group ${id}` });
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
    // A qualified parent ref sets the identity for the whole child request
    // chain. The provider's current session identity may point at a different
    // Zotero profile, so the HTTP client does not choose it.
    let parentServerId;
    if (request.parentRef !== undefined) {
        const parentRef = requireSupportedLocalRef(parseRef(request.parentRef), ['collection']);
        if (!sameLibrary(parentRef.library, library)) {
            throw new ZoteroError(parentLibraryMismatchMessage(parentRef.library, library), ZOTERO_INVALID_ARGUMENT);
        }
        listPath = `${prefix}/collections/${parentRef.key}/collections`;
        parentServerId = parentRef.serverId;
    }
    const params = new URLSearchParams();
    setPage(params, request.offset, request.limit);
    const { json, headers } = await deps.client.getJson(listPath, params, {
        signal,
        ...(parentServerId !== undefined ? { serverId: parentServerId } : {}),
    });
    const observedServerId = serverIdFromHeaders(headers);
    assertServerIdMatches(observedServerId, parentServerId);
    // Headerless responses are still attributable to a qualified parent ref.
    const serverId = observedServerId ?? parentServerId;
    const total = requireTotalResults(headers, 'collections');
    const rows = requireArrayBody(json, 'collections');
    // Ancestor names resolve in parallel: each row's chain is its own TTL-cached
    // walk, and a page of siblings shares most ancestors after the first fetch.
    const resolved = await Promise.all(rows.map(async (row) => {
        const entry = normalizeScopeEntry(row);
        const ancestors = await directory.collectionAncestorNames(library, entry.key, entry.parentKey, serverId, signal);
        const path = [...ancestors, entry.name];
        const info = {
            ref: refStringFor(library, 'collection', entry.key, serverId),
            name: entry.name,
            ...(entry.parentKey !== undefined
                ? {
                    parentRef: refStringFor(library, 'collection', entry.parentKey, serverId),
                }
                : {}),
            path,
            depth: path.length - 1,
            ...(entry.childCount !== undefined ? { childCount: entry.childCount } : {}),
            ...(entry.itemCount !== undefined ? { itemCount: entry.itemCount } : {}),
        };
        return info;
    }));
    const items = resolved;
    // Ordering belongs to Zotero: its data layer already name-collates the top
    // listing (`Zotero.Collections.getByLibrary` sorts by `localeCompare`), and
    // a page-local re-sort of a server-paged window would order each page
    // internally while scrambling the sequence across pages.
    return browsePage('collections', {
        libraryVersion: requireLibraryVersionHeader(headers, 'collections'),
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
    setPage(params, request.offset, request.limit);
    const { json, headers } = await deps.client.getJson(`${prefix}/searches`, params, {
        signal,
    });
    const serverId = serverIdFromHeaders(headers);
    const rawRows = requireArrayBody(json, 'saved searches');
    const total = requireTotalResults(headers, 'saved searches');
    const entries = [];
    const condByKey = new Map();
    for (const row of rawRows) {
        entries.push(normalizeScopeEntry(row));
        const rec = asRecord(row);
        const key = asString(rec?.key);
        if (key === undefined || !isObjectKey(key))
            continue;
        const data = asRecord(rec?.data);
        const cond = data?.conditions ?? rec?.conditions;
        if (cond === undefined)
            continue;
        const conditions = normalizeSavedSearchConditions(cond);
        if (conditions === undefined) {
            throw new ZoteroError(`Zotero returned malformed saved-search conditions for ${key}`, ZOTERO_UNEXPECTED);
        }
        condByKey.set(key, conditions);
    }
    const items = entries.map((entry) => ({
        ref: refStringFor(library, 'search', entry.key, serverId),
        name: entry.name,
        ...(condByKey.has(entry.key) ? { conditions: condByKey.get(entry.key) } : {}),
    }));
    // Ordering belongs to Zotero: `Zotero.Searches.getAll` name-collates the
    // listing, and a page-local re-sort of a server-paged window would order
    // each page internally while scrambling the sequence across pages.
    return browsePage('savedSearches', {
        libraryVersion: requireLibraryVersionHeader(headers, 'saved searches'),
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
    setPage(params, request.offset, request.limit);
    const { json, headers } = await deps.client.getJson(path, params, {
        signal,
        ...(serverIdClaim !== undefined ? { serverId: serverIdClaim } : {}),
    });
    const serverId = serverIdFromHeaders(headers, serverIdClaim);
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
async function browseItemTypes(itemSchema, request, signal) {
    const { items, serverId } = await itemSchema.getItemTypes(signal);
    return clientSlicedPage('itemTypes', items, request, serverId);
}
/**
 * The metadata fields and creator types valid for one item type, with the
 * localized labels Zotero reports for the user's locale. This is the
 * schema-aware read behind `fields:"all"`: when a dataset or patent's
 * fields would be dropped by the normalized model, the model can look up
 * what exists and ask for it by name.
 */
async function browseItemFields(itemSchema, request, signal) {
    const { items, serverId } = await itemSchema.getItemFields(request.itemType, signal);
    return clientSlicedPage('itemFields', items, request, serverId);
}
/**
 * The client-sliced tail shared by the catalog listings: the whole list is in
 * memory, so pagination is slicing, and a request past the end is legitimate
 * (unlike a server-paged page, where it would contradict the total).
 */
function clientSlicedPage(kind, items, request, serverId) {
    const slice = items.slice(request.offset, request.offset + request.limit);
    return browsePage(kind, {
        items: slice,
        total: items.length,
        offset: request.offset,
        // Client-sliced: a request past the end of the list is legitimate.
        next: nextOffsetOf(request.offset, slice.length, items.length),
        ...(serverId !== undefined ? { serverId } : {}),
    });
}
//# sourceMappingURL=browse-domain.js.map