/**
 * The `zotero_browse` domain: the six bounded discovery kinds — libraries,
 * server-side collection navigation with breadcrumb walks, saved searches,
 * scoped tag facets, item types, and per-type metadata fields. Argument
 * cross-constraints fail closed at the entry before any request.
 * @module dsh-zotero/local/browse-domain
 */
import { type ScopeDirectory } from './scope-directory.js';
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroBrowseRequest, ZoteroBrowseResult } from '../types.js';
/**
 * The model-facing messages the browse argument rules throw. The rules are
 * enforced at both ends of the call — the tool's `buildRequest` and this
 * entry — so the wording lives here, with the contract, and the tool imports
 * it. The one exception is the near-identical pair below: `TAG_FACET_SCOPE`
 * and `ITEM_LEVEL_SCOPE` name the *request* fields this layer validates,
 * while the tool's own messages name the model-facing arguments (`tagScope`,
 * `tagScope`) — different readers, so deliberately different strings.
 */
/** The model-facing message for a kind outside the browse enum. */
export declare function unsupportedBrowseKindMessage(kind: string): string;
/** The model-facing message for a library argument on a kind that is global. */
export declare function libraryNotAllowedMessage(kind: string): string;
/** The model-facing message for an item type passed to a kind that takes none. */
export declare const ITEM_TYPE_SCOPE_MESSAGE = "itemType is only valid when kind=\"itemFields\"";
/** The model-facing message for the item-fields kind without a well-formed item type. */
export declare const ITEM_FIELDS_ITEM_TYPE_MESSAGE = "kind=\"itemFields\" requires a Zotero item type name (e.g. dataset, journalArticle)";
/** The model-facing message for a tag query/match on a kind that counts no tags. */
export declare const Q_MATCH_SCOPE_MESSAGE = "q/match are only valid when kind=\"tags\"";
/** The model-facing message for a match mode with no query to apply it to. */
export declare const MATCH_REQUIRES_Q_MESSAGE = "match requires q";
/** The model-facing message for a parentRef outside collection navigation. */
export declare const PARENT_REF_SCOPE_MESSAGE = "parentRef is only valid when kind=\"collections\"";
/** The model-facing message for facet fields (`scope`, `itemLevel`, `itemQuery`) on another kind. */
export declare const SCOPE_FACET_KIND_MESSAGE = "scope/itemLevel/itemQuery are only valid when kind=\"tags\"";
/** The model-facing message for facet fields with no scope to count over. */
export declare const ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE = "itemLevel/itemQuery require a scope (library, collection, or publications)";
/** The model-facing message for a collection scope that names nothing. */
export declare const SCOPE_NAME_MESSAGE = "scope.refOrName must be a non-empty string";
/** The model-facing message for a negative offset. */
export declare const OFFSET_NON_NEGATIVE_MESSAGE = "offset must be a non-negative integer";
/** The model-facing message for a limit outside the configured browse cap. */
export declare function browseLimitMessage(maxBrowseResults: number): string;
/** The model-facing message for a parentRef naming another library than the request. */
export declare function parentLibraryMismatchMessage(parentRef: {
    type: string;
    id: number;
}, library: {
    type: string;
    id: number;
}): string;
export declare function runBrowse(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, directory: ScopeDirectory, request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult>;
//# sourceMappingURL=browse-domain.d.ts.map