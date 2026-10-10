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
 * These two functions are the only child-object reads the plugin issues.
 * Verified against Zotero 10.0.3 (`server_localAPI.js` + `xpcom/data/search.js`)
 * and live curl on 9.0.6 (issue #4).
 * @module dsh-zotero/local/children-wire
 */
import { libraryPrefix } from '../refs.js';
import { requireArrayBody } from './pagination.js';
/** Query that surfaces annotation rows under one key. */
const ANNOTATION_SEARCH = new URLSearchParams({ itemType: 'annotation' });
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
//# sourceMappingURL=children-wire.js.map