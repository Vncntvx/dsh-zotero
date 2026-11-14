/** Stable error classes and codes for the Zotero domain. @module dsh-zotero/errors */
import { HarnessError } from '@deepseek-ai/dsh-error';
import { ToolArgsError } from '@deepseek-ai/dsh-tools';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { findInCauseChain } from './cause-chain.js';
import { ZOTERO_UPDATABLE_ITEM_FIELDS } from './constants.js';
/** Zotero is not reachable on its local port. */
export const ZOTERO_NOT_RUNNING = 'ZOTERO_NOT_RUNNING';
/** Zotero runs but the local API is disabled in its preferences. */
export const ZOTERO_API_DISABLED = 'ZOTERO_API_DISABLED';
/** The running Zotero speaks an unsupported API version. */
export const ZOTERO_API_VERSION = 'ZOTERO_API_VERSION';
/** Zotero's local API does not implement the request, without a version mismatch (501). */
export const ZOTERO_NOT_IMPLEMENTED = 'ZOTERO_NOT_IMPLEMENTED';
/** A ref names a Zotero instance other than the one currently served. */
export const ZOTERO_SERVER_MISMATCH = 'ZOTERO_SERVER_MISMATCH';
/** The referenced item, collection, or saved search does not exist. */
export const ZOTERO_NOT_FOUND = 'ZOTERO_NOT_FOUND';
/** The server does not keep change history back to the requested version (409). */
export const ZOTERO_RANGE_UNSUPPORTED = 'ZOTERO_RANGE_UNSUPPORTED';
/** The item has no attachment of the requested kind. */
export const ZOTERO_NO_ATTACHMENT = 'ZOTERO_NO_ATTACHMENT';
/** The attachment has no indexed full text. */
export const ZOTERO_NO_FULLTEXT = 'ZOTERO_NO_FULLTEXT';
/** Zotero reports a local file that is missing from disk. */
export const ZOTERO_FILE_MISSING = 'ZOTERO_FILE_MISSING';
/** Existing attachment cannot be read. */
export const ZOTERO_FILE_UNREADABLE = 'ZOTERO_FILE_UNREADABLE';
/** A ref string does not match the zotero:// grammar or names an unsupported library. */
export const ZOTERO_INVALID_REF = 'ZOTERO_INVALID_REF';
/** An argument the schema cannot express violates a domain constraint. */
export const ZOTERO_INVALID_ARGUMENT = 'ZOTERO_INVALID_ARGUMENT';
/** A collection or saved-search name matches more than one object. */
export const ZOTERO_SCOPE_AMBIGUOUS = 'ZOTERO_SCOPE_AMBIGUOUS';
/** The provider's own deadline elapsed; caller cancellation is preserved separately. */
export const ZOTERO_TIMEOUT = 'ZOTERO_TIMEOUT';
/** A response exceeded the acquisition/resource bound while streaming. */
export const ZOTERO_RESPONSE_TOO_LARGE = 'ZOTERO_RESPONSE_TOO_LARGE';
/** Export output exceeded the provider hard limit; never mid-truncated. */
export const ZOTERO_OUTPUT_TOO_LARGE = 'ZOTERO_OUTPUT_TOO_LARGE';
/** The selected provider does not declare the required capability. */
export const ZOTERO_CAPABILITY_UNAVAILABLE = 'ZOTERO_CAPABILITY_UNAVAILABLE';
/** A scholarly API key reference is configured but the credentials seam is not composed. */
export const ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE = 'ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE';
/** A configured scholarly API key reference does not resolve to a value. */
export const ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED = 'ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED';
/** A configured MinerU token reference does not resolve to a value (fail-closed). */
export const ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED = 'ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED';
/** Active parsing requires session-owned jobs and a live session controller. */
export const ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE = 'ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE';
/** An operation id was replayed with a different target or settings snapshot. */
export const ZOTERO_ENRICHMENT_OPERATION_CONFLICT = 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT';
/** MinerU reported the enrichment task as failed, with its own stated reason. */
export const ZOTERO_ENRICHMENT_TASK_FAILED = 'ZOTERO_ENRICHMENT_TASK_FAILED';
/** The enrichment output directory failed validation. */
export const ZOTERO_ENRICHMENT_OUTPUT_INVALID = 'ZOTERO_ENRICHMENT_OUTPUT_INVALID';
/** The returned MinerU archive failed structural or zip-safety validation. */
export const ZOTERO_ENRICHMENT_ARCHIVE_INVALID = 'ZOTERO_ENRICHMENT_ARCHIVE_INVALID';
/** A local semantic-model removal failed or hit an unsafe path. */
export const ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED = 'ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED';
/** A parsed artifact id names no committed artifact. */
export const ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND = 'ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND';
/** A parsed artifact cleanup failed or hit an unsafe path. */
export const ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED = 'ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED';
/** The document exceeded the selected API's size limit or is not a PDF. */
export const ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT = 'ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT';
/**
 * Semantic ranking was enabled but could not run: the selected model is not
 * installed, its bundle fails verification, or the local inference runtime
 * failed. Fail-closed, never a silent lexical fallback.
 */
