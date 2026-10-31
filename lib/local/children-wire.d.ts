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
import type { ZoteroHttpClient } from '../http-client.js';
import type { SupportedLocalLibrary } from '../types.js';
/** The detail request's child kinds, in the panel's own spelling. */
export type ChildListingKind = 'notes' | 'attachments' | 'annotations';
/**
 * Direct children of one key: notes and attachments only.
 * Never annotations, which is the bare Local API contract.
 */
export declare function fetchDirectChildren(deps: {
    client: ZoteroHttpClient;
}, key: string, library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined): Promise<readonly unknown[]>;
/**
 * Annotations under one key via `?itemType=annotation`.
 * On an attachment key this is that file's annotations; on a bibliographic
 * item key the Local API returns the annotations under every descendant
 * attachment. Provenance rides each row's `data.parentItem`.
 */
export declare function fetchAnnotationChildren(deps: {
    client: ZoteroHttpClient;
}, key: string, library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined): Promise<readonly unknown[]>;
/**
 * One paged child listing: the same filtered-children wire form the bare read
 * uses, narrowed to one kind and windowed by `start`/`limit`. `limit` in the
 * answer is the page the caller asked for, so the panel can page by the
 * effective size after the detail domain clamps it to the record caps.
 */
export declare function fetchChildPage(deps: {
    client: ZoteroHttpClient;
}, kind: ChildListingKind, key: string, library: SupportedLocalLibrary, serverId: string | undefined, page: {
    offset: number;
    limit: number;
}, signal: AbortSignal | undefined): Promise<{
    rows: readonly unknown[];
    total: number;
    offset: number;
    limit: number;
    nextOffset?: number;
    serverId?: string;
}>;
/** Read every child, including trashed rows, before a versioned Trash operation. */
export declare function fetchChildrenForTrash(deps: {
    client: ZoteroHttpClient;
}, key: string, serverId: string, annotations: boolean, signal?: AbortSignal): Promise<unknown[]>;
//# sourceMappingURL=children-wire.d.ts.map