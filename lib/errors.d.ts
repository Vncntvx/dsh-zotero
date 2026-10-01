/** Stable error classes and codes for the Zotero domain. @module dsh-zotero/errors */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Zotero is not reachable on its local port. */
export declare const ZOTERO_NOT_RUNNING = "ZOTERO_NOT_RUNNING";
/** Zotero runs but the local API is disabled in its preferences. */
export declare const ZOTERO_API_DISABLED = "ZOTERO_API_DISABLED";
/** The running Zotero speaks an unsupported API version. */
export declare const ZOTERO_API_VERSION = "ZOTERO_API_VERSION";
/** Zotero's local API does not implement the request, without a version mismatch (501). */
export declare const ZOTERO_NOT_IMPLEMENTED = "ZOTERO_NOT_IMPLEMENTED";
/** A ref names a Zotero instance other than the one currently served. */
export declare const ZOTERO_SERVER_MISMATCH = "ZOTERO_SERVER_MISMATCH";
/** The referenced item, collection, or saved search does not exist. */
export declare const ZOTERO_NOT_FOUND = "ZOTERO_NOT_FOUND";
/** The server does not keep change history back to the requested version (409). */
export declare const ZOTERO_RANGE_UNSUPPORTED = "ZOTERO_RANGE_UNSUPPORTED";
/** The item has no attachment of the requested kind. */
export declare const ZOTERO_NO_ATTACHMENT = "ZOTERO_NO_ATTACHMENT";
/** The attachment has no indexed full text. */
export declare const ZOTERO_NO_FULLTEXT = "ZOTERO_NO_FULLTEXT";
/** Zotero reports a local file that is missing from disk. */
export declare const ZOTERO_FILE_MISSING = "ZOTERO_FILE_MISSING";
/** A ref string does not match the zotero:// grammar or names an unsupported library. */
export declare const ZOTERO_INVALID_REF = "ZOTERO_INVALID_REF";
/** An argument the schema cannot express violates a domain constraint. */
export declare const ZOTERO_INVALID_ARGUMENT = "ZOTERO_INVALID_ARGUMENT";
/** A collection or saved-search name matches more than one object. */
export declare const ZOTERO_SCOPE_AMBIGUOUS = "ZOTERO_SCOPE_AMBIGUOUS";
/** The provider's own deadline elapsed; caller cancellation is preserved separately. */
export declare const ZOTERO_TIMEOUT = "ZOTERO_TIMEOUT";
/** A response exceeded the acquisition/resource bound while streaming. */
export declare const ZOTERO_RESPONSE_TOO_LARGE = "ZOTERO_RESPONSE_TOO_LARGE";
/** Export output exceeded the provider hard limit; never mid-truncated. */
export declare const ZOTERO_OUTPUT_TOO_LARGE = "ZOTERO_OUTPUT_TOO_LARGE";
/** The selected provider does not declare the required capability. */
export declare const ZOTERO_CAPABILITY_UNAVAILABLE = "ZOTERO_CAPABILITY_UNAVAILABLE";
/** The configured provider is not registered. */
export declare const ZOTERO_PROVIDER_UNAVAILABLE = "ZOTERO_PROVIDER_UNAVAILABLE";
/** A response could not be parsed or behaved unexpectedly. */
export declare const ZOTERO_UNEXPECTED = "ZOTERO_UNEXPECTED";
/** Zotero refused a write for lack of a valid local API key (401), including a declined authorization dialog. */
export declare const ZOTERO_WRITE_UNAUTHORIZED = "ZOTERO_WRITE_UNAUTHORIZED";
/** The object moved between the read backing the write and the write itself (412). */
export declare const ZOTERO_WRITE_CONFLICT = "ZOTERO_WRITE_CONFLICT";
/** Zotero is rate-limiting write authorization requests (429 on the authorize endpoint). */
export declare const ZOTERO_WRITE_RATE_LIMITED = "ZOTERO_WRITE_RATE_LIMITED";
/**
 * Plan-review could not be asked: no user-questions channel, or the ask
 * failed for a reason that is not a user decision. Distinct from
 * `ZOTERO_WRITE_UNAUTHORIZED` (Zotero write auth) and from the non-error
 * `declined` outcome (the user answered without approving).
 */
