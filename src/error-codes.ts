/** Pure error vocabulary shared by browser contracts and the host. */
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
/** Existing attachment cannot be read. */
export const ZOTERO_FILE_UNREADABLE = 'ZOTERO_FILE_UNREADABLE'
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
/** Export content exceeds its character cap, or a result receipt exceeds its inline budget. */
export const ZOTERO_OUTPUT_TOO_LARGE = 'ZOTERO_OUTPUT_TOO_LARGE'
/** The item type contradicts an attachment ref. */
export function attachmentTypeMessage(itemType: string): string {
  return `The referenced object is a ${itemType}, not an attachment.`
}

/** The selected provider does not declare the required capability. */
export const ZOTERO_CAPABILITY_UNAVAILABLE = 'ZOTERO_CAPABILITY_UNAVAILABLE'
/** A scholarly API key reference is configured but the credentials seam is not composed. */
export const ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE = 'ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE'
/** A configured scholarly API key reference does not resolve to a value. */
export const ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED = 'ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED'
/** A configured MinerU token reference does not resolve to a value (fail-closed). */
export const ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED = 'ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED'
/** Active parsing requires session-owned jobs and a live session controller. */
export const ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE = 'ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE'
/** An operation id was replayed with a different target or settings snapshot. */
export const ZOTERO_ENRICHMENT_OPERATION_CONFLICT = 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT'
/** MinerU reported the enrichment task as failed, with its own stated reason. */
export const ZOTERO_ENRICHMENT_TASK_FAILED = 'ZOTERO_ENRICHMENT_TASK_FAILED'
/** The enrichment output directory failed validation. */
export const ZOTERO_ENRICHMENT_OUTPUT_INVALID = 'ZOTERO_ENRICHMENT_OUTPUT_INVALID'
/** The returned MinerU archive failed structural or zip-safety validation. */
export const ZOTERO_ENRICHMENT_ARCHIVE_INVALID = 'ZOTERO_ENRICHMENT_ARCHIVE_INVALID'
/** A local semantic-model removal failed or hit an unsafe path. */
export const ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED = 'ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED'
/** A parsed artifact id names no committed artifact. */
export const ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND = 'ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND'
/** A parsed artifact cleanup failed or hit an unsafe path. */
export const ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED = 'ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED'
/** The document exceeded the selected API's size limit or is not a PDF. */
export const ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT = 'ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT'
/**
 * Semantic ranking was enabled but could not run: the selected model is not
 * installed, its bundle fails verification, or the local inference runtime
 * failed. Fail-closed, never a silent lexical fallback.
 */
export const ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE = 'ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE'
/** A local semantic model download failed after every source was tried. */
export const ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED = 'ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED'
/** Scholarly full-text resolution reached no readable copy for this identifier. */
export const ZOTERO_SCHOLARLY_NO_FULLTEXT = 'ZOTERO_SCHOLARLY_NO_FULLTEXT'
/** The job registry refused a new job because the owner already holds its limit. */
export const ZOTERO_JOBS_LIMIT_REACHED = 'ZOTERO_JOBS_LIMIT_REACHED'
/** One pinned file did not finish inside its per-file budget across every source. */
export const ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT = 'ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT'
/** The configured provider is not registered. */
export const ZOTERO_PROVIDER_UNAVAILABLE = 'ZOTERO_PROVIDER_UNAVAILABLE'
/** The one message every "zotero is not composed" answer spells. */
export const ZOTERO_NOT_COMPOSED_MESSAGE = 'The Zotero service is not composed.'
/** A response could not be parsed or behaved unexpectedly. */
export const ZOTERO_UNEXPECTED = 'ZOTERO_UNEXPECTED'
/** Zotero refused a write for lack of a valid local API key (401), including a declined authorization dialog. */
export const ZOTERO_WRITE_UNAUTHORIZED = 'ZOTERO_WRITE_UNAUTHORIZED'
/** The object moved between the read backing the write and the write itself (412). */
export const ZOTERO_WRITE_CONFLICT = 'ZOTERO_WRITE_CONFLICT'
/** Zotero is rate-limiting an authorization or data write request (429). */
export const ZOTERO_WRITE_RATE_LIMITED = 'ZOTERO_WRITE_RATE_LIMITED'
/**
 * Plan-review could not be asked: no user-questions channel, or the ask
 * failed for a reason that is not a user decision. Distinct from
 * `ZOTERO_WRITE_UNAUTHORIZED` (Zotero write auth) and from the non-error
 * `declined` outcome (the user answered without approving).
 */
export const ZOTERO_WRITE_APPROVAL_UNAVAILABLE = 'ZOTERO_WRITE_APPROVAL_UNAVAILABLE'

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
] as const

export type ZoteroErrorCode = (typeof ZOTERO_ERROR_CODES)[number]