export const ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE = 'ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE';
/** A local semantic model download failed after every source was tried. */
export const ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED = 'ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED';
/** Scholarly full-text resolution reached no readable copy for this identifier. */
export const ZOTERO_SCHOLARLY_NO_FULLTEXT = 'ZOTERO_SCHOLARLY_NO_FULLTEXT';
/** The job registry refused a new job because the owner already holds its limit. */
export const ZOTERO_JOBS_LIMIT_REACHED = 'ZOTERO_JOBS_LIMIT_REACHED';
/** One pinned file did not finish inside its per-file budget across every source. */
export const ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT = 'ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT';
/** The configured provider is not registered. */
export const ZOTERO_PROVIDER_UNAVAILABLE = 'ZOTERO_PROVIDER_UNAVAILABLE';
/** The one message every "zotero is not composed" answer spells. */
export const ZOTERO_NOT_COMPOSED_MESSAGE = 'The Zotero service is not composed.';
/** A response could not be parsed or behaved unexpectedly. */
export const ZOTERO_UNEXPECTED = 'ZOTERO_UNEXPECTED';
/** Zotero refused a write for lack of a valid local API key (401), including a declined authorization dialog. */
export const ZOTERO_WRITE_UNAUTHORIZED = 'ZOTERO_WRITE_UNAUTHORIZED';
/** The object moved between the read backing the write and the write itself (412). */
export const ZOTERO_WRITE_CONFLICT = 'ZOTERO_WRITE_CONFLICT';
/** Zotero is rate-limiting write authorization requests (429 on the authorize endpoint). */
export const ZOTERO_WRITE_RATE_LIMITED = 'ZOTERO_WRITE_RATE_LIMITED';
/**
 * Plan-review could not be asked: no user-questions channel, or the ask
 * failed for a reason that is not a user decision. Distinct from
 * `ZOTERO_WRITE_UNAUTHORIZED` (Zotero write auth) and from the non-error
 * `declined` outcome (the user answered without approving).
 */