export declare const ZOTERO_WRITE_APPROVAL_UNAVAILABLE = "ZOTERO_WRITE_APPROVAL_UNAVAILABLE";
declare const ZOTERO_ERROR_CODES: readonly ["ZOTERO_NOT_RUNNING", "ZOTERO_API_DISABLED", "ZOTERO_API_VERSION", "ZOTERO_NOT_IMPLEMENTED", "ZOTERO_SERVER_MISMATCH", "ZOTERO_NOT_FOUND", "ZOTERO_RANGE_UNSUPPORTED", "ZOTERO_NO_ATTACHMENT", "ZOTERO_NO_FULLTEXT", "ZOTERO_FILE_MISSING", "ZOTERO_INVALID_REF", "ZOTERO_INVALID_ARGUMENT", "ZOTERO_SCOPE_AMBIGUOUS", "ZOTERO_TIMEOUT", "ZOTERO_RESPONSE_TOO_LARGE", "ZOTERO_OUTPUT_TOO_LARGE", "ZOTERO_CAPABILITY_UNAVAILABLE", "ZOTERO_PROVIDER_UNAVAILABLE", "ZOTERO_UNEXPECTED", "ZOTERO_WRITE_UNAUTHORIZED", "ZOTERO_WRITE_CONFLICT", "ZOTERO_WRITE_RATE_LIMITED", "ZOTERO_WRITE_APPROVAL_UNAVAILABLE"];
/** Every stable error code a `ZoteroError` may carry. */
export type ZoteroErrorCode = (typeof ZOTERO_ERROR_CODES)[number];
/**
 * Domain failure with a stable machine-routable code and an actionable,
 * model-facing message. The tool registry renders it as `Error: <message>`
 * with `isError: true`; messages may carry domain facts such as a status
 * code, but never raw HTTP internals (bodies, headers, engine text).
 */
export declare class ZoteroError extends HarnessError {
    readonly code: ZoteroErrorCode;
    constructor(message: string, code: ZoteroErrorCode, options?: ErrorOptions);
}
/** Shown when Zotero cannot be reached at all. */
export declare const NOT_RUNNING_MESSAGE: string;
/** Shown when Zotero runs but rejects the local API request. */
export declare const API_DISABLED_MESSAGE: string;
/** Shown when a ref's provenance no longer matches the running instance. */
export declare const SERVER_MISMATCH_MESSAGE: string;
/** Shown when an attachment has no indexed full text. */
export declare const NO_FULLTEXT_MESSAGE: string;
/**
 * Shown when the caller cancels a tool call. The plugin reports cancellation
 * as the harness's own `TOOL_ABORTED`, so the wording is the harness's; it is
 * spelled once here because three transports — the ask gate and both halves of
 * the HTTP client — have to raise the identical error.
 */
export declare const TOOL_ABORTED_MESSAGE = "tool call aborted";
/**
 * Shown when Zotero refuses a version range it cannot reach back to. Zotero's
 * own sync client reads a 409 on a versioned read as "the delete log does not
 * go back that far", i.e. a fact about the range rather than a fault.
 */
export declare const RANGE_UNSUPPORTED_MESSAGE: string;
/** Shown when Zotero refuses a write for lack of a valid local API key (401); the plugin is about to re-authorize. */
export declare const WRITE_UNAUTHORIZED_MESSAGE: string;
/** Shown when a write still fails after a fresh authorization ran. */
export declare const WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE: string;
/** Shown when the user declines the Zotero authorization dialog. */
export declare const WRITE_AUTH_DENIED_MESSAGE: string;
/** Shown when the object moved between the read backing a write and the write itself. */
export declare const WRITE_CONFLICT_MESSAGE: string;
/** Shown when Zotero answers a write with 428: the plugin always sends both preconditions on writes. */
export declare const WRITE_PRECONDITION_REFUSED_MESSAGE: string;
/** Shown when Zotero answers a write batch with 413: the plugin caps batches at the protocol limit. */
export declare const WRITE_BATCH_REFUSED_MESSAGE: string;
/** Shown when a write response lacks the library-version header Zotero documents on writes. */
export declare const WRITE_LIBRARY_VERSION_MISSING_MESSAGE: string;
/** Shown when the authorization response does not carry the documented key grant. */
export declare const WRITE_AUTH_SHAPE_MESSAGE: string;
/** Shown when a write is attempted before any read established the Zotero instance id. */
export declare const WRITE_IDENTITY_MISSING_MESSAGE = "A write was attempted before any read established the Zotero instance id.";
/** Shown when Zotero answers a write with an outcome bucket that does not match the documented shape. */
export declare function writeBatchShapeMessage(bucket: string): string;
/** Shown when Zotero rate-limits write authorizations; `waitSeconds` rides Retry-After when sent. */
export declare function writeRateLimitedMessage(waitSeconds: number | undefined): string;
/** Shown when the connected Zotero build reports no instance id, which local writes require. */
export declare const WRITE_IDENTITY_UNSUPPORTED_MESSAGE = "The connected Zotero build does not report an instance id (Zotero-Server-ID). Writing requires Zotero 10 or newer.";
/** Shown when a successful write response omits the instance id required by the protocol. */
export declare const WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE = "Zotero accepted the write but did not report the serving instance id; the response does not match the documented write shape.";
/** Shown when a read backing a write does not carry the object version the precondition needs. */
export declare const WRITE_VERSION_MISSING_MESSAGE = "Zotero answered the read without the object version a write precondition needs; the response does not match the documented shape.";
/**
 * Shown when a read backing a write does not carry the library version the
 * write's delete precondition derives from. Generic on purpose — several
 * writes read one row (or one object) only for that header.
 */
