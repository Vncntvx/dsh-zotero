/** Stable error classes and codes for the Zotero domain. @module dsh-zotero/errors */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Zotero is not reachable on its local port. */
export const ZOTERO_NOT_RUNNING = 'ZOTERO_NOT_RUNNING'
/** Zotero runs but the local API is disabled in its preferences. */
export const ZOTERO_API_DISABLED = 'ZOTERO_API_DISABLED'
/** The running Zotero speaks an unsupported API version. */
export const ZOTERO_API_VERSION = 'ZOTERO_API_VERSION'
/** A ref names a Zotero instance other than the one currently served. */
export const ZOTERO_SERVER_MISMATCH = 'ZOTERO_SERVER_MISMATCH'
/** The referenced item, collection, or saved search does not exist. */
export const ZOTERO_NOT_FOUND = 'ZOTERO_NOT_FOUND'
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

const ZOTERO_ERROR_CODES = [
  ZOTERO_NOT_RUNNING,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_NOT_FOUND,
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

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
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
  const cause = errorCauseOf(error)
  return typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? cause.code
    : undefined
}

/** True for a translated 404 domain error, which specific endpoints reinterpret. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND
}

/** True when an error's cause carries a network code meaning the Zotero instance is unreachable. */
export function isUnreachableCause(error: unknown): boolean {
  const code = errnoCodeOf(error)
  return code !== undefined && UNREACHABLE_CODES.has(code)
}