export const ZOTERO_WRITE_APPROVAL_UNAVAILABLE = 'ZOTERO_WRITE_APPROVAL_UNAVAILABLE';
/** Every stable error code a `ZoteroError` may carry, in documentation order. */
export const ZOTERO_ERROR_CODES = [
    'ZOTERO_SOURCE_PAGE_STALE',
    'ZOTERO_URL_PDF_DISABLED',
    'ZOTERO_URL_PDF_BUSY',
    'ZOTERO_URL_PDF_NOT_URL',
    'ZOTERO_URL_PDF_REDIRECT',
    'ZOTERO_URL_PDF_HTTP',
    'ZOTERO_URL_PDF_NOT_PDF',
    'ZOTERO_URL_PDF_TIMEOUT',
    'ZOTERO_URL_PDF_FORBIDDEN_TARGET',
    'ZOTERO_URL_PDF_TOO_LARGE',
    'ZOTERO_URL_PDF_NETWORK',
    ZOTERO_NOT_RUNNING,
    ZOTERO_API_DISABLED,
    ZOTERO_API_VERSION,
    ZOTERO_NOT_IMPLEMENTED,
    ZOTERO_SERVER_MISMATCH,
    ZOTERO_NOT_FOUND,
    ZOTERO_RANGE_UNSUPPORTED,
    ZOTERO_NO_ATTACHMENT,
    ZOTERO_NO_FULLTEXT,
    ZOTERO_FILE_MISSING,
    ZOTERO_FILE_UNREADABLE,
    ZOTERO_INVALID_REF,
    ZOTERO_INVALID_ARGUMENT,
    ZOTERO_SCOPE_AMBIGUOUS,
    ZOTERO_TIMEOUT,
    ZOTERO_RESPONSE_TOO_LARGE,
    ZOTERO_OUTPUT_TOO_LARGE,
    ZOTERO_CAPABILITY_UNAVAILABLE,
    ZOTERO_SCHOLARLY_NO_FULLTEXT,
    ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE,
    ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED,
    ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED,
    ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
    ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
    ZOTERO_ENRICHMENT_TASK_FAILED,
    ZOTERO_ENRICHMENT_OUTPUT_INVALID,
    ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
    ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
    ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
    ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT,
    ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
    ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED,
    ZOTERO_JOBS_LIMIT_REACHED,
    ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
    ZOTERO_PROVIDER_UNAVAILABLE,
    ZOTERO_UNEXPECTED,
    ZOTERO_WRITE_UNAUTHORIZED,
    ZOTERO_WRITE_CONFLICT,
    ZOTERO_WRITE_RATE_LIMITED,
    ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
];
/**
 * Domain failure with a stable machine-routable code and an actionable,
 * model-facing message. The tool registry renders it as `Error: <message>`
 * with `isError: true`; messages may carry domain facts such as a status
 * code, but never raw HTTP internals (bodies, headers, engine text).
 */
export class ZoteroError extends HarnessError {
    constructor(message, code, options) {
        super(message, code, options);
    }
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
export class ZoteroWriteCommitUnknownError extends HarnessError {
    constructor(message, code, options) {
        super(message, code, options);
        this.name = 'ZoteroWriteCommitUnknownError';
    }
}
/**
 * Throw a tool argument error for a constraint the parameter schema cannot
 * express. Tool bodies reject with the harness's own `ToolArgsError`
 * (`INVALID_ARGS`): the registry renders it as an argument refusal, which is
 * what a write tool's hand check is.
 * @param message - the model-facing argument error text.
 * @throws {ToolArgsError} `INVALID_ARGS`.
 */
export function invalidArgs(message) {
    throw new ToolArgsError([message]);
}
/**
 * Throw a domain-level argument error for a layer the tool boundary does not
 * own: endpoint handlers and the shared domain request builders keep the
 * stable `ZOTERO_INVALID_ARGUMENT` code so a failure crossing the wire keeps
 * its domain identity.
 * @param message - the model-facing argument error text.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT`.
 */
export function invalid(message) {
    throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT);
}
/** Setting checkbox label in Zotero Preferences -> Advanced -> Allow other applications... */
export const ZOTERO_ALLOW_OTHER_APPLICATIONS_HINT = 'Allow other applications on this computer to communicate with Zotero';
/** Shown when Zotero cannot be reached at all. */
export const NOT_RUNNING_MESSAGE = 'Zotero is not running or its local API is unreachable. Start Zotero and enable ' +
    `"${ZOTERO_ALLOW_OTHER_APPLICATIONS_HINT}" in Settings → Advanced, then retry.`;
