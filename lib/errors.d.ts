export * from './error-codes.js';
import { type ZoteroErrorCode } from './error-codes.js';
/** Stable error classes and codes for the Zotero domain. @module dsh-zotero/errors */
import { HarnessError } from '@deepseek-ai/dsh-error';
import type { RemoteErrorCode } from '@deepseek-ai/dsh-typert-protocol';
import type { ZoteroBatchItemsResult, ZoteroWriteCommittedUnverified } from './types.js';
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
/**
 * Options for constructing a `ZoteroWriteCommitUnknownError`.
 * Carries any verified completed refs, unverified refs, and structured partial results.
 */
export interface ZoteroWriteCommitUnknownOptions extends ErrorOptions {
    readonly completedRefs?: readonly string[];
    readonly unverifiedRefs?: readonly string[];
    readonly partial?: ZoteroBatchItemsResult;
    readonly receipt?: ZoteroWriteCommittedUnverified;
}
/**
 * A write request that reached the response/commit boundary but whose
 * outcome could not be proven. Callers that create non-idempotent objects
 * must surface this as a non-retryable, commit-unknown result rather than
 * inviting a second write.
 *
 * The envelope wraps any settled transport failure, so its code is the
 * wrapped error's own (a Zotero domain code, or the harness `TOOL_ABORTED`
 * when a caller cancellation landed after dispatch); the class identity
 * carries the commit-state marking.
 */
export declare class ZoteroWriteCommitUnknownError extends HarnessError {
    readonly completedRefs?: readonly string[];
    readonly unverifiedRefs?: readonly string[];
    readonly partial?: ZoteroBatchItemsResult;
    readonly receipt?: ZoteroWriteCommittedUnverified;
    constructor(message: string, code: string, options?: ZoteroWriteCommitUnknownOptions);
}
/**
 * Throw a tool argument error for a constraint the parameter schema cannot
 * express. Tool bodies reject with the harness's own `ToolArgsError`
 * (`INVALID_ARGS`): the registry renders it as an argument refusal, which is
 * what a write tool's hand check is.
 * @param message - the model-facing argument error text.
 * @throws {ToolArgsError} `INVALID_ARGS`.
 */
export declare function invalidArgs(message: string): never;
/**
 * Throw a domain-level argument error for a layer the tool boundary does not
 * own: endpoint handlers and the shared domain request builders keep the
 * stable `ZOTERO_INVALID_ARGUMENT` code so a failure crossing the wire keeps
 * its domain identity.
 * @param message - the model-facing argument error text.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT`.
 */
export declare function invalid(message: string): never;
/** Setting checkbox label in Zotero Preferences -> Advanced -> Allow other applications... */
export declare const ZOTERO_ALLOW_OTHER_APPLICATIONS_HINT = "Allow other applications on this computer to communicate with Zotero";
/** Shown when Zotero cannot be reached at all. */
export declare const NOT_RUNNING_MESSAGE: string;
/** Shown when Zotero runs but rejects the local API request. */
export declare const API_DISABLED_MESSAGE: string;
/** Shown when a ref's provenance no longer matches the running instance. */
export declare const SERVER_MISMATCH_MESSAGE: string;
/** Shown when an attachment has no indexed full text. */
export declare const NO_FULLTEXT_MESSAGE: string;
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
 * write's delete precondition derives from. It is generic on purpose: several
 * writes read one row (or one object) only for that header.
 */
export declare const WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE = "Zotero answered a write precondition read without the library version; the response does not match the documented shape.";
/** Shown when a read backing a write does not carry the item type the field check needs. */
export declare const WRITE_ITEM_TYPE_MISSING_MESSAGE = "Zotero answered the item read without an itemType; the field set this write is allowed to touch cannot be established.";
/** Shown when a read cannot prove the array state a whole-array PATCH must preserve. */
export declare function writeObjectStateMissingMessage(field: 'tags' | 'collections'): string;
/** Shown when a direct write request carries blank text the tool schema cannot express. */
export declare function writeNonBlankMessage(name: string): string;
/**
 * Trim a required free-text value, refusing a blank one with `name`'s
 * message. Both the tool end and the domain end of a write call guard the
 * same arguments, so the rule lives with its message and both import it. Two
 * implementations would be two wordings waiting to drift.
 */
export declare function requireNonBlank(name: string, value: string): string;
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
/**
 * Shown when a caller cancellation landed after a commit-sensitive write was
 * dispatched. Unlike a pre-dispatch cancellation, Zotero may have committed
 * the write, so the outcome is unknown rather than cancelled and the model
 * must reconcile instead of re-issuing.
 */
export declare const WRITE_ABORTED_AFTER_DISPATCH_MESSAGE: string;
/**
 * The model-facing messages the `zotero_browse` argument rules throw. The
 * rules are enforced at both ends of the call (the tool's `buildRequest` and
 * the browse domain entry), so the wording lives with the errors and both
 * sides import it. The one exception is the near-identical pair in
 * `tools/browse.ts` (`TAG_FACET_SCOPE_MESSAGE`, `ITEM_LEVEL_SCOPE_MESSAGE`):
 * those name the *tool arguments* (`tagScope`, `itemLevel`), while the
 * `SCOPE_FACET_KIND_MESSAGE`/`ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE` below name
 * the *request fields* the domain validates. Those are different readers, so
 * the strings are deliberately different.
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
export declare function parentLibraryMismatchMessage(parentRef: {
    type: string;
    id: number;
}, library: {
    type: string;
    id: number;
}): string;
/** Render any thrown value's message; non-Error values fall back to String(). */
export declare function errorMessageOf(error: unknown): string;
/**
 * The wire reason each domain code crosses the gateway as. Every code has one
 * entry, so a new code cannot ship without deciding its reason; the reasons
 * group only failures a client acts on identically, and each one still carries
 * the exact domain code in its typed details.
 */
export declare const ZOTERO_REMOTE_REASON: Record<ZoteroErrorCode, Exclude<RemoteErrorCode, 'zotero/protocol-failed'>>;
/**
 * Preserve a domain failure as its own wire reason across the gateway's typed
 * error carrier. A caller that resolves the service inside `call` also has its
 * provider-unavailable failure classified instead of escaping raw.
 *
 * This is a deliberate boundary conversion rather than the Remote cookbook's
 * "throw RemoteError at the failure point": the same pipelines serve model
 * tools and the wire, so one conversion here keeps the two vocabularies from
 * drifting. A harness identity the domain vocabulary does not own (for
 * example `TOOL_ABORTED` carried by a commit-unknown) is rethrown unchanged
 * instead of being relabeled `ZOTERO_UNEXPECTED`.
 */
export declare function domainCall<T>(call: () => Promise<T>): Promise<T>;
/** The error's chained cause, or the error itself when it has no cause. */
export declare function errorCauseOf(error: unknown): unknown;
/**
 * Render an error's message with its errno-style cause code appended.
 *
 * The code is what makes a transport failure actionable: `fetch failed` alone
 * cannot say whether the network, the TLS path, or a mismatched dispatcher
 * broke a request. A message that already spells the code is left alone, and a
 * harness domain code is skipped in favour of the underlying errno (see
 * `errnoCodeOf`).
 * @param error - any thrown value.
 * @returns the message, with ` (CODE)` when a distinct code exists.
 */
export declare function errorDetailOf(error: unknown): string;
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
//# sourceMappingURL=errors.d.ts.map