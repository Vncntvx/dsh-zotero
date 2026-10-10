/**
 * Runtime constants of the Zotero domain. Kept out of `types.ts` so that
 * module stays types-only. `ZOTERO_SORT_FIELDS` is typed against the
 * `ZoteroSortField` union in `types.ts`, so the two cannot drift: the
 * typecheck rejects a field absent from the union and a union member absent
 * from the array; `tests/unit/refs.spec.ts` additionally pins the exact array
 * because the search tool's `sort` enum derives from it.
 * @module dsh-zotero/constants
 */
import type { ZoteroSortField } from './types.js';
/** The id the built-in local provider registers under; also the provider config default. */
export declare const LOCAL_PROVIDER_ID = "local";
/**
 * The Local API version this plugin speaks, sent as `Zotero-API-Version` on
 * every request. Zotero 10 implements version 3 and answers another value
 * with 501; the plugin names this version in its errors rather than
 * repeating the literal.
 */
export declare const ZOTERO_LOCAL_API_VERSION = "3";
/** The response header naming the Local API version the answering build speaks. */
export declare const ZOTERO_API_VERSION_HEADER = "zotero-api-version";
/** The Local API response/request header carrying the serving instance identity. */
export declare const ZOTERO_SERVER_ID_HEADER = "zotero-server-id";
/**
 * The header naming the answering Zotero build (`10.0.2-beta.9+c77df79af`).
 * Sent on every response, errors included, and the only one of the three
 * version headers that distinguishes releases: `Zotero-API-Version` is 3 on
 * every build that speaks API v3, and `Zotero-Schema-Version` moves with
 * Zotero's data schema rather than with the release.
 */
export declare const ZOTERO_VERSION_HEADER = "x-zotero-version";
/** The response header naming Zotero's data schema version. */
export declare const ZOTERO_SCHEMA_VERSION_HEADER = "zotero-schema-version";
/** The response header carrying the total result count for paginated listings. */
export declare const ZOTERO_TOTAL_RESULTS_HEADER = "total-results";
/** The response header specifying seconds to wait after a rate limit or server busy. */
export declare const ZOTERO_RETRY_AFTER_HEADER = "retry-after";
/** The sort fields `zotero_search` accepts, in Zotero's own vocabulary. */
export declare const ZOTERO_SORT_FIELDS: readonly ZoteroSortField[];
/** `zotero_search` argument defaults; the tool and the corpus's pagination-fold identity share them. */
export declare const SEARCH_DEFAULT_MODE = "metadata";
export declare const SEARCH_DEFAULT_SCOPE: {
    readonly kind: "library";
};
export declare const SEARCH_DEFAULT_SORT = "dateModified";
export declare const SEARCH_DEFAULT_DIRECTION = "desc";
export declare const SEARCH_DEFAULT_OFFSET = 0;
export declare const SEARCH_DEFAULT_LIMIT = 10;
/**
 * The Local API's hard per-request cap for the `itemKey=` query parameter.
 * `zotero_export` batches citation requests to this size; the batch-breaking
 * formats (bibliography and the translators) refuse to exceed it, because
 * their global ordering belongs to Zotero, not to the caller.
 */
export declare const ZOTERO_ITEMKEY_BATCH = 50;
/**
 * The write transport keeps exactly one request in flight. Zotero stamps the
 * library version per committed object, and the plugin's tag/collection
 * updates are read-modify-write cycles, where an overlapping write could
 * interleave with another call's read and make both sides lose their version
 * preconditions. Serialization is the point, not a tuning knob.
 */
export declare const ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS = 1;
/**
 * The Local API's hard cap on objects per write batch (`MAX_WRITE_OBJECTS`,
 * `server_localAPI.js:95` at Zotero 10.0.2). The write tools enforce the same
 * number at runtime (`assertWriteList` / `assertAddRemoveSelection`, because
 * the bound is configurable and therefore cannot ride the static schemas),
 * and the write domain refuses a longer batch before the network, so a 413
 * from Zotero can only mean protocol drift.
 */
export declare const ZOTERO_WRITE_OBJECT_BATCH = 50;
/**
 * The write-response header carrying the library version a write advanced
 * to (`Last-Modified-Version`). Zotero stamps written objects with that same
 * library version, so it doubles as the written object's version.
 */
export declare const ZOTERO_LIBRARY_VERSION_HEADER = "last-modified-version";
/**
 * The eight personal-library write tools. One list for the capability
 * surface, the model-facing policy, and the shell-write detector's audit
 * copy, so a rename or a ninth write tool must not leave any of those three
 * telling the user a different set.
 */
export declare const ZOTERO_WRITE_TOOL_NAMES: readonly ["zotero_create_note", "zotero_update_item_tags", "zotero_update_item_collections", "zotero_create_collection", "zotero_delete_collection", "zotero_create_item", "zotero_update_item", "zotero_delete_library_tags"];
/**
 * The eight read tools, in ZoteroService registration order (export and
 * zotero_changes register unconditionally; only their run_in_background
 * parameter waits on the jobs service).
 */
export declare const ZOTERO_READ_TOOL_NAMES: readonly ["zotero_search", "zotero_get", "zotero_children", "zotero_attachment", "zotero_retrieve", "zotero_browse", "zotero_export", "zotero_changes"];
/** Every tool the plugin can register, reads and writes together. */
export declare const ZOTERO_TOOL_NAMES: readonly ["zotero_search", "zotero_get", "zotero_children", "zotero_attachment", "zotero_retrieve", "zotero_browse", "zotero_export", "zotero_changes", "zotero_create_note", "zotero_update_item_tags", "zotero_update_item_collections", "zotero_create_collection", "zotero_delete_collection", "zotero_create_item", "zotero_update_item", "zotero_delete_library_tags"];
/**
 * The Local API path that exists only to issue write keys. The write
 * transport joins it onto `/api/`; the shell-write detector matches the same
 * spelling in command text so both sides recognize one endpoint.
 */
export declare const ZOTERO_AUTHORIZE_PATH = "local/authorize";
//# sourceMappingURL=constants.d.ts.map