/** Shown when Zotero runs but rejects the local API request. */
export const API_DISABLED_MESSAGE = 'Zotero rejected the request (403). Enable the local API in Zotero: Settings → Advanced → ' +
    `"${ZOTERO_ALLOW_OTHER_APPLICATIONS_HINT}".`;
/** Shown when a ref's provenance no longer matches the running instance. */
export const SERVER_MISMATCH_MESSAGE = 'The active Zotero database changed. This reference belongs to a different Zotero instance. ' +
    'Search Zotero again before using the reference.';
/** Shown when an attachment has no indexed full text. */
export const NO_FULLTEXT_MESSAGE = 'Zotero has no indexed full text for this attachment. Check that the file contains searchable text; ' +
    'if needed, right-click the attachment in Zotero and choose "Reindex Item". ' +
    'You can also use zotero_get to access the original file.';
// The caller-cancellation wording lives in `src/abort.ts`. This module is
// re-exported wholesale by `src/index.ts`, and the harness owns both the code
// (`TOOL_ABORTED`) and the canonical `Error: tool call aborted` result it
// renders. Internal cancellation paths share their spelling through
// `src/abort.ts` to avoid widening this public surface.
/**
 * Shown when Zotero refuses a version range it cannot reach back to. Zotero's
 * own sync client reads a 409 on a versioned read as "the delete log does not
 * go back that far", i.e. a fact about the range rather than a fault.
 */
export const RANGE_UNSUPPORTED_MESSAGE = 'Zotero does not keep change history back to that version, so it cannot be read. ' +
    'Take a fresh reading and continue from there.';
/** Shown when Zotero refuses a write for lack of a valid local API key (401); the plugin is about to re-authorize. */
export const WRITE_UNAUTHORIZED_MESSAGE = 'Zotero rejected the write: no valid local API key was provided (401). The plugin will request ' +
    'authorization now; if Zotero shows the dialog, approve it, or pick "Always Allow" to store a reusable key.';
/** Shown when a write still fails after a fresh authorization ran. */
export const WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE = 'Zotero still rejects writes after a fresh authorization. Confirm the dialog was approved rather than ' +
    "declined, and that Zotero's local API is enabled; a stored authorization may have been revoked in Zotero.";
/** Shown when the user declines the Zotero authorization dialog. */
export const WRITE_AUTH_DENIED_MESSAGE = 'Zotero denied write authorization: the dialog was declined. To write, allow access in the Zotero ' +
    'dialog, or pick "Always Allow" to store a reusable key.';
/** Shown when the object moved between the read backing a write and the write itself. */
export const WRITE_CONFLICT_MESSAGE = 'The Zotero object changed between the read and the write (412). Run the tool again: it re-reads the ' +
    'current state and reapplies on top.';
/** Shown when Zotero answers a write with 428: the plugin always sends both preconditions on writes. */
export const WRITE_PRECONDITION_REFUSED_MESSAGE = 'Zotero required a precondition the plugin did not send (428). The plugin always sends the instance id ' +
    'and a version precondition on writes, so this points at a protocol change: update dsh-zotero.';
/** Shown when Zotero answers a write batch with 413: the plugin caps batches at the protocol limit. */
export const WRITE_BATCH_REFUSED_MESSAGE = 'Zotero refused the write batch as too large (413). The plugin caps batches at 50 objects, so this ' +
    'points at a protocol change: update dsh-zotero.';
/** Shown when a write response lacks the library-version header Zotero documents on writes. */
export const WRITE_LIBRARY_VERSION_MISSING_MESSAGE = 'Zotero applied the write but did not report the library version it advanced to; the response does not ' +
    'match the documented write shape.';
/** Shown when the authorization response does not carry the documented key grant. */
export const WRITE_AUTH_SHAPE_MESSAGE = 'Zotero answered the authorization request without a key grant; the response does not match the ' +
    'documented authorize shape.';
