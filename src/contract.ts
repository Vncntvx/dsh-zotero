/**
 * The zotero wire contract's shared structural surface: types, wire identity,
 * and the invocation factory both halves use. This module is dependency-free,
 * so the browser bundle inlines it without pulling host-only schema
 * materialization (zod) into the client graph.
 *
 * Boundary codecs are defined elsewhere. The strict wire schemas and the one
 * shared invocation list live once in `src/wire-schemas.ts` (client-safe: only
 * `zod` and this module's types); the host manifest (`src/status-codec.ts`) and
 * the client Remote face (`src/client/status-codec.ts`) both alias that list
 * instead of materializing their own descriptors. `zod` stays a platform module
 * the shell serves.
 *
 * The two arms do not validate alike. Client Gateway decodes a unary result
 * only through `descriptor.result.decode`, which the generator emits solely for
 * byte-carrying boundaries; a pure-JSON result reaches the browser as
 * `RemoteResult.value` unvalidated, and the client factory is not called there.
 * Strict validation of JSON inputs runs in the host gateway's own `decode`
 * step.
 *
 * The Remote namespace carries the one fact the settings plane does not: live
 * connectivity of the configured Zotero provider. Configuration uses the
 * shared configuration form (`ctx.configForms`).
 * @module dsh-zotero/contract
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroErrorCode } from './errors.js'
import type { ZoteroExportFormat, ZoteroSortField } from './types.js'
import type { SourceWorkspace } from './sources/model.js'
import type { SourceFilter } from './sources/filters.js'
import { ZOTERO_SETTINGS_NAMESPACE, ZOTERO_ENRICHMENT_SERVICE_KEY } from './settings-namespace.js'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * One wire reason per actionable failure class, each carrying the stable
     * domain code it came from. `zotero/domain` is deliberately absent: a
     * single collapsed code hid every reason behind an untyped field.
     */
    'zotero/not-running': { readonly code: ZoteroErrorCode }
    'zotero/api-disabled': { readonly code: ZoteroErrorCode }
    'zotero/api-version': { readonly code: ZoteroErrorCode }
    'zotero/not-implemented': { readonly code: ZoteroErrorCode }
    'zotero/server-mismatch': { readonly code: ZoteroErrorCode }
    'zotero/not-found': { readonly code: ZoteroErrorCode }
    'zotero/range-unsupported': { readonly code: ZoteroErrorCode }
    'zotero/no-attachment': { readonly code: ZoteroErrorCode }
    'zotero/no-fulltext': { readonly code: ZoteroErrorCode }
    'zotero/file-missing': { readonly code: ZoteroErrorCode }
    'zotero/file-unreadable': { readonly code: ZoteroErrorCode }
    'zotero/invalid-argument': { readonly code: ZoteroErrorCode }
    'zotero/invalid-ref': { readonly code: ZoteroErrorCode }
    'zotero/scope-ambiguous': { readonly code: ZoteroErrorCode }
    'zotero/timeout': { readonly code: ZoteroErrorCode }
    'zotero/response-too-large': { readonly code: ZoteroErrorCode }
    'zotero/output-too-large': { readonly code: ZoteroErrorCode }
    'zotero/capability-unavailable': { readonly code: ZoteroErrorCode }
    'zotero/provider-unavailable': { readonly code: ZoteroErrorCode }
    'zotero/source-page-stale': { readonly code: ZoteroErrorCode }
    'zotero/url-pdf': { readonly code: ZoteroErrorCode }
    'zotero/jobs/unavailable': { readonly code: ZoteroErrorCode }
    'zotero/jobs/background-disabled': { readonly code: ZoteroErrorCode }
    'zotero/jobs/limit-reached': { readonly code: ZoteroErrorCode }
    'zotero/enrichment': { readonly code: ZoteroErrorCode }
    'zotero/scholarly': { readonly code: ZoteroErrorCode }
    'zotero/write': { readonly code: ZoteroErrorCode }
    'zotero/unexpected': { readonly code: ZoteroErrorCode }
    'zotero/protocol-failed': { readonly url: string; readonly reason: string }
  }
}

/** Wire namespace both halves spell; re-exported so contract is one import site. */
export { ZOTERO_SETTINGS_NAMESPACE }

/** The canonical personal library: the local API's logged-in user. */
export type PersonalLibrary = { type: 'user'; id: 0 }
/** A synced group library by its positive group id. */
export type GroupLibrary = { type: 'group'; id: number }
/** The local libraries this plugin contract supports: canonical personal + any group. */
export type SupportedLocalLibrary = PersonalLibrary | GroupLibrary

/**
 * Resolved scope echoed back to the Agent so pagination reuses a stable ref.
 * The `library` property identifies the target personal (`user/0`) or group library.
 * The `trash` kind is the library panel's own scope: the Local API's
 * `/items/trash` listing; the model-facing tool schema does not include it.
 */
export type ZoteroResolvedScope =
  | { kind: 'library'; library: PersonalLibrary }
  | { kind: 'library'; library: GroupLibrary }
  | { kind: 'publications'; library: PersonalLibrary }
  | { kind: 'collection'; ref: string; name: string }
  | { kind: 'savedSearch'; ref: string; name: string }
  | { kind: 'trash'; library: SupportedLocalLibrary }

/** Stable wire code reported when the full-session literature-trail projection fails to register. */
export const ZOTERO_SOURCE_PROJECTION_FAILED = 'ZOTERO_SOURCE_PROJECTION_FAILED' as const

