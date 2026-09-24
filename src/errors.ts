/** Stable error classes and codes for the Zotero domain. @module dsh-zotero/errors */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Zotero is not reachable on its local port. */
export const ZOTERO_NOT_RUNNING = 'ZOTERO_NOT_RUNNING'
/** Zotero runs but the local API is disabled in its preferences. */
export const ZOTERO_API_DISABLED = 'ZOTERO_API_DISABLED'
/** The running Zotero speaks an unsupported API version. */
export const ZOTERO_API_VERSION = 'ZOTERO_API_VERSION'
/** Zotero's local API does not implement the request, without a version mismatch (501). */
export const ZOTERO_NOT_IMPLEMENTED = 'ZOTERO_NOT_IMPLEMENTED'
/** A ref names a Zotero instance other than the one currently served. */
export const ZOTERO_SERVER_MISMATCH = 'ZOTERO_SERVER_MISMATCH'
/** The referenced item, collection, or saved search does not exist. */
export const ZOTERO_NOT_FOUND = 'ZOTERO_NOT_FOUND'
/** The server does not keep change history back to the requested version (409). */
export const ZOTERO_RANGE_UNSUPPORTED = 'ZOTERO_RANGE_UNSUPPORTED'
/** The item has no attachment of the requested kind. */
export const ZOTERO_NO_ATTACHMENT = 'ZOTERO_NO_ATTACHMENT'
/** The attachment has no indexed full text. */
export const ZOTERO_NO_FULLTEXT = 'ZOTERO_NO_FULLTEXT'
/** Zotero reports a local file that is missing from disk. */
export const ZOTERO_FILE_MISSING = 'ZOTERO_FILE_MISSING'
/** A ref string does not match the zotero:// grammar or names an unsupported library. */
export const ZOTERO_INVALID_REF = 'ZOTERO_INVALID_REF'
/** An argument the schema cannot express violates a domain constraint. */
export const ZOTERO_INVALID_ARGUMENT = 'ZOTERO_INVALID_ARGUMENT'
/** A collection or saved-search name matches more than one object. */
export const ZOTERO_SCOPE_AMBIGUOUS = 'ZOTERO_SCOPE_AMBIGUOUS'
/** The provider's own deadline elapsed; caller cancellation is preserved separately. */
export const ZOTERO_TIMEOUT = 'ZOTERO_TIMEOUT'
/** A response exceeded the acquisition/resource bound while streaming. */
export const ZOTERO_RESPONSE_TOO_LARGE = 'ZOTERO_RESPONSE_TOO_LARGE'
/** Export output exceeded the provider hard limit; never mid-truncated. */
export const ZOTERO_OUTPUT_TOO_LARGE = 'ZOTERO_OUTPUT_TOO_LARGE'
/** The selected provider does not declare the required capability. */
export const ZOTERO_CAPABILITY_UNAVAILABLE = 'ZOTERO_CAPABILITY_UNAVAILABLE'
/** The configured provider is not registered. */
export const ZOTERO_PROVIDER_UNAVAILABLE = 'ZOTERO_PROVIDER_UNAVAILABLE'
/** A response could not be parsed or behaved unexpectedly. */
export const ZOTERO_UNEXPECTED = 'ZOTERO_UNEXPECTED'
/** Zotero refused a write for lack of a valid local API key (401), including a declined authorization dialog. */
export const ZOTERO_WRITE_UNAUTHORIZED = 'ZOTERO_WRITE_UNAUTHORIZED'
/** The object moved between the read backing the write and the write itself (412). */
export const ZOTERO_WRITE_CONFLICT = 'ZOTERO_WRITE_CONFLICT'
/** Zotero is rate-limiting write authorization requests (429 on the authorize endpoint). */
export const ZOTERO_WRITE_RATE_LIMITED = 'ZOTERO_WRITE_RATE_LIMITED'
/**
 * Plan-review could not be asked: no user-questions channel, or the ask
 * failed for a reason that is not a user decision. Distinct from
 * `ZOTERO_WRITE_UNAUTHORIZED` (Zotero write auth) and from the non-error
 * `declined` outcome (the user answered without approving).
 */
export const ZOTERO_WRITE_APPROVAL_UNAVAILABLE = 'ZOTERO_WRITE_APPROVAL_UNAVAILABLE'

const ZOTERO_ERROR_CODES = [
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
  ZOTERO_INVALID_REF,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZOTERO_TIMEOUT,
  ZOTERO_RESPONSE_TOO_LARGE,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_RATE_LIMITED,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
] as const

/** Every stable error code a `ZoteroError` may carry. */
export type ZoteroErrorCode = (typeof ZOTERO_ERROR_CODES)[number]