/** Shown when a write is attempted before any read established the Zotero instance id. */
export const WRITE_IDENTITY_MISSING_MESSAGE = 'A write was attempted before any read established the Zotero instance id.';
/** Shown when Zotero answers a write with an outcome bucket that does not match the documented shape. */
export function writeBatchShapeMessage(bucket) {
    return `Zotero answered the write with a malformed "${bucket}" bucket; the response does not match the documented write shape.`;
}
/** Shown when Zotero rate-limits write authorizations; `waitSeconds` rides Retry-After when sent. */
export function writeRateLimitedMessage(waitSeconds) {
    const wait = waitSeconds === undefined ? 'about a minute' : `${waitSeconds} s`;
    return `Zotero is rate-limiting write authorization requests (429). Wait ${wait} and try again.`;
}
/** Shown when the connected Zotero build reports no instance id, which local writes require. */
export const WRITE_IDENTITY_UNSUPPORTED_MESSAGE = 'The connected Zotero build does not report an instance id (Zotero-Server-ID). Writing requires Zotero 10 or newer.';
/** Shown when a successful write response omits the instance id required by the protocol. */
export const WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE = 'Zotero accepted the write but did not report the serving instance id; the response does not match the documented write shape.';
/** Shown when a read backing a write does not carry the object version the precondition needs. */
export const WRITE_VERSION_MISSING_MESSAGE = 'Zotero answered the read without the object version a write precondition needs; the response does not match the documented shape.';
/**
 * Shown when a read backing a write does not carry the library version the
 * write's delete precondition derives from. It is generic on purpose: several
 * writes read one row (or one object) only for that header.
 */
export const WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE = 'Zotero answered a write precondition read without the library version; the response does not match the documented shape.';
/** Shown when a read backing a write does not carry the item type the field check needs. */
export const WRITE_ITEM_TYPE_MISSING_MESSAGE = 'Zotero answered the item read without an itemType; the field set this write is allowed to touch cannot be established.';
/** Shown when a read cannot prove the array state a whole-array PATCH must preserve. */
export function writeObjectStateMissingMessage(field) {
    return `Zotero answered the item read without valid ${field} state; a safe whole-array merge is impossible.`;
}
/** Shown when a direct write request carries blank text the tool schema cannot express. */
export function writeNonBlankMessage(name) {
    return `${name} must be a non-empty string when provided`;
}
/**
 * Trim a required free-text value, refusing a blank one with `name`'s
 * message. Both the tool end and the domain end of a write call guard the
 * same arguments, so the rule lives with its message and both import it. Two
 * implementations would be two wordings waiting to drift.
 */