/** The zotero connectivity view the web tab renders (optional facts omitted when absent). */
export interface ZoteroStatusView {
  readonly providerId: string
  /** Composition state of the full-session literature-trail projection. */
  readonly sourceProjection:
    | { readonly state: 'not-composed' }
    | { readonly state: 'pending' }
    | { readonly state: 'ready' }
    | { readonly state: 'failed'; readonly code: typeof ZOTERO_SOURCE_PROJECTION_FAILED }
  /**
   * The authority the probe dialled, e.g. `127.0.0.1:23119`. Optional on the
   * wire view only because one answer has no endpoint to report: a service that
   * is not composed at all dialled nothing. Every answer that reached a
   * provider carries one, on the connected and the disconnected arm alike.
   */
  readonly endpoint?: string
  readonly connected: boolean
  readonly apiVersion?: string
  readonly serverId?: string
  readonly schemaVersion?: string
  /** The answering Zotero build (`X-Zotero-Version`); the only version fact that names a release. */
  readonly zoteroVersion?: string
  /** The write state; absent when the serving provider wires no write capability. */
  readonly write?: { readonly enabled: boolean; readonly authorized: boolean }
  /**
   * What the probe wants explained, localized by the client. Present only when
   * there is something to explain: a connected probe carries none. The
   * host-internal status keeps a total field with the {@link ZOTERO_DIAGNOSIS_OK}
   * sentinel; the wire producer strips it so a success never renders a
   * diagnosis box.
   */
  readonly diagnosis?: string
}

/** The attachment location view returned by the resolveAttachment Remote invocation. */
export interface ZoteroAttachmentLocationView {
  readonly ref: string
  readonly kind: 'file' | 'url'
  readonly title: string
  readonly contentType: string
  readonly path?: string
  readonly url?: string
}

/** Severity of one diagnostics entry, mirroring the host ring's levels. */
type ZoteroDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

/** One retained diagnostics entry, newest-first within the snapshot. */
export interface ZoteroDiagnosticEntry {
  readonly seq: number
  readonly ts: number
  readonly level: ZoteroDiagnosticLevel
  readonly event: string
  readonly message: string
  /** Consecutive repeats of the same `(event, level, message)` coalesce into a count. */
  readonly count: number
  readonly detail?: { readonly [key: string]: string | number | boolean }
}

/** The diagnostics snapshot the web panel renders. */
export interface ZoteroDiagnosticsView {
  readonly entries: readonly ZoteroDiagnosticEntry[]
  /** Entries currently retained (after capacity eviction, before this snapshot's limit). */
  readonly total: number
  /** Whether `entries` was cut to the endpoint's serving limit. */
  readonly truncated: boolean
  /** Whether the host ring currently retains debug-level entries (the `debug` config flag). */
  readonly debug: boolean
}

/** What a crashed client surface reports back into the host ring. */
export interface ZoteroClientErrorReport {
  /** Which UI surface crashed, e.g. `sources`, a tool wire name, or `detail`. */
  readonly surface: string
  readonly message: string
  readonly stack?: string
  readonly componentStack?: string
}

/** The host's receipt for a client error report: the ring sequence it was assigned. */
export interface ZoteroReportResultView {
  readonly seq: number
}

/** The result of revoking the persisted Zotero write grant. */
export interface ZoteroWriteGrantRevokeView {
  /** Whether a stored credential record was removed. */
  readonly removed: boolean
}

/** The result of launching a zotero:// protocol URL via the host. */
export interface ZoteroOpenProtocolResultView {
  readonly success: true
}

/** Package identity every Typert contribution from this plugin claims. */
export const ZOTERO_REMOTE_PACKAGE = 'dsh-zotero'

/**
 * Success sentinel the host status probe writes into its total `diagnosis`
 * field (`src/local/provider.ts`). The wire view strips it: a connected probe
 * has nothing to diagnose: so this constant is the single spelling both the
 * writer and the stripper compare against.
 */
export const ZOTERO_DIAGNOSIS_OK = 'ok'

/** Strict codec type symbol for {@link ZoteroStatusView}; host and client must agree. */
export const ZOTERO_STATUS_TYPE_SYMBOL = 'dsh-zotero#ZoteroStatusView'

/** Strict codec type symbol for the string ref parameter. */
export const ZOTERO_REF_PARAM_TYPE_SYMBOL = 'dsh-zotero#AttachmentRef'

/** Strict codec type symbol for {@link ZoteroAttachmentLocationView}. */
export const ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL = 'dsh-zotero#ZoteroAttachmentLocationView'

/** Strict codec type symbol for {@link ZoteroDiagnosticsView}. */
export const ZOTERO_DIAGNOSTICS_TYPE_SYMBOL = 'dsh-zotero#ZoteroDiagnosticsView'

/** Strict codec type symbol for {@link ZoteroClientErrorReport}. */
export const ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL = 'dsh-zotero#ZoteroClientErrorReport'

/** Strict codec type symbol for {@link ZoteroReportResultView}. */
export const ZOTERO_REPORT_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroReportResultView'

/** Strict codec type symbol for the string url parameter of openProtocol. */
export const ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL = 'dsh-zotero#ProtocolUrl'

/** Strict codec type symbol for {@link ZoteroOpenProtocolResultView}. */
export const ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroOpenProtocolResultView'

/** Strict codec type symbol for {@link ZoteroWriteGrantRevokeView}. */
export const ZOTERO_WRITE_GRANT_REVOKE_TYPE_SYMBOL = 'dsh-zotero#ZoteroWriteGrantRevokeView'

/** Globally stable invocation id for the status probe. */
export const ZOTERO_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/status'

/** Globally stable invocation id for resolveAttachment. */
const ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID = 'dsh-zotero#zotero/resolveAttachment'

/** Globally stable invocation id for the diagnostics snapshot. */
const ZOTERO_DIAGNOSTICS_INVOCATION_ID = 'dsh-zotero#zotero/diagnostics'

/** Globally stable invocation id for the client error report. */
const ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID = 'dsh-zotero#zotero/reportClientError'

/** Globally stable invocation id for openProtocol. */
const ZOTERO_OPEN_PROTOCOL_INVOCATION_ID = 'dsh-zotero#zotero/openProtocol'