/**
 * Domain failure with a stable machine-routable code and an actionable,
 * model-facing message. The tool registry renders it as `Error: <message>`
 * with `isError: true`; messages may carry domain facts such as a status
 * code, but never raw HTTP internals (bodies, headers, engine text).
 */
export class ZoteroError extends HarnessError {
  constructor(message: string, code: ZoteroErrorCode, options?: ErrorOptions) {
    super(message, code, options)
  }
}

/** Shown when Zotero cannot be reached at all. */
export const NOT_RUNNING_MESSAGE =
  'Zotero is not running or its local API is unreachable. Start Zotero and enable ' +
  '"Allow other applications on this computer to communicate with Zotero" in Settings → Advanced, then retry.'

/** Shown when Zotero runs but rejects the local API request. */
export const API_DISABLED_MESSAGE =
  'Zotero rejected the request (403). Enable the local API in Zotero: Settings → Advanced → ' +
  '"Allow other applications on this computer to communicate with Zotero".'

/** Shown when a ref's provenance no longer matches the running instance. */
export const SERVER_MISMATCH_MESSAGE =
  'The active Zotero database changed. This reference belongs to a different Zotero instance. ' +
  'Search Zotero again before using the reference.'

/** Shown when an attachment has no indexed full text. */
export const NO_FULLTEXT_MESSAGE =
  'Zotero has no indexed full text for this attachment. Check that the file contains searchable text; ' +
  'if needed, right-click the attachment in Zotero and choose "Reindex Item". ' +
  'You can also use zotero_attachment to access the original file.'

/**
 * Shown when the caller cancels a tool call. The plugin reports cancellation
 * as the harness's own `TOOL_ABORTED`, so the wording is the harness's; it is
 * spelled once here because three transports — the ask gate and both halves of
 * the HTTP client — have to raise the identical error.
 */
export const TOOL_ABORTED_MESSAGE = 'tool call aborted'

/**
 * Shown when Zotero refuses a version range it cannot reach back to. Zotero's
 * own sync client reads a 409 on a versioned read as "the delete log does not
 * go back that far", i.e. a fact about the range rather than a fault.
 */
export const RANGE_UNSUPPORTED_MESSAGE =
  'Zotero does not keep change history back to that version, so it cannot be read. ' +
  'Take a fresh reading and continue from there.'

/** Shown when Zotero refuses a write for lack of a valid local API key (401); the plugin is about to re-authorize. */
export const WRITE_UNAUTHORIZED_MESSAGE =
  'Zotero rejected the write: no valid local API key was provided (401). The plugin will request ' +
  'authorization now; if Zotero shows the dialog, approve it, or pick "Always Allow" to store a reusable key.'

/** Shown when a write still fails after a fresh authorization ran. */
export const WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE =
  'Zotero still rejects writes after a fresh authorization. Confirm the dialog was approved rather than ' +
  "declined, and that Zotero's local API is enabled; a stored authorization may have been revoked in Zotero."

/** Shown when the user declines the Zotero authorization dialog. */
export const WRITE_AUTH_DENIED_MESSAGE =
  'Zotero denied write authorization: the dialog was declined. To write, allow access in the Zotero ' +
  'dialog, or pick "Always Allow" to store a reusable key.'

/** Shown when the object moved between the read backing a write and the write itself. */
export const WRITE_CONFLICT_MESSAGE =
  'The Zotero object changed between the read and the write (412). Run the tool again: it re-reads the ' +
  'current state and reapplies on top.'

/** Shown when Zotero answers a write with 428: the plugin always sends both preconditions on writes. */
export const WRITE_PRECONDITION_REFUSED_MESSAGE =
  'Zotero required a precondition the plugin did not send (428). The plugin always sends the instance id ' +
  'and a version precondition on writes, so this points at a protocol change: update dsh-zotero.'

/** Shown when Zotero answers a write batch with 413: the plugin caps batches at the protocol limit. */
export const WRITE_BATCH_REFUSED_MESSAGE =
  'Zotero refused the write batch as too large (413). The plugin caps batches at 50 objects, so this ' +
  'points at a protocol change: update dsh-zotero.'

/** Shown when a write response lacks the library-version header Zotero documents on writes. */
export const WRITE_LIBRARY_VERSION_MISSING_MESSAGE =
  'Zotero applied the write but did not report the library version it advanced to; the response does not ' +
  'match the documented write shape.'

/** Shown when the authorization response does not carry the documented key grant. */
export const WRITE_AUTH_SHAPE_MESSAGE =
  'Zotero answered the authorization request without a key grant; the response does not match the ' +
  'documented authorize shape.'