export function requireNonBlank(name, value) {
    const trimmed = value.trim();
    if (trimmed === '') {
        throw new ZoteroError(writeNonBlankMessage(name), ZOTERO_INVALID_ARGUMENT);
    }
    return trimmed;
}
/** Shown when collections are requested for a child note, which inherits its parent item's collections. */
export const WRITE_CHILD_COLLECTIONS_MESSAGE = 'A child note inherits the collections of its parent item; pass collections only for a standalone note.';
/** Shown when a write ref names a library the plugin refuses to write to. */
export function writeLibraryUnsupportedMessage(library) {
    return ('Writing is limited to the local personal library zotero://user/0/...; ' +
        `this ref names zotero://${library.type}/${library.id}.`);
}
/** Shown when one creator entry of an item create names no usable name fields. */
export function writeCreatorNameMessage(index) {
    return `creators[${index}] must carry a name or a firstName/lastName pair`;
}
/** Shown when an update field is outside the closed set of updatable fields. */
export function writeFieldNotUpdatableMessage(field) {
    return `"${field}" is not an updatable field; updatable fields are ${ZOTERO_UPDATABLE_ITEM_FIELDS.join(', ')}.`;
}
/** Shown when Zotero refuses one object of a write batch, with Zotero's own statement. */
export function writeObjectRefusedMessage(message, status) {
    return `Zotero refused the write: ${message} (status ${status}).`;
}
/** Shown when one note's markdown exceeds the character bound. */
export function writeNoteTooLongMessage(maxChars) {
    return `The note markdown exceeds the ${maxChars}-character bound; shorten it or split the note.`;
}
/** Shown when a write tool's list argument exceeds its bound. */
export function writeListTooLongMessage(name, maxItems) {
    return `${name} carries more than ${maxItems} items; split the call.`;
}
/** Shown when a write tool's list argument is empty when at least one item is required. */
export function writeListEmptyMessage(name) {
    return `${name} must carry at least one item.`;
}
/** Shown when an update tool's add/remove selection carries nothing to change. */
export const WRITE_LIST_SELECTION_MESSAGE = 'add and remove must carry at least one entry between them; a call that changes nothing is refused.';
/** Shown when a collection name already exists among the target siblings. */
export function writeCollectionNameExistsMessage(name) {
    return `A collection named "${name}" already exists at that level; pick another name or work with the existing collection's ref.`;
}
/** Shown when an item type is outside the closed creation whitelist. */
export function writeItemTypeUnsupportedMessage(itemType) {
    return `Unknown itemType "${itemType}"; this tool creates only webpage, journalArticle, book, conferencePaper, report, thesis, document, and preprint items.`;
}
/** Shown when item creation carries neither a title nor a URL. */
export const WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE = 'A new item needs at least a title or a URL; both are missing.';
/** Shown when an update field is not valid for the item's type. */
export function writeFieldNotForItemTypeMessage(field, itemType) {
    return `Field "${field}" is not valid for item type "${itemType}"; check zotero_browse kind itemFields for what this type accepts.`;
}
/** Shown when a library-tags delete names more tags than one request may carry. */
export function writeTagDeleteLimitMessage(limit, detail) {
    const server = detail.trim() === '' ? '' : ` Zotero reported: ${detail.trim()}`;
    return `One library-tags delete carries at most ${limit} tags; split the call.${server}`;
}
/** Shown when My Publications is requested for a group library. */
export const PUBLICATIONS_GROUP_UNSUPPORTED_MESSAGE = 'My Publications scope is only valid for personal libraries.';
/**
 * Shown when the approval gate or plan-review could not be asked at all (no
 * channel, or the ask failed for a non-user reason). Writes fail closed. This
 * is not a user decline (`kind: "declined"`) and not Zotero write auth
 * (`ZOTERO_WRITE_UNAUTHORIZED`).
 */
export const WRITE_APPROVAL_UNAVAILABLE_MESSAGE = 'The write was not attempted: the approval gate or plan-review could not be asked. Writes require ' +
    'those confirmations to be answered by the user; run in a conversation where approvals and user ' +
    'questions are available, and never write around an unanswered plan.';
/**
 * Shown when a caller cancellation landed after a commit-sensitive write was
 * dispatched. Unlike a pre-dispatch cancellation, Zotero may have committed
 * the write, so the outcome is unknown rather than cancelled and the model
 * must reconcile instead of re-issuing.
 */
