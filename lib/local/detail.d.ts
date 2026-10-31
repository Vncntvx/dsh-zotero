/**
 * The `zotero_get` and `zotero_children` domain: one item's detail with its
 * lazily loaded child rows, and child-object exploration. Child rows are
 * shared with retrieve.
 *
 * Child objects ride two distinct Local API wire contracts
 * ({@link ./children-wire.ts}): a bare `/children` listing is notes and
 * attachments only; annotations appear solely under
 * `/children?itemType=annotation`. Callers name which halves they need.
 * @module dsh-zotero/local/detail
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { ScopeDirectory } from './scope-directory.js';
import type { LocalApiLimits } from './limits.js';
import type { SupportedLocalLibrary, ZoteroChildPage, ZoteroChildPageRequest, ZoteroChildrenRequest, ZoteroChildrenResult, ZoteroGetRequest, ZoteroInclude, ZoteroItemDetail } from '../types.js';
/** Which child-object halves a read must fetch. */
interface ChildRowNeeds {
    /** Bare `/children`: notes and attachments. */
    readonly direct: boolean;
    /** `/children?itemType=annotation`: annotations under this key. */
    readonly annotations: boolean;
}
/**
 * The model-facing message for an attachment ref whose target is another item
 * type. Annotations hang off attachments, so the model has to re-aim the ref.
 */
export declare function attachmentTargetKindMessage(itemType: string): string;
/**
 * Validate and clamp one child-listing page window to the kind's record cap.
 * The detail read and the dedicated child-page read share this rule, so a
 * page the panel pages by is the page the host actually serves.
 */
export declare function childPageWindowOf(request: {
    readonly kind: ZoteroInclude;
    readonly offset: number;
    readonly limit: number;
}, limits: Pick<LocalApiLimits, 'maxNoteRecords' | 'maxAttachmentRecords' | 'maxAnnotationRecords'>): {
    offset: number;
    limit: number;
};
/**
 * Fetch one item's full detail. The parent is always fetched once; child
 * rows are fetched lazily only when the caller asked to include
 * notes/annotations/attachments, since the Local API ignores `?include=` on
 * single-item responses. Direct children (notes/attachments) come from the
 * bare `/children` endpoint; annotations additionally require the
 * `?itemType=annotation` listing under the same key. Collection names
 * resolve from a cached full listing only when the item belongs to
 * collections.
 */
export declare function getItem(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, directory: ScopeDirectory, request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>;
/**
 * Explore one item's or attachment's child-object graph. An item ref yields
 * the requested direct notes/attachments and, when asked, annotations under
 * the item (one filtered children listing); an attachment ref yields that
 * file's annotations. The target row is always fetched first so the whole
 * result pins to one Server-ID and a non-attachment target of an attachment
 * ref fails with a typed error.
 */
export declare function children(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroChildrenRequest, signal?: AbortSignal): Promise<ZoteroChildrenResult>;
/**
 * Read one page of a single child kind without re-reading the parent item or
 * its collection names. An attachment ref serves annotations only and is
 * validated against its target row; an item ref reads the child listing
 * directly, proving the parent exists only when the first page is empty (so a
 * deleted item still yields the typed 404 instead of a silent empty page).
 */
export declare function getChildPage(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroChildPageRequest, signal?: AbortSignal): Promise<ZoteroChildPage>;
/**
 * One key's child rows for get/retrieve/children. Each half of the request
 * rides its own wire contract; both may run in parallel. The direct row
 * count rides along so a detail's `children.total` stays honest after
 * annotation rows are merged in.
 */
export declare function loadChildRows(deps: {
    client: ZoteroHttpClient;
}, key: string, library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined, needs: ChildRowNeeds): Promise<{
    readonly rows: readonly unknown[];
    readonly directCount?: number;
}>;
export {};
//# sourceMappingURL=detail.d.ts.map