/** Globally stable invocation id for revokeWriteGrant. */
const ZOTERO_REVOKE_WRITE_GRANT_INVOCATION_ID = 'dsh-zotero#zotero/revokeWriteGrant'

/**
 * Cordis service key that owns the status method on the host half.
 * The host Remote service (`src/remote.ts`) and the Typert model must both
 * spell this key from here, never as a second literal.
 */
export const ZOTERO_STATUS_SERVICE_KEY = 'zoteroRemote'

/** Wire method name for the status probe. */
export const ZOTERO_STATUS_METHOD = 'status'

/** Wire method name for resolveAttachment. */
export const ZOTERO_RESOLVE_ATTACHMENT_METHOD = 'resolveAttachment'

/** Wire method name for the diagnostics snapshot. */
export const ZOTERO_DIAGNOSTICS_METHOD = 'diagnostics'

/** Wire method name for the client error report. */
export const ZOTERO_REPORT_CLIENT_ERROR_METHOD = 'reportClientError'

/** Wire method name for openProtocol. */
export const ZOTERO_OPEN_PROTOCOL_METHOD = 'openProtocol'

/** Wire method name for revokeWriteGrant. */
export const ZOTERO_REVOKE_WRITE_GRANT_METHOD = 'revokeWriteGrant'

/** Invocation kind for direct service calls (no Context receiver). */
export const ZOTERO_STATUS_INVOCATION_KIND = 'direct'

/**
 * Build one status invocation descriptor around a result codec. Host and
 * client both call this so endpoint identity cannot drift; only the codec arm
 * differs by side. Every structural field is copied, so a caller never shares
 * a mutable reference with the descriptor it built.
 * @param result - the strict result codec for {@link ZoteroStatusView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroStatusInvocation(
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_STATUS_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_STATUS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [],
    result,
  }
}

/**
 * Build one revokeWriteGrant invocation descriptor: no parameters, direct
 * dispatch, and the caller's cancellation signal.
 * @param result - the strict result codec for {@link ZoteroWriteGrantRevokeView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroRevokeWriteGrantInvocation(
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_REVOKE_WRITE_GRANT_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_REVOKE_WRITE_GRANT_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [],
    result,
  }
}

/**
 * Build one resolveAttachment invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for the ref string.
 * @param result - the strict result codec for {@link ZoteroAttachmentLocationView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroResolveAttachmentInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_RESOLVE_ATTACHMENT_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [
      {
        name: 'ref',
        wire: 'ref',
        source: 'json',
        codec: param,
      },
    ],
    result,
  }
}

/**
 * Build one diagnostics invocation descriptor around a result codec. Zero
 * parameters, like the status probe: the endpoint serves its own capped
 * newest-first slice and the `debug` fact.
 * @param result - the strict result codec for {@link ZoteroDiagnosticsView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroDiagnosticsInvocation(
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_DIAGNOSTICS_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_DIAGNOSTICS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [],
    result,
  }
}

/**
 * Build one reportClientError invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for {@link ZoteroClientErrorReport}.
 * @param result - the strict result codec for {@link ZoteroReportResultView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroReportClientErrorInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_REPORT_CLIENT_ERROR_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [
      {
        name: 'report',
        wire: 'report',
        source: 'json',
        codec: param,
      },
    ],
    result,
  }
}

/**
 * Build one openProtocol invocation descriptor around parameter and result codecs.
 * @param param - the strict parameter codec for the zotero:// URL string.
 * @param result - the strict result codec for {@link ZoteroOpenProtocolResultView}.
 * @returns a complete invocation descriptor.
 */
export function zoteroOpenProtocolInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_OPEN_PROTOCOL_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_OPEN_PROTOCOL_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [
      {
        name: 'url',
        wire: 'url',
        source: 'json',
        codec: param,
      },
    ],
    result,
  }
}

/*
 * ── Library panel endpoints ──────────────────────────────────────────────
 *
 * The read endpoints below serve the browser library panel. They are a
 * wire-only surface: the model tools do not call them, and the panel does not
 * call the tools. Every type here mirrors a domain shape from `src/types.ts`
 * by hand; that module is host-only, while both halves and the browser bundle
 * import this contract file.
 */

/** One bounded literature-trail list, always read from the full session ledger. */
export type ZoteroSourcePageTarget =
  | { readonly kind: 'sources'; readonly filter: SourceFilter }
  | {
      readonly kind: 'source'
      readonly key: string
      readonly rows: 'searches' | 'evidence' | 'exports'
    }
  | { readonly kind: 'session'; readonly rows: 'exports' }

export interface ZoteroSourcePageRequestView {
  readonly sessionId: string
  readonly target: ZoteroSourcePageTarget
  /** Connected instance fact used by the issues filter; never triggers a probe. */
  readonly currentServerId?: string
  /** Page size; the host clamps it to the target's serving cap. */
  readonly limit?: number
  /** How many rows of the target list the caller already shows; the host continues from there. */
  readonly offset?: number
  /**
   * Inclusive session watermark; -1 denotes an empty log. A continuation must
   * carry it: a trail that moved since the caller's page is refused rather
   * than silently continued against a different fold.
   */
  readonly revision?: number
}

export interface ZoteroSourcePageResultView {
  readonly sessionId: string
  readonly target: ZoteroSourcePageTarget
  readonly revision: number
  readonly offset: number
  readonly limit: number
  readonly total: number
  /** Bounded rows only, with exact session-wide and per-source totals. */
  readonly workspace: SourceWorkspace
}

export const ZOTERO_SOURCE_PAGE_METHOD = 'sourcePage'
export const ZOTERO_SOURCE_PAGE_INVOCATION_ID = 'dsh-zotero#zotero/sourcePage'
export const ZOTERO_SOURCE_PAGE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroSourcePageRequestView'
export const ZOTERO_SOURCE_PAGE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSourcePageResultView'