export const WRITE_ABORTED_AFTER_DISPATCH_MESSAGE = 'The write was cancelled after Zotero received it, so whether it committed is unknown. Do not ' +
    'retry it; re-read the affected item, note, or collection first and reconcile with what actually landed.';
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
export function unsupportedBrowseKindMessage(kind) {
    return `Unsupported browse kind ${kind}`;
}
/** The model-facing message for a library argument on a kind that is global. */
export function libraryNotAllowedMessage(kind) {
    return `library is not allowed for kind ${kind}; omit library for libraries/itemTypes/itemFields`;
}
/** The model-facing message for an item type passed to a kind that takes none. */
export const ITEM_TYPE_SCOPE_MESSAGE = 'itemType is only valid when kind="itemFields"';
/** The model-facing message for the item-fields kind without a well-formed item type. */
export const ITEM_FIELDS_ITEM_TYPE_MESSAGE = 'kind="itemFields" requires a Zotero item type name (e.g. dataset, journalArticle)';
/** The model-facing message for a tag query/match on a kind that counts no tags. */
export const Q_MATCH_SCOPE_MESSAGE = 'q/match are only valid when kind="tags"';
/** The model-facing message for a match mode with no query to apply it to. */
export const MATCH_REQUIRES_Q_MESSAGE = 'match requires q';
/** The model-facing message for a parentRef outside collection navigation. */
export const PARENT_REF_SCOPE_MESSAGE = 'parentRef is only valid when kind="collections"';
/** The model-facing message for facet fields (`scope`, `itemLevel`, `itemQuery`) on another kind. */
export const SCOPE_FACET_KIND_MESSAGE = 'scope/itemLevel/itemQuery are only valid when kind="tags"';
/** The model-facing message for facet fields with no scope to count over. */
export const ITEM_LEVEL_REQUIRES_SCOPE_MESSAGE = 'itemLevel/itemQuery require a scope (library, collection, or publications)';
/** The model-facing message for a collection scope that names nothing. */
export const SCOPE_NAME_MESSAGE = 'scope.refOrName must be a non-empty string';
/** The model-facing message for a negative offset. */
export const OFFSET_NON_NEGATIVE_MESSAGE = 'offset must be a non-negative integer';
/** The model-facing message for a limit outside the configured browse cap. */
export function browseLimitMessage(maxBrowseResults) {
    return `limit must be integer 1..${maxBrowseResults}`;
}
export function parentLibraryMismatchMessage(parentRef, library) {
    return `Library mismatch: parentRef is ${parentRef.type}/${parentRef.id} but request library is ${library.type}/${library.id}.`;
}
const UNREACHABLE_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'EADDRNOTAVAIL',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'ECONNABORTED',
]);
/** Render any thrown value's message; non-Error values fall back to String(). */
export function errorMessageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * The wire reason each domain code crosses the gateway as. Every code has one
 * entry, so a new code cannot ship without deciding its reason; the reasons
 * group only failures a client acts on identically, and each one still carries
 * the exact domain code in its typed details.
 */
