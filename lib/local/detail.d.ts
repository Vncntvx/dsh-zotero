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
import type { SupportedLocalLibrary, ZoteroChildrenRequest, ZoteroChildrenResult, ZoteroGetRequest, ZoteroItemDetail } from '../types.js';
/** Which child-object halves a read must fetch. */
export interface ChildRowNeeds {
    /** Bare `/children` — notes and attachments. */
    readonly direct: boolean;
    /** `/children?itemType=annotation` — annotations under this key. */
    readonly annotations: boolean;
}
/**
 * The model-facing message for an attachment ref whose target is another item
 * type. Annotations hang off attachments, so the model has to re-aim the ref.
 */
export declare function attachmentTargetKindMessage(itemType: string): string;
/**
 * Fetch one item's full detail. The parent is always fetched once; child
 * rows are fetched lazily only when the caller asked to include
 * notes/annotations/attachments — the Local API ignores `?include=` on
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
 * One key's child rows for get/retrieve/children. Each half of the request
 * rides its own wire contract; both may run in parallel. The direct row
 * count rides along so a detail's `children.total` stays honest after
 * annotation rows are merged in.
 */
export declare function loadChildRows(deps: {
    client: ZoteroHttpClient;
}, key: string, library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined, needs: ChildRowNeeds): Promise<{
    readonly rows: readonly unknown[];
    readonly directCount: number;
}>;
//# sourceMappingURL=detail.d.ts.map