/**
 * Build one sourcePage invocation descriptor around parameter and result codecs.
 *
 * The endpoint rides the core service: the literature trail is a conversation
 * surface, so it must page whether or not the optional library component is
 * mounted.
 * @param param - the strict parameter codec for the page request.
 * @param result - the strict result codec for the page result.
 * @returns a complete invocation descriptor.
 */
export function zoteroSourcePageInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_SOURCE_PAGE_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_SOURCE_PAGE_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

/** A user-selected PDF, never a host path or caller-supplied document bytes. */
export type ZoteroParseTargetView =
  | { readonly kind: 'attachment'; readonly ref: string }
  | { readonly kind: 'url'; readonly url: string }

export interface ZoteroStartDocumentParseRequestView {
  readonly sessionId: string
  /** Replaying this exact operation joins its job; it does not submit twice. */
  readonly operationId: string
  readonly target: ZoteroParseTargetView
  readonly action: 'parse' | 'reparse' | 'retry'
}

export interface ZoteroParseReceiptView {
  readonly operationId: string
  readonly generation: string
  readonly sourceId: string
  readonly targetLabel: string
  readonly mode: 'free' | 'pro'
  readonly cached: boolean
  readonly artifactId: string
  readonly fingerprint: string
  readonly format: 'markdown'
  readonly characterCount: number
  readonly preview: string
  readonly pageCount?: number
}

export interface ZoteroStartDocumentParseResultView {
  readonly operationId: string
  readonly generation: string
  readonly jobId: string
  readonly status: 'started' | 'joined' | 'completed'
  readonly receipt?: ZoteroParseReceiptView
}

/** The largest slice of a parsed document one read may return. */
export const ZOTERO_ARTIFACT_PAGE_CHARS = 16384

export interface ZoteroDocumentArtifactRequestView {
  readonly sessionId: string
  readonly target: ZoteroParseTargetView
  /** Omit for metadata only; supply a character offset to read one bounded page. */
  readonly read?: { readonly offset: number }
}

export type ZoteroDocumentArtifactResultView =
  | { readonly kind: 'missing' | 'expired' }
  | {
      readonly kind: 'ready'
      readonly sourceId: string
      readonly targetLabel: string
      readonly mode: 'free' | 'pro'
      readonly artifactId: string
      readonly fingerprint: string
      readonly characterCount: number
      readonly pageCount?: number
      /** Present only when the request carried `read`; never a host path or URL. */
      readonly page?: {
        readonly offset: number
        readonly text: string
        readonly totalChars: number
      }
    }

export interface ZoteroDocumentParseReceiptRequestView {
  readonly sessionId: string
  readonly operationId: string
}

export type ZoteroDocumentParseReceiptResultView =
  | { readonly kind: 'pending'; readonly jobId: string; readonly generation: string }
  | { readonly kind: 'completed'; readonly receipt: ZoteroParseReceiptView }
  | { readonly kind: 'failed' | 'cancelled'; readonly code: string; readonly message: string }

export const ZOTERO_START_DOCUMENT_PARSE_METHOD = 'startDocumentParse'
export const ZOTERO_DOCUMENT_ARTIFACT_METHOD = 'documentArtifact'
export const ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD = 'documentParseReceipt'