/** Shown when a write is attempted before any read established the Zotero instance id. */
export const WRITE_IDENTITY_MISSING_MESSAGE =
  'A write was attempted before any read established the Zotero instance id.'

/** Shown when Zotero answers a write with an outcome bucket that does not match the documented shape. */
export function writeBatchShapeMessage(bucket: string): string {
  return `Zotero answered the write with a malformed "${bucket}" bucket; the response does not match the documented write shape.`
}

/** Shown when Zotero rate-limits write authorizations; `waitSeconds` rides Retry-After when sent. */
export function writeRateLimitedMessage(waitSeconds: number | undefined): string {
  const wait = waitSeconds === undefined ? 'about a minute' : `${waitSeconds} s`
  return `Zotero is rate-limiting write authorization requests (429). Wait ${wait} and try again.`
}

/** Shown when the connected Zotero build reports no instance id, which local writes require. */
export const WRITE_IDENTITY_UNSUPPORTED_MESSAGE =
  'The connected Zotero build does not report an instance id (Zotero-Server-ID). Writing requires Zotero 10 or newer.'

/** Shown when a read backing a write does not carry the object version the precondition needs. */
export const WRITE_VERSION_MISSING_MESSAGE =
  'Zotero answered the read without the object version a write precondition needs; the response does not match the documented shape.'

/** Shown when collections are requested for a child note, which inherits its parent item's collections. */
export const WRITE_CHILD_COLLECTIONS_MESSAGE =
  'A child note inherits the collections of its parent item; pass collections only for a standalone note.'

/** Shown when a write ref names a library the plugin refuses to write to. */
export function writeLibraryUnsupportedMessage(library: { type: string; id: number }): string {
  return (
    'Writing is limited to the local personal library zotero://user/0/...; ' +
    `this ref names zotero://${library.type}/${library.id}.`
  )
}

/** Shown when Zotero refuses one object of a write batch, with Zotero's own statement. */
export function writeObjectRefusedMessage(message: string, status: number): string {
  return `Zotero refused the write: ${message} (status ${status}).`
}

/** Shown when one note's markdown exceeds the character bound. */
export function writeNoteTooLongMessage(maxChars: number): string {
  return `The note markdown exceeds the ${maxChars}-character bound; shorten it or split the note.`
}

/** Shown when a write tool's list argument exceeds its bound. */
export function writeListTooLongMessage(name: string, maxItems: number): string {
  return `${name} carries more than ${maxItems} items; split the call.`
}

/** Shown when a write tool's list argument is empty when at least one item is required. */
export function writeListEmptyMessage(name: string): string {
  return `${name} must carry at least one item.`
}

/**
 * Shown when plan-review could not be asked at all (no channel, or the ask
 * failed for a non-user reason). Writes fail closed. This is not a user
 * decline (`kind: "declined"`) and not Zotero write auth
 * (`ZOTERO_WRITE_UNAUTHORIZED`).
 */
export const WRITE_APPROVAL_UNAVAILABLE_MESSAGE =
  'The write was not attempted: plan-review could not be asked. Writes require the plan-review ' +
  'question to be answered by the user; run in a conversation where user questions are available, ' +
  'and never write around an unanswered plan.'

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
])

/** Render any thrown value's message; non-Error values fall back to String(). */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The chained cause of an Error; non-Error values have no cause. */
export function errorCauseOf(error: unknown): unknown {
  return error instanceof Error ? error.cause : undefined
}

/** The Errno-style code of an error's cause chain, when one exists. */
export function errnoCodeOf(error: unknown): string | undefined {
  const seen = new Set<object>()
  const queue: unknown[] = [error]
  for (let depth = 0; depth < 10 && queue.length > 0; depth += 1) {
    const current = queue.shift()
    if (typeof current !== 'object' || current === null || seen.has(current)) continue
    seen.add(current)
    if ('code' in current && typeof current.code === 'string' && current.code !== '') {
      return current.code
    }
    if (current instanceof Error && current.cause !== undefined) queue.push(current.cause)
    if (current instanceof AggregateError) queue.push(...current.errors)
  }
  return undefined
}

/** True for a translated 404 domain error, which specific endpoints reinterpret. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND
}

/** True for a translated 409: the server cannot serve the requested version range. */
export function isRangeUnsupportedError(error: unknown): boolean {
  return error instanceof ZoteroError && error.code === ZOTERO_RANGE_UNSUPPORTED
}

/** True when an error's cause carries a network code meaning the Zotero instance is unreachable. */
export function isUnreachableCause(error: unknown): boolean {
  const code = errnoCodeOf(error)
  return code !== undefined && UNREACHABLE_CODES.has(code)
}