export const ZOTERO_REMOTE_REASON = {
    ZOTERO_NOT_RUNNING: 'zotero/not-running',
    ZOTERO_API_DISABLED: 'zotero/api-disabled',
    ZOTERO_API_VERSION: 'zotero/api-version',
    ZOTERO_NOT_IMPLEMENTED: 'zotero/not-implemented',
    ZOTERO_SERVER_MISMATCH: 'zotero/server-mismatch',
    ZOTERO_NOT_FOUND: 'zotero/not-found',
    ZOTERO_RANGE_UNSUPPORTED: 'zotero/range-unsupported',
    ZOTERO_NO_ATTACHMENT: 'zotero/no-attachment',
    ZOTERO_NO_FULLTEXT: 'zotero/no-fulltext',
    ZOTERO_FILE_MISSING: 'zotero/file-missing',
    ZOTERO_FILE_UNREADABLE: 'zotero/file-unreadable',
    ZOTERO_INVALID_REF: 'zotero/invalid-ref',
    ZOTERO_INVALID_ARGUMENT: 'zotero/invalid-argument',
    ZOTERO_SCOPE_AMBIGUOUS: 'zotero/scope-ambiguous',
    ZOTERO_TIMEOUT: 'zotero/timeout',
    ZOTERO_RESPONSE_TOO_LARGE: 'zotero/response-too-large',
    ZOTERO_OUTPUT_TOO_LARGE: 'zotero/output-too-large',
    ZOTERO_CAPABILITY_UNAVAILABLE: 'zotero/capability-unavailable',
    ZOTERO_SOURCE_PAGE_STALE: 'zotero/source-page-stale',
    ZOTERO_URL_PDF_DISABLED: 'zotero/url-pdf',
    ZOTERO_URL_PDF_BUSY: 'zotero/url-pdf',
    ZOTERO_URL_PDF_NOT_URL: 'zotero/url-pdf',
    ZOTERO_URL_PDF_REDIRECT: 'zotero/url-pdf',
    ZOTERO_URL_PDF_HTTP: 'zotero/url-pdf',
    ZOTERO_URL_PDF_NOT_PDF: 'zotero/url-pdf',
    ZOTERO_URL_PDF_TIMEOUT: 'zotero/url-pdf',
    ZOTERO_URL_PDF_FORBIDDEN_TARGET: 'zotero/url-pdf',
    ZOTERO_URL_PDF_TOO_LARGE: 'zotero/url-pdf',
    ZOTERO_URL_PDF_NETWORK: 'zotero/url-pdf',
    ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE: 'zotero/jobs/unavailable',
    ZOTERO_JOBS_LIMIT_REACHED: 'zotero/jobs/limit-reached',
    ZOTERO_SCHOLARLY_NO_FULLTEXT: 'zotero/scholarly',
    ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE: 'zotero/scholarly',
    ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED: 'zotero/scholarly',
    ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_OPERATION_CONFLICT: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_TASK_FAILED: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_OUTPUT_INVALID: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_ARCHIVE_INVALID: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED: 'zotero/enrichment',
    ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT: 'zotero/enrichment',
    ZOTERO_PROVIDER_UNAVAILABLE: 'zotero/provider-unavailable',
    ZOTERO_UNEXPECTED: 'zotero/unexpected',
    ZOTERO_WRITE_UNAUTHORIZED: 'zotero/write',
    ZOTERO_WRITE_CONFLICT: 'zotero/write',
    ZOTERO_WRITE_RATE_LIMITED: 'zotero/write',
    ZOTERO_WRITE_APPROVAL_UNAVAILABLE: 'zotero/write',
};
const ZOTERO_CODE_SET = new Set(ZOTERO_ERROR_CODES);
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
export async function domainCall(call) {
    try {
        return await call();
    }
    catch (error) {
        if ((error instanceof ZoteroError || error instanceof ZoteroWriteCommitUnknownError) &&
            ZOTERO_CODE_SET.has(error.code)) {
            const code = error.code;
            throw new RemoteError(ZOTERO_REMOTE_REASON[code], error.message, { code }, { cause: error });
        }
        throw error;
    }
}
/** The error's chained cause, or the error itself when it has no cause. */
export function errorCauseOf(error) {
    return error instanceof Error ? (error.cause ?? error) : undefined;
}
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
export function errorDetailOf(error) {
    const message = errorMessageOf(error);
    const code = errnoCodeOf(error);
    return code !== undefined && !message.includes(code) ? `${message} (${code})` : message;
}
/**
 * The Errno-style code of an error's cause chain, when one exists.
 *
 * Skips a `HarnessError`/`ZoteroError`'s own domain `code` (e.g.
 * `ZOTERO_TIMEOUT`) so a wrapped transport failure still surfaces its
 * underlying errno (`ETIMEDOUT`, `ECONNREFUSED`, …).
 */
export function errnoCodeOf(error) {
    return findInCauseChain(error, (current) => {
        if ('code' in current && typeof current.code === 'string' && current.code !== '') {
            // A harness domain code is not an errno; keep walking the cause chain.
            if (!(current instanceof HarnessError))
                return current.code;
        }
        return undefined;
    });
}
/** True for a translated 404 domain error, which specific endpoints reinterpret. */
export function isNotFoundError(error) {
    return error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND;
}
/** True for a translated 409: the server cannot serve the requested version range. */
export function isRangeUnsupportedError(error) {
    return error instanceof ZoteroError && error.code === ZOTERO_RANGE_UNSUPPORTED;
}
/** True when an error's cause carries a network code meaning the Zotero instance is unreachable. */
export function isUnreachableCause(error) {
    const code = errnoCodeOf(error);
    return code !== undefined && UNREACHABLE_CODES.has(code);
}
//# sourceMappingURL=errors.js.map