export function zoteroDocumentParseInvocation(
  method:
    | typeof ZOTERO_START_DOCUMENT_PARSE_METHOD
    | typeof ZOTERO_DOCUMENT_ARTIFACT_METHOD
    | typeof ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD,
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: `dsh-zotero#zotero/${method}`,
    service: ZOTERO_ENRICHMENT_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

export interface ZoteroSemanticModelStatusRequestView {
  readonly model?: string
  readonly modelDir?: string
}

export interface ZoteroSemanticModelStatusResultView {
  readonly model: string
  readonly ready: boolean
  readonly downloading: boolean
  readonly path: string
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly percent: number
  readonly currentFile?: string
  readonly error?: string
  /** A committed install whose staging cleanup failed; the model still works. */
  readonly warning?: string
}

export const ZOTERO_SEMANTIC_MODEL_STATUS_METHOD = 'semanticModelStatus'
export const ZOTERO_SEMANTIC_MODEL_STATUS_INVOCATION_ID = 'dsh-zotero#zotero/semanticModelStatus'
export const ZOTERO_SEMANTIC_MODEL_STATUS_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelStatusRequestView'
export const ZOTERO_SEMANTIC_MODEL_STATUS_RESULT_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelStatusResultView'

export function zoteroSemanticModelStatusInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_SEMANTIC_MODEL_STATUS_INVOCATION_ID,
    service: ZOTERO_ENRICHMENT_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_SEMANTIC_MODEL_STATUS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

export interface ZoteroSemanticModelDownloadRequestView {
  readonly model?: string
  readonly source?: string
  readonly modelDir?: string
  /** Replace an existing bundle instead of answering `already-ready`. */
  readonly force?: boolean
}

export interface ZoteroSemanticModelDownloadResultView {
  readonly success: boolean
  readonly model: string
  readonly status: 'started' | 'already-ready' | 'downloading'
  readonly path: string
}

export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_METHOD = 'downloadSemanticModel'
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_INVOCATION_ID =
  'dsh-zotero#zotero/downloadSemanticModel'
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelDownloadRequestView'
export const ZOTERO_SEMANTIC_MODEL_DOWNLOAD_RESULT_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelDownloadResultView'

export function zoteroSemanticModelDownloadInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_SEMANTIC_MODEL_DOWNLOAD_INVOCATION_ID,
    service: ZOTERO_ENRICHMENT_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_SEMANTIC_MODEL_DOWNLOAD_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

export interface ZoteroSemanticModelCancelRequestView {
  readonly model?: string
  readonly modelDir?: string
}

export interface ZoteroSemanticModelCancelResultView {
  readonly cancelled: boolean
}

export const ZOTERO_SEMANTIC_MODEL_CANCEL_METHOD = 'cancelSemanticModelDownload'
export const ZOTERO_SEMANTIC_MODEL_CANCEL_INVOCATION_ID =
  'dsh-zotero#zotero/cancelSemanticModelDownload'
export const ZOTERO_SEMANTIC_MODEL_CANCEL_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelCancelRequestView'
export const ZOTERO_SEMANTIC_MODEL_CANCEL_RESULT_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelCancelResultView'

export function zoteroSemanticModelCancelInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_SEMANTIC_MODEL_CANCEL_INVOCATION_ID,
    service: ZOTERO_ENRICHMENT_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_SEMANTIC_MODEL_CANCEL_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

export interface ZoteroSemanticModelDeleteRequestView {
  readonly model?: string
  readonly modelDir?: string
}

export interface ZoteroSemanticModelDeleteResultView {
  readonly success: boolean
  readonly model: string
  readonly path: string
  readonly removed: boolean
  readonly removedFiles: number
  readonly removedBytes: number
}

export const ZOTERO_SEMANTIC_MODEL_DELETE_METHOD = 'deleteSemanticModel'
export const ZOTERO_SEMANTIC_MODEL_DELETE_INVOCATION_ID = 'dsh-zotero#zotero/deleteSemanticModel'
export const ZOTERO_SEMANTIC_MODEL_DELETE_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelDeleteRequestView'
export const ZOTERO_SEMANTIC_MODEL_DELETE_RESULT_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelDeleteResultView'

export function zoteroSemanticModelDeleteInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_SEMANTIC_MODEL_DELETE_INVOCATION_ID,
    service: ZOTERO_ENRICHMENT_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_SEMANTIC_MODEL_DELETE_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

/** The browse kinds the library panel lists; the tool-facing kinds stay tool-only. */
export type ZoteroLibraryBrowseKind =
  'libraries' | 'collections' | 'savedSearches' | 'tags' | 'itemTypes'

/** A panel browse request: one bounded listing of a navigation endpoint. */
export interface ZoteroLibraryBrowseRequestView {
  readonly kind: ZoteroLibraryBrowseKind
  /** The library whose collections/saved searches to list; omitted defaults to user/0. */
  readonly library?: SupportedLocalLibrary
  /** Collections only: the parent collection ref whose children to list; omitted lists top-level. */
  readonly parentRef?: string
  /** Tags only: the tag-name search text the Local API filters by. */
  readonly q?: string
  /** Tags only: how `q` matches a tag name. */
  readonly match?: 'contains' | 'startsWith'
  readonly offset: number
  readonly limit: number
}

/** One library row (from `kind: 'libraries'`), discriminated for the wire. */
export interface ZoteroLibraryRowView {
  readonly kind: 'library'
  readonly library: SupportedLocalLibrary
  readonly name: string
}

/** One collection row with its breadcrumb path (from `kind: 'collections'`). */
export interface ZoteroCollectionRowView {
  readonly kind: 'collection'
  readonly ref: string
  readonly name: string
  readonly parentRef?: string
  readonly path: readonly string[]
  readonly depth: number
  /** Sub-collections Zotero counted (`meta.numCollections`); absent when unreported. */
  readonly childCount?: number
  /** Items Zotero counted directly (`meta.numItems`); absent when unreported. */
  readonly itemCount?: number
}

/** One stored Zotero condition; unknown condition names are preserved as strings. */
export interface ZoteroSavedSearchConditionView {
  readonly condition: string
  readonly operator: string
  readonly value: string
}

/** One saved-search row (from `kind: 'savedSearches'`). */
export interface ZoteroSavedSearchRowView {
  readonly kind: 'savedSearch'
  readonly ref: string
  readonly name: string
  readonly conditions: readonly ZoteroSavedSearchConditionView[]
}

/** One row of a panel browse listing, discriminated by `kind` (unlike the domain union). */
export type ZoteroLibraryBrowseItemView =
  | ZoteroLibraryRowView
  | ZoteroCollectionRowView
  | ZoteroSavedSearchRowView
  | { readonly kind: 'tag'; readonly tag: string }
  | { readonly kind: 'itemType'; readonly itemType: string; readonly localized?: string }

/** A panel browse result: the requested page of one navigation listing. */
export interface ZoteroLibraryBrowseResultView {
  readonly libraryVersion?: number
  readonly kind: ZoteroLibraryBrowseKind
  readonly items: readonly ZoteroLibraryBrowseItemView[]
  readonly total: number
  readonly offset: number
  readonly returned: number
  /** The page size the host actually served (`min(request.limit, maxBrowseResults)`). */
  readonly limit: number
  readonly nextOffset?: number
}

/** The item-set scopes the panel lists; `trash` is panel-only and absent from the tool scopes. */
export type ZoteroLibrarySearchScopeView =
  | { kind: 'library' }
  | { kind: 'publications' }
  | { kind: 'collection'; refOrName: string }
  | { kind: 'savedSearch'; refOrName: string }
  | { kind: 'trash' }

/** Sort fields the panel offers; the domain union is the one source. */
export type ZoteroLibrarySortField = ZoteroSortField

/** A panel item-list request over one scope. */
export interface ZoteroLibrarySearchRequestView {
  readonly scope: ZoteroLibrarySearchScopeView
  /** Library for library/trash scopes and name resolution; omitted defaults to user/0. */
  readonly library?: SupportedLocalLibrary
  readonly q?: string
  /** Search mode; omitted defaults to `metadata` on the host side. */
  readonly mode?: 'metadata' | 'everything'
  readonly sort: ZoteroLibrarySortField
  readonly direction: 'asc' | 'desc'
  readonly offset: number
  readonly limit: number
  readonly itemLevel?: 'top' | 'all'
  readonly itemTypes?: readonly string[]
  readonly tags?: readonly string[]
  readonly tagMatch?: 'all' | 'any'
  readonly yearFrom?: number
  readonly yearTo?: number
  readonly hasAttachment?: boolean
  /**
   * The panel's data generation: every refresh or post-write invalidation
   * bumps it, so the host's filtered-search index treats the request as a new
   * filter definition instead of serving a page of the previous scan.
   */
  readonly cacheGeneration?: number
}

/** One item row of a panel listing (the domain's compact search hit, mirrored). */
export interface ZoteroSearchItemView {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  readonly itemType: string
  readonly parentRef?: string
  readonly bestAttachmentRef?: string
  readonly bestAttachmentType?: string
  readonly attachmentSize?: number
  readonly extra?: string
  readonly doi?: string
}

/** A panel item-list result: the paged primary hits only (no note supplement). */
export interface ZoteroSearchResultView {
  readonly scope: ZoteroResolvedScope
  readonly items: readonly ZoteroSearchItemView[]
  readonly total: number
  readonly offset: number
  readonly returned: number
  /** The page size the host actually served (`min(request.limit, maxSearchResults)`). */
  readonly limit: number
  readonly nextOffset?: number
}

/** The child listings an item detail serves and pages through. */
export type ZoteroChildListingKind = 'notes' | 'attachments' | 'annotations'

/** A panel item-detail request: one ref plus the child kinds to include. */
export interface ZoteroLibraryItemRequestView {
  readonly ref: string
  readonly include: readonly ZoteroChildListingKind[]
  readonly childPages?: Readonly<
    Partial<Record<ZoteroChildListingKind, { readonly offset: number; readonly limit: number }>>
  >
}

/** A panel child-page request: one ref, one kind, and its page window. */
export interface ZoteroLibraryChildPageRequestView {
  readonly ref: string
  readonly kind: ZoteroChildListingKind
  readonly offset: number
  readonly limit: number
}

/** One creator of an item (the domain's creator record, mirrored). */
export interface ZoteroCreatorView {
  readonly creatorType: string
  readonly name?: string
  readonly firstName?: string
  readonly lastName?: string
}

/** One note row of an item's notes listing. */
export interface ZoteroNoteRowView {
  readonly ref: string
  readonly text: string
  readonly truncated: boolean
  readonly parentRef?: string
}

/** One annotation row of an attachment's annotation listing. */
export interface ZoteroAnnotationRowView {
  readonly ref: string
  readonly type: string
  readonly text: string
  readonly comment?: string
  readonly color?: string
  readonly pageLabel?: string
  readonly parentRef?: string
}

/** One attachment row of an item's attachment listing. */
export interface ZoteroAttachmentRowView {
  readonly ref: string
  readonly title: string
  readonly contentType: string
}

/** One bounded child listing the detail view serves: a total plus the rows returned. */
export interface ZoteroChildRowsView<T> {
  readonly total: number
  readonly returned: number
  readonly offset: number
  /** The page size the host actually served (the include's configured record cap). */
  readonly limit: number
  readonly nextOffset?: number
  readonly items: readonly T[]
}

/** The panel's item detail: the domain's normalized record with the panel's include set applied. */
export interface ZoteroItemDetailView {
  readonly ref: string
  readonly itemType: string
  readonly title: string
  readonly creators: readonly ZoteroCreatorView[]
  readonly extra?: string
  readonly date?: string
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  readonly url?: string
  readonly abstract?: string
  readonly abstractTruncated: boolean
  readonly noteBody?: { readonly text: string; readonly truncated: boolean }
  readonly tags: readonly string[]
  readonly collections: readonly { ref: string; name?: string }[]
  readonly children: { readonly total: number }
  readonly bestAttachment?: ZoteroAttachmentRowView
  readonly notes?: ZoteroChildRowsView<ZoteroNoteRowView>
  readonly annotations?: ZoteroChildRowsView<ZoteroAnnotationRowView>
  readonly attachments?: ZoteroChildRowsView<ZoteroAttachmentRowView>
}

/** One child page, discriminated by the kind it carries. */
export type ZoteroChildPageView =
  | { readonly kind: 'notes'; readonly page: ZoteroChildRowsView<ZoteroNoteRowView> }
  | { readonly kind: 'attachments'; readonly page: ZoteroChildRowsView<ZoteroAttachmentRowView> }
  | { readonly kind: 'annotations'; readonly page: ZoteroChildRowsView<ZoteroAnnotationRowView> }

/** The export formats the panel offers; the domain union is the one source. */
export type ZoteroLibraryExportFormatView = ZoteroExportFormat

/**
 * A panel export request: the item refs and format, plus the optional CSL
 * style/locale for citation and bibliography. Omitted style/locale let the
 * host apply its configured defaults, exactly like the tool request.
 */
export interface ZoteroLibraryExportRequestView {
  readonly refs: readonly string[]
  readonly format: ZoteroLibraryExportFormatView
  readonly style?: string
  readonly locale?: string
}

/**
 * A panel export result, discriminated by `format` and mirroring the domain's
 * text arm ({@link ZoteroExportTextResult}): citation pairs each ref with
 * Zotero's own HTML citation, bibliography yields the joined CSL body, and the
 * translator formats carry the merged body only. The panel renders text and
 * citations; per-document itemization stays on the tool's `zotero_export`
 * result and never crosses this boundary.
 */
export type ZoteroLibraryExportResultView =
  | {
      readonly format: 'citation'
      readonly style?: string
      readonly locale?: string
      readonly citations: readonly { readonly ref: string; readonly text: string }[]
    }
  | {
      readonly format: 'bibliography'
      readonly style?: string
      readonly locale?: string
      readonly text: string
    }
  | {
      readonly format: 'bibtex' | 'biblatex' | 'ris' | 'csljson'
      readonly style?: string
      readonly locale?: string
      readonly text: string
    }
  | {
      readonly format: 'csv'
      readonly text: string
    }

/** Strict codec type symbol for {@link ZoteroLibraryBrowseRequestView}. */
export const ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryBrowseRequestView'

/** Strict codec type symbol for {@link ZoteroLibraryBrowseResultView}. */
export const ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryBrowseResultView'

/** Strict codec type symbol for {@link ZoteroLibrarySearchRequestView}. */
export const ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibrarySearchRequestView'

/** Strict codec type symbol for {@link ZoteroSearchResultView}. */
export const ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroSearchResultView'

/** Strict codec type symbol for {@link ZoteroLibraryItemRequestView}. */
export const ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryItemRequestView'

/** Strict codec type symbol for {@link ZoteroItemDetailView}. */
export const ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroItemDetailView'

/** Strict codec type symbol for {@link ZoteroLibraryChildPageRequestView}. */
export const ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroLibraryChildPageRequestView'

/** Strict codec type symbol for {@link ZoteroChildPageView}. */
export const ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroChildPageView'

/** Strict codec type symbol for {@link ZoteroLibraryExportRequestView}. */
export const ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryExportRequestView'

/** Strict codec type symbol for {@link ZoteroLibraryExportResultView}. */
export const ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryExportResultView'

/** Globally stable invocation id for the library browse. */
const ZOTERO_LIBRARY_BROWSE_INVOCATION_ID = 'dsh-zotero#zotero/browse'

/** Globally stable invocation id for the library search. */
const ZOTERO_LIBRARY_SEARCH_INVOCATION_ID = 'dsh-zotero#zotero/search'

/** Globally stable invocation id for the library item detail. */
const ZOTERO_LIBRARY_ITEM_INVOCATION_ID = 'dsh-zotero#zotero/item'

/** Globally stable invocation id for the library child page. */
const ZOTERO_LIBRARY_CHILD_PAGE_INVOCATION_ID = 'dsh-zotero#zotero/childPage'

/** Globally stable invocation id for the library export. */
const ZOTERO_LIBRARY_EXPORT_INVOCATION_ID = 'dsh-zotero#zotero/export'

/** Wire method name for the library browse. */
export const ZOTERO_LIBRARY_BROWSE_METHOD = 'browse'

/** Wire method name for the library search. */
export const ZOTERO_LIBRARY_SEARCH_METHOD = 'search'

/** Wire method name for the library item detail. */
export const ZOTERO_LIBRARY_ITEM_METHOD = 'item'

/** Wire method name for one paged child listing. */
export const ZOTERO_LIBRARY_CHILD_PAGE_METHOD = 'childPage'

/** Wire method name for one citation/BibTeX export. */
export const ZOTERO_LIBRARY_EXPORT_METHOD = 'export'

/**
 * Settings namespace of the library panel's configuration section. Must spell
 * the `cordis.patch.yml` row id (`library`): the harness settings plane
 * addresses every section by its loader entry id, so any other spelling
 * leaves the form permanently unavailable.
 */
export const ZOTERO_LIBRARY_SETTINGS_NAMESPACE = 'library'

/** Cordis service key for the library panel remote service. */
export const ZOTERO_LIBRARY_SERVICE_KEY = 'zoteroLibrary'
export { ZOTERO_ENRICHMENT_SERVICE_KEY }

/**
 * Panel writes use the same closed arguments and execution pipeline as the
 * tools. The type is hand-written here: this module stays free of value
 * imports from the zod layer: and the wire schema in `wire-schemas.ts` is
 * pinned back to it with `satisfies z.ZodType<…>`, so the two cannot drift in
 * either direction.
 */
interface ZoteroLibraryWriteRequest<Operation extends string, Args> {
  readonly sessionId: string
  readonly operation: Operation
  readonly args: Args
}
export interface ZoteroLibraryWriteFields {
  readonly title?: string
  readonly date?: string
  readonly url?: string
  readonly doi?: string
  readonly abstractNote?: string
  readonly publicationTitle?: string
  readonly extra?: string
}
export interface ZoteroLibraryWriteCreator {
  readonly creatorType: string
  readonly name?: string
  readonly firstName?: string
  readonly lastName?: string
}
export interface ZoteroLibraryWriteCreateItem {
  readonly itemType: string
  readonly title?: string
  readonly url?: string
  readonly date?: string
  readonly doi?: string
  readonly abstractNote?: string
  readonly publicationTitle?: string
  readonly tags?: readonly string[]
  readonly collections?: readonly string[]
  readonly creators?: readonly ZoteroLibraryWriteCreator[]
}
export interface ZoteroLibraryWriteBatchUpdate {
  readonly ref: string
  readonly addTags?: readonly string[]
  readonly removeTags?: readonly string[]
  readonly addCollections?: readonly string[]
  readonly removeCollections?: readonly string[]
}
export interface ZoteroLibraryWriteCondition {
  readonly condition: string
  readonly operator: string
  readonly value: string
}
export type ZoteroLibraryWriteRequestView =
  | ZoteroLibraryWriteRequest<'updateItem', { ref: string; set: ZoteroLibraryWriteFields }>
  | ZoteroLibraryWriteRequest<
      'updateTags',
      { ref: string; add?: readonly string[]; remove?: readonly string[] }
    >
  | ZoteroLibraryWriteRequest<
      'updateMembership',
      { ref: string; add?: readonly string[]; remove?: readonly string[] }
    >
  | ZoteroLibraryWriteRequest<'createItem', ZoteroLibraryWriteCreateItem>
  | ZoteroLibraryWriteRequest<
      'createNote',
      {
        markdown: string
        parentItem?: string
        collections?: readonly string[]
        tags?: readonly string[]
        sourceRefs?: readonly string[]
      }
    >
  | ZoteroLibraryWriteRequest<'updateNote', { ref: string; markdown: string }>
  | ZoteroLibraryWriteRequest<'createCollection', { name: string; parent?: string }>
  | ZoteroLibraryWriteRequest<
      'updateCollection',
      { collection: string; name?: string; parent?: string }
    >
  | ZoteroLibraryWriteRequest<'deleteCollection', { collection: string }>
  | ZoteroLibraryWriteRequest<
      'createSavedSearch',
      { name: string; conditions: readonly ZoteroLibraryWriteCondition[] }
    >
  | ZoteroLibraryWriteRequest<
      'updateSavedSearch',
      { search: string; name?: string; conditions?: readonly ZoteroLibraryWriteCondition[] }
    >
  | ZoteroLibraryWriteRequest<'deleteSavedSearch', { search: string }>
  | ZoteroLibraryWriteRequest<'trash', { refs: readonly string[] }>
  | ZoteroLibraryWriteRequest<'restore', { refs: readonly string[] }>
  | ZoteroLibraryWriteRequest<
      'batch',
      {
        create?: readonly ZoteroLibraryWriteCreateItem[]
        update?: readonly ZoteroLibraryWriteBatchUpdate[]
        delete?: readonly string[]
      }
    >
export interface ZoteroLibraryWriteResultView {
  readonly kind: 'applied' | 'declined' | 'committed-unverified' | 'failed'
  readonly message: string
  readonly code?: string
}
export const ZOTERO_LIBRARY_WRITE_METHOD = 'write'
export const ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryWriteRequestView'
export const ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroLibraryWriteResultView'
/**
 * Build one library invocation descriptor: every panel endpoint takes a single
 * named `request` object, so only the id and method differ between them.
 * @param id - the endpoint's generated identity.
 * @param method - the service method the endpoint calls.
 * @param param - the strict parameter codec for the request.
 * @param result - the strict result codec.
 * @returns a complete invocation descriptor.
 */
function libraryInvocation(
  id: string,
  method: string,
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id,
    service: ZOTERO_LIBRARY_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}

/** The panel write invocation (the plan-review card's own endpoint). */
export function zoteroLibraryWriteInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation('dsh-zotero#zotero/write', ZOTERO_LIBRARY_WRITE_METHOD, param, result)
}

