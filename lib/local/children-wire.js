/**
 * The two Local API wire contracts for child objects.
 *
 * Zotero's Local API does **not** serve annotations from a bare
 * `GET /items/{key}/children`. That endpoint is backed by the same
 * `includeChildren` search expansion as `/items`, and that expansion's SQL
 * unions only `itemAttachments` and `itemNotes`, never `itemAnnotations`.
 * Annotations hang off attachments (`itemAnnotations.parentItemID` →
 * attachment), so a bare children read of a PDF is empty even when the file
 * carries highlights.
 *
 * Annotations surface only through an explicit type filter:
 * `GET /items/{key}/children?itemType=annotation`. That path goes through
 * `buildSearchFromSearchSyntax` → `setScope(parent, true)`, and the scope
 * expansion *does* include annotations under the scope set's attachments
 * (and under top-level attachments in scope). Passing the bibliographic
 * item key therefore returns every annotation under that item's attachments
 * in one request; passing an attachment key returns that file's annotations.
 *
 * `meta.numChildren` never counts annotations either: for regular items it
 * is notes+attachments, for attachments it is hard-coded 0, so nothing in
 * this plugin may infer annotation presence from that field.
 *
 * These functions are the only child-object reads the plugin issues. The
 * listing forms are:
 * - bare `GET /items/{key}/children` — notes and attachments together;
 * - `?itemType=note` / `?itemType=attachment` — one kind, paged (the panel's
 *   offset/limit detail);
 * - `?itemType=annotation` — annotations, the only path that surfaces them.
 * Verified against Zotero 10.0.3 (`server_localAPI.js` + `xpcom/data/search.js`)
 * and live curl on 9.0.6 (issue #4).
 * @module dsh-zotero/local/children-wire
 */
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js';
import { libraryPrefix } from '../refs.js';
import { ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_LIST_PAGE_ROWS } from '../constants.js';
import { nextOffsetOrFail, readAllPages, requireArrayBody, requireTotalResults, requireLibraryVersionHeader, setPage, } from './pagination.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
/** Query that surfaces annotation rows under one key. */
const ANNOTATION_SEARCH = new URLSearchParams({ itemType: 'annotation' });
/** The wire `itemType` filter each child kind reads through. */
const CHILD_ITEM_TYPE = {
    notes: 'note',
    attachments: 'attachment',
    annotations: 'annotation',
};
/** GET one `/children` listing; a non-array body is a contract breach, not an empty page. */
async function getChildrenJson(deps, key, library, serverId, signal, search) {
    const prefix = libraryPrefix(library);
    const children = await deps.client.getJson(`${prefix}/items/${key}/children`, search, {
        signal,
        serverId,
    });
    return requireArrayBody(children.json, search === undefined ? 'item children' : 'item annotations');
}
/**
 * Direct children of one key: notes and attachments only.
 * Never annotations, which is the bare Local API contract.
 */
export async function fetchDirectChildren(deps, key, library, serverId, signal) {
    return getChildrenJson(deps, key, library, serverId, signal, undefined);
}
/**
 * Annotations under one key via `?itemType=annotation`.
 * On an attachment key this is that file's annotations; on a bibliographic
 * item key the Local API returns the annotations under every descendant
 * attachment. Provenance rides each row's `data.parentItem`.
 */
export async function fetchAnnotationChildren(deps, key, library, serverId, signal) {
    return getChildrenJson(deps, key, library, serverId, signal, ANNOTATION_SEARCH);
}
/**
 * One paged child listing: the same filtered-children wire form the bare read
 * uses, narrowed to one kind and windowed by `start`/`limit`. `limit` in the
 * answer is the page the caller asked for, so the panel can page by the
 * effective size after the detail domain clamps it to the record caps.
 */
export async function fetchChildPage(deps, request) {
    for await (const current of childPages(deps, request)) {
        return current;
    }
    throw new ZoteroError('Zotero returned no child page.', ZOTERO_UNEXPECTED);
}
/** Read every child, including trashed rows, before a versioned Trash operation. */
export async function fetchChildrenForTrash(deps, key, serverId, annotations, signal) {
    const rows = [];
    await readAllPages(deps.client, `users/0/items/${key}/children`, { includeTrashed: '1' }, serverId, signal, { body: 'children to move to Trash', page: 'children to move to Trash' }, annotations ? (params) => params.set('itemType', 'annotation') : undefined, (page) => {
        rows.push(...page);
    });
    return rows;
}
/** Sequential page source. Awaiting the consumer before advancing provides backpressure. */
export async function* childPages(deps, request) {
    const { key, library, kind, signal, window } = request;
    let offset = window?.offset ?? 0;
    let identity = request.serverId;
    let version;
    let total;
    const limit = window?.limit ?? ZOTERO_LIST_PAGE_ROWS;
    for (;;) {
        const params = new URLSearchParams();
        if (kind !== 'direct')
            params.set('itemType', CHILD_ITEM_TYPE[kind]);
        setPage(params, offset, limit);
        const response = await deps.client.getJson(`${libraryPrefix(library)}/items/${key}/children`, params, { signal, serverId: identity });
        const observed = serverIdFromHeaders(response.headers, identity);
        assertServerIdMatches(observed, identity);
        identity ??= observed;
        const currentVersion = response.headers.has(ZOTERO_LIBRARY_VERSION_HEADER)
            ? requireLibraryVersionHeader(response.headers, 'item children')
            : undefined;
        const currentTotal = requireTotalResults(response.headers, 'item children');
        if ((total !== undefined && version !== currentVersion) ||
            (total !== undefined && total !== currentTotal)) {
            throw new ZoteroError('Zotero children changed during reading; retry the read.', ZOTERO_UNEXPECTED);
        }
        version = currentVersion;
        total = currentTotal;
        const rows = requireArrayBody(response.json, 'item children');
        if (rows.length > limit || (rows.length > 0 && offset + rows.length > total)) {
            throw new ZoteroError('Zotero returned children outside the reported page.', ZOTERO_UNEXPECTED);
        }
        const nextOffset = nextOffsetOrFail(offset, rows.length, total, 'item children');
        yield {
            rows,
            total,
            offset,
            limit,
            ...(identity !== undefined ? { serverId: identity } : {}),
            ...(nextOffset !== undefined ? { nextOffset } : {}),
        };
        if (window !== undefined || nextOffset === undefined)
            return;
        offset = nextOffset;
    }
}
//# sourceMappingURL=children-wire.js.map