export declare const WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE = "Zotero answered a write precondition read without the library version; the response does not match the documented shape.";
/** Shown when a read backing a write does not carry the item type the field check needs. */
export declare const WRITE_ITEM_TYPE_MISSING_MESSAGE = "Zotero answered the item read without an itemType; the field set this write is allowed to touch cannot be established.";
/** Shown when a read cannot prove the array state a whole-array PATCH must preserve. */
export declare function writeObjectStateMissingMessage(field: 'tags' | 'collections'): string;
/** Shown when a direct write request carries blank text the tool schema cannot express. */
export declare function writeNonBlankMessage(name: string): string;
/** Shown when collections are requested for a child note, which inherits its parent item's collections. */
export declare const WRITE_CHILD_COLLECTIONS_MESSAGE = "A child note inherits the collections of its parent item; pass collections only for a standalone note.";
/** Shown when a write ref names a library the plugin refuses to write to. */
export declare function writeLibraryUnsupportedMessage(library: {
    type: string;
    id: number;
}): string;
/** Shown when one creator entry of an item create names no usable name fields. */
export declare function writeCreatorNameMessage(index: number): string;
/** Shown when an update field is outside the closed set of updatable fields. */
export declare function writeFieldNotUpdatableMessage(field: string): string;
/** Shown when Zotero refuses one object of a write batch, with Zotero's own statement. */
export declare function writeObjectRefusedMessage(message: string, status: number): string;
/** Shown when one note's markdown exceeds the character bound. */
export declare function writeNoteTooLongMessage(maxChars: number): string;
/** Shown when a write tool's list argument exceeds its bound. */
export declare function writeListTooLongMessage(name: string, maxItems: number): string;
/** Shown when a write tool's list argument is empty when at least one item is required. */
export declare function writeListEmptyMessage(name: string): string;
/** Shown when an update tool's add/remove selection carries nothing to change. */
export declare const WRITE_LIST_SELECTION_MESSAGE = "add and remove must carry at least one entry between them; a call that changes nothing is refused.";
/** Shown when a collection name already exists among the target siblings. */
export declare function writeCollectionNameExistsMessage(name: string): string;
/** Shown when an item type is outside the closed creation whitelist. */
export declare function writeItemTypeUnsupportedMessage(itemType: string): string;
/** Shown when item creation carries neither a title nor a URL. */
export declare const WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE = "A new item needs at least a title or a URL; both are missing.";
/** Shown when an update field is not valid for the item's type. */
export declare function writeFieldNotForItemTypeMessage(field: string, itemType: string): string;
/** Shown when a library-tags delete names more tags than one request may carry. */
export declare function writeTagDeleteLimitMessage(limit: number, detail: string): string;
/** Shown when My Publications is requested for a group library. */
export declare const PUBLICATIONS_GROUP_UNSUPPORTED_MESSAGE = "My Publications scope is only valid for personal libraries.";
/**
 * Shown when the approval gate or plan-review could not be asked at all (no
 * channel, or the ask failed for a non-user reason). Writes fail closed. This
 * is not a user decline (`kind: "declined"`) and not Zotero write auth
 * (`ZOTERO_WRITE_UNAUTHORIZED`).
 */
export declare const WRITE_APPROVAL_UNAVAILABLE_MESSAGE: string;
/** Render any thrown value's message; non-Error values fall back to String(). */
export declare function errorMessageOf(error: unknown): string;
/** The error's chained cause, or the error itself when it has no cause. */
export declare function errorCauseOf(error: unknown): unknown;
/**
 * The Errno-style code of an error's cause chain, when one exists.
 *
 * Skips a `HarnessError`/`ZoteroError`'s own domain `code` (e.g.
 * `ZOTERO_TIMEOUT`) so a wrapped transport failure still surfaces its
 * underlying errno (`ETIMEDOUT`, `ECONNREFUSED`, …).
 */
export declare function errnoCodeOf(error: unknown): string | undefined;
/** True for a translated 404 domain error, which specific endpoints reinterpret. */
export declare function isNotFoundError(error: unknown): boolean;
/** True for a translated 409: the server cannot serve the requested version range. */
export declare function isRangeUnsupportedError(error: unknown): boolean;
/** True when an error's cause carries a network code meaning the Zotero instance is unreachable. */
export declare function isUnreachableCause(error: unknown): boolean;
export {};
//# sourceMappingURL=errors.d.ts.map