/** The panel browse invocation (one navigation listing). */
export function zoteroLibraryBrowseInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation(
    ZOTERO_LIBRARY_BROWSE_INVOCATION_ID,
    ZOTERO_LIBRARY_BROWSE_METHOD,
    param,
    result,
  )
}

/** The panel search invocation (one item-list page over one scope). */
export function zoteroLibrarySearchInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation(
    ZOTERO_LIBRARY_SEARCH_INVOCATION_ID,
    ZOTERO_LIBRARY_SEARCH_METHOD,
    param,
    result,
  )
}

/** The panel item-detail invocation (one ref plus its child pages). */
export function zoteroLibraryItemInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation(
    ZOTERO_LIBRARY_ITEM_INVOCATION_ID,
    ZOTERO_LIBRARY_ITEM_METHOD,
    param,
    result,
  )
}

/** The panel child-page invocation (one ref, one kind, one page window). */
export function zoteroLibraryChildPageInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation(
    ZOTERO_LIBRARY_CHILD_PAGE_INVOCATION_ID,
    ZOTERO_LIBRARY_CHILD_PAGE_METHOD,
    param,
    result,
  )
}

/** The panel export invocation (one item ref plus the citation/BibTeX format). */
export function zoteroLibraryExportInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation(
    ZOTERO_LIBRARY_EXPORT_INVOCATION_ID,
    ZOTERO_LIBRARY_EXPORT_METHOD,
    param,
    result,
  )
}

export interface ZoteroCollectionPathRequestView {
  readonly library: SupportedLocalLibrary
  readonly ref: string
  readonly libraryVersion: number
}
export interface ZoteroCollectionPathResultView {
  readonly library: SupportedLocalLibrary
  readonly libraryVersion: number
  readonly path: readonly ZoteroCollectionRowView[]
}
export const ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroCollectionPathRequestView'
export const ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL = 'dsh-zotero#ZoteroCollectionPathResultView'
export function zoteroCollectionPathInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation('dsh-zotero#zotero/collectionPath', 'collectionPath', param, result)
}

/** A private reading file, released when its last reader closes or the plugin unloads. */
export interface ZoteroUrlPdfView {
  readonly ref: string
  readonly title: string
  readonly contentType: 'application/pdf'
  readonly path: string
  readonly lease: string
}
export function zoteroReadUrlPdfInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation('dsh-zotero#zotero/readUrlPdf', 'readUrlPdf', param, result)
}

export function zoteroReleaseUrlPdfInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return libraryInvocation('dsh-zotero#zotero/releaseUrlPdf', 'releaseUrlPdf', param, result)
}

export interface ZoteroSemanticModelVerifyRequestView {
  readonly model?: string
  readonly modelDir?: string
}

export const ZOTERO_SEMANTIC_MODEL_VERIFY_METHOD = 'verifySemanticModel'
export const ZOTERO_SEMANTIC_MODEL_VERIFY_INVOCATION_ID = 'dsh-zotero#zotero/verifySemanticModel'
export const ZOTERO_SEMANTIC_MODEL_VERIFY_REQUEST_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelVerifyRequestView'
export const ZOTERO_SEMANTIC_MODEL_VERIFY_RESULT_TYPE_SYMBOL =
  'dsh-zotero#ZoteroSemanticModelStatusResultView'

export function zoteroSemanticModelVerifyInvocation(
  param: InvocationDescriptor['parameters'][number]['codec'],
  result: InvocationDescriptor['result'],
): InvocationDescriptor {
  return {
    id: ZOTERO_SEMANTIC_MODEL_VERIFY_INVOCATION_ID,
    service: ZOTERO_ENRICHMENT_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_SEMANTIC_MODEL_VERIFY_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: 'signal' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: param }],
    result,
  }
}
