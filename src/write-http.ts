/**
 * The Local API write boundary. Zotero 10 gates every local write behind a
 * locally issued API key and the serving instance id, and applies batched
 * objects one transaction each, so this client carries the protocol the
 * running Zotero implements (source-level facts:
 * `chrome/content/zotero/xpcom/server/server_localAPI.js` at 10.0.2):
 *
 * - every write requires the `Zotero-Server-ID` header (428 without, 412 on
 *   mismatch) and a `Zotero-API-Key` issued by `/api/local/authorize`;
 * - single-use keys are consumed at authentication time, before the write
 *   runs — a failed batch still burns them, so 401 means "authorize again";
 * - batches are NOT atomic: each object commits in its own transaction and
 *   per-object outcomes land in the response buckets, so callers map the
 *   buckets and never replay blindly;
 * - `PATCH` merges arrays wholesale (they replace, never union), which is
 *   why the tag/collection domain reads-merges-writes around this client.
 *
 * The transport runs zero retries and no identity refresh: a 401 is reported
 * to the domain, which may authorize once and replay the same batch; a 412
 * that is not an identity mismatch is a version conflict and reaches the
 * model as `ZOTERO_WRITE_CONFLICT`.
 * @module dsh-zotero/write-http
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { acquireSlot, ConcurrencyGate } from './concurrency.js'
import {
  ZOTERO_API_VERSION_HEADER,
  ZOTERO_LIBRARY_VERSION_HEADER,
  ZOTERO_LOCAL_API_VERSION,
  ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS,
  ZOTERO_SERVER_ID_HEADER,
  ZOTERO_WRITE_AUTHORIZE_DEADLINE_MS,
} from './constants.js'
import {
  API_DISABLED_MESSAGE,
  NOT_RUNNING_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  WRITE_AUTH_DENIED_MESSAGE,
  WRITE_AUTH_SHAPE_MESSAGE,
  WRITE_BATCH_REFUSED_MESSAGE,
  WRITE_CONFLICT_MESSAGE,
  WRITE_IDENTITY_MISSING_MESSAGE,
  WRITE_LIBRARY_VERSION_MISSING_MESSAGE,
  WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE,
  WRITE_PRECONDITION_REFUSED_MESSAGE,
  WRITE_UNAUTHORIZED_MESSAGE,
  ZOTERO_API_DISABLED,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_TIMEOUT,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_RATE_LIMITED,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroError,
  type ZoteroErrorCode,
  writeBatchShapeMessage,
  writeRateLimitedMessage,
} from './errors.js'
import {
  SERVER_ID_MISMATCH_STATEMENT,
  UNEXPECTED_REQUEST_MESSAGE,
  UNPARSEABLE_RESPONSE_MESSAGE,
  readBody,
  readFailureStatement,
  sharedHttpStatusError,
  translateFetchError,
} from './http-client.js'
import { asRecord, asString, parseNonNegativeSafeInteger } from './json.js'

export interface ZoteroWriteHttpClientOptions {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
}

/** Options every write carries: cancellation, the serving instance, the local API key. */
export interface ZoteroWriteOptions {
  /** Caller cancellation; an abort preserves harness cancellation semantics. */
  readonly signal?: AbortSignal
  /**
   * The serving instance id, taken from a read response. Zotero refuses a
   * write without it (428) and refuses a mismatched one (412), so this binds
   * every write to the instance the plugin last read from.
   */
  readonly serverId: string
  /** The local API key `/api/local/authorize` issued. */
  readonly apiKey: string
}

export interface ZoteroAuthorizeOptions {
  readonly signal?: AbortSignal
  /** The authorize endpoint is a write-method request: Zotero requires the instance id here too. */
  readonly serverId: string
}

/** One failed object inside a write batch, with Zotero's own status and statement. */
export interface ZoteroWriteObjectFailure {
  readonly key: string
  readonly code: number
  readonly message: string
}

/**
 * The per-object outcome buckets of a write batch. `successful` carries the
 * full response JSON of each written object (key, version, data) — the
 * read-back Zotero performs for the caller, so no follow-up GET is needed
 * for created notes.
 */
export interface ZoteroBatchWrite {
  readonly successful: Record<string, Record<string, unknown>>
  readonly success: Record<string, string>
  readonly unchanged: Record<string, string>
  readonly failed: Record<string, ZoteroWriteObjectFailure>
  /** The library version the batch advanced the library to. */
  readonly libraryVersion: number
}

/**
 * A write request that reached the response/commit boundary but whose
 * outcome could not be proven. Callers that create non-idempotent objects
 * must surface this as a non-retryable, commit-unknown result rather than
 * inviting a second write.
 */
export class ZoteroWriteCommitUnknownError extends ZoteroError {
  constructor(message: string, code: ZoteroErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'ZoteroWriteCommitUnknownError'
  }
}

/** Preserve a typed error's code/message while marking its commit state unknown. */
function asCommitUnknown(error: unknown): ZoteroWriteCommitUnknownError {
  const code = (error instanceof ZoteroError ? error.code : ZOTERO_UNEXPECTED) as ZoteroErrorCode
  const message = error instanceof Error ? error.message : UNEXPECTED_REQUEST_MESSAGE
  return new ZoteroWriteCommitUnknownError(message, code, { cause: error })
}

/** Statuses whose response proves the write was refused before object commit. */
const PRE_COMMIT_WRITE_STATUSES = new Set([
  400, 401, 403, 404, 405, 409, 410, 412, 413, 415, 422, 426, 428, 429, 501,
])

/** Redirects are refused before dispatch, so they cannot represent a commit either. */
function isPreCommitWriteStatus(status: number): boolean {
  return (status >= 300 && status < 400) || PRE_COMMIT_WRITE_STATUSES.has(status)
}

export type ZoteroBatchWriteOptions = ZoteroWriteOptions

export interface ZoteroPatchWriteOptions extends ZoteroWriteOptions {
  /** The object version the caller read; Zotero refuses a stale write with 412. */
  readonly ifUnmodifiedSinceVersion: number
}

export interface ZoteroAuthorizeGrant {
  readonly key: string
  /** True when the user picked "Always Allow"; the key persists until revoked in Zotero. */
  readonly remember: boolean
}

/** The Local API endpoint that issues write keys; local-only, no web API analog. */
const AUTHORIZE_PATH = 'local/authorize'

/**
 * Zotero documents 5–32 characters for `Zotero-Write-Token`; a UUID without
 * its dashes is exactly 32 and unique per attempt, which is the contract the
 * token implements (a retried identical batch must reach Zotero as a new
 * attempt, never as a replay).
 */
function nextWriteToken(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

/** Parse the library version off a write response, or undefined when absent or malformed. */
function libraryVersionOf(headers: Headers): number | undefined {
  return parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER))
}

/** Require the library version off a write response; absence is protocol drift. */
function requireLibraryVersion(headers: Headers): number {
  const libraryVersion = libraryVersionOf(headers)
  if (libraryVersion === undefined) {
    throw new ZoteroError(WRITE_LIBRARY_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  return libraryVersion
}

/**
 * The write transport of the Zotero Local API. One request in flight, no
 * retries, no identity refresh — the write path has exactly one legitimate
 * replay (re-authorize after 401, then send the same batch again) and that
 * replay belongs to the domain, not to transport heuristics.
 */
export class ZoteroWriteHttpClient {
  private readonly baseUrlWithSlash: string
  private readonly gate: ConcurrencyGate

  constructor(private readonly options: ZoteroWriteHttpClientOptions) {
    this.baseUrlWithSlash = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`
    this.gate = new ConcurrencyGate(ZOTERO_MAX_WRITE_INFLIGHT_REQUESTS)
  }

  /**
   * POST a JSON array of write objects. Zotero answers 200 with the
   * per-object buckets and the library version it advanced to; a non-atomic
   * batch reports successes and failures side by side.
   */
  async batch(
    path: string,
    entries: readonly unknown[],
    opts: ZoteroBatchWriteOptions,
  ): Promise<ZoteroBatchWrite> {
    const writeToken = nextWriteToken()
    const { body, headers } = await this.send(
      path,
      'POST',
      opts,
      { 'Zotero-Write-Token': writeToken },
      JSON.stringify(entries),
      undefined,
      true,
    )
    return this.parseBatchWrite(body, requireLibraryVersion(headers))
  }

  /**
   * PATCH a single object (merge semantics per the web API). Zotero answers
   * 204 with the library version only — the written object's version is that
   * same library version, so no follow-up GET is needed.
   */
  async patch(
    path: string,
    body: object,
    opts: ZoteroPatchWriteOptions,
  ): Promise<{ libraryVersion: number }> {
    const { headers } = await this.send(
      path,
      'PATCH',
      opts,
      { 'If-Unmodified-Since-Version': String(opts.ifUnmodifiedSinceVersion) },
      JSON.stringify(body),
      undefined,
      true,
    )
    return { libraryVersion: requireLibraryVersion(headers) }
  }

  /**
   * Request a local write key. Zotero shows its user a dialog — Allow (the
   * key works once, then is consumed), Always Allow (persistent), or Deny.
   * A denial and every other refusal arrive as `ZoteroError`s with
   * write-specific codes and messages; only a grant returns.
   */
  async authorize(appName: string, opts: ZoteroAuthorizeOptions): Promise<ZoteroAuthorizeGrant> {
    const { body } = await this.send(
      AUTHORIZE_PATH,
      'POST',
      { signal: opts.signal, serverId: opts.serverId, apiKey: '' },
      {},
      JSON.stringify({ appName }),
      // The dialog waits for a human: the data deadline must not cut it off.
      ZOTERO_WRITE_AUTHORIZE_DEADLINE_MS,
    )
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch (error) {
      throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED, { cause: error })
    }
    const record = asRecord(json)
    const key = record === undefined ? undefined : asString(record.key)
    if (key === undefined || key === '') {
      throw new ZoteroError(WRITE_AUTH_SHAPE_MESSAGE, ZOTERO_UNEXPECTED)
    }
    return { key, remember: record?.remember === true }
  }

  /**
   * Send one write request. The gate slot is held across connection, body
   * and streamed response read, exactly like the read transport; the
   * deadline starts after the slot so queue time is never Zotero latency.
   */
  private async send(
    path: string,
    method: 'POST' | 'PATCH',
    opts: ZoteroWriteOptions,
    extraHeaders: Record<string, string>,
    body: string,
    deadlineMs: number = this.options.timeoutMs,
    commitSensitive = false,
  ): Promise<{ body: string; headers: Headers }> {
    if (opts.serverId === '') {
      throw new ZoteroError(WRITE_IDENTITY_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
    }
    const url = new URL(path, this.baseUrlWithSlash)
    const release = await this.takeSlot(opts.signal)
    try {
      using d = deadline(opts.signal, deadlineMs, ZOTERO_TIMEOUT)
      const headers: Record<string, string> = {
        [ZOTERO_API_VERSION_HEADER]: ZOTERO_LOCAL_API_VERSION,
        [ZOTERO_SERVER_ID_HEADER]: opts.serverId,
        ...extraHeaders,
      }
      if (opts.apiKey !== '') headers['Zotero-API-Key'] = opts.apiKey
      headers['Content-Type'] = 'application/json'
      // If cancellation or the provider deadline won before dispatch, no write
      // can have committed and the caller must see the ordinary cancellation or
      // timeout rather than a false commit-unknown outcome.
      if (opts.signal?.aborted || d.signal.aborted) {
        translateFetchError(new Error(), d.signal, opts.signal, deadlineMs)
      }
      let response: Response
      try {
        response = await fetch(url, { method, headers, body, redirect: 'manual', signal: d.signal })
      } catch (error) {
        // Translate first so timeout/abort keep their typed codes; a
        // commit-sensitive write then marks that typed failure as
        // commit-unknown without collapsing the code to UNEXPECTED.
        try {
          translateFetchError(error, d.signal, opts.signal, deadlineMs)
        } catch (translated) {
          if (
            opts.signal?.aborted ||
            (translated instanceof HarnessError && translated.code === TOOL_ABORTED)
          ) {
            throw translated
          }
          if (commitSensitive) throw asCommitUnknown(translated)
          throw translated
        }
      }
      const observedServerId = response.headers.get(ZOTERO_SERVER_ID_HEADER)
      // A response from another instance is never translated as this write's
      // refusal. This check also covers error responses, whose bodies may use
      // different wording than the read transport's identity statement.
      if (observedServerId !== null && observedServerId !== opts.serverId) {
        throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
      }
      if (!response.ok) {
        // Zotero states its refusals in the body for the statuses the write
        // path distinguishes (the 403 deny grant, the 412 identity-vs-version
        // fork); read those under the bound, everything else by status.
        let detail = ''
        try {
          detail =
            response.status === 401 || response.status === 403 || response.status === 412
              ? await readFailureStatement(
                  response,
                  this.options.maxResponseBytes,
                  d.signal,
                  opts.signal,
                  deadlineMs,
                )
              : ''
          this.translateWriteStatus(response, detail)
        } catch (error) {
          if (commitSensitive && !isPreCommitWriteStatus(response.status)) {
            throw asCommitUnknown(error)
          }
          throw error
        }
      }
      if (observedServerId === null) {
        const error = new ZoteroError(WRITE_RESPONSE_IDENTITY_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
        throw commitSensitive ? asCommitUnknown(error) : error
      }
      let responseBody: string
      try {
        responseBody = await readBody(response, this.options.maxResponseBytes)
      } catch (error) {
        try {
          translateFetchError(error, d.signal, opts.signal, deadlineMs)
        } catch (translated) {
          throw commitSensitive ? asCommitUnknown(translated) : translated
        }
      }
      return { body: responseBody, headers: response.headers }
    } finally {
      release()
    }
  }

  /**
   * Take the single write slot; a queued abort reports as the caller's
   * cancellation.
   */
  private takeSlot(signal: AbortSignal | undefined): Promise<() => void> {
    return acquireSlot(this.gate, signal)
  }

  /**
   * Translate a non-2xx write response. The write path maps Zotero's own
   * statuses onto the plugin's write vocabulary: 401/403/429/412 carry
   * write-specific codes, and the two statuses that cannot happen if the
   * plugin is correct (428, 413) fail loud as protocol drift instead of
   * being disguised as domain errors.
   */
  private translateWriteStatus(response: Response, detail: string): never {
    const status = response.status
    switch (status) {
      case 401:
        throw new ZoteroError(WRITE_UNAUTHORIZED_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED)
      case 403: {
        // The status carries two different facts: the local API being
        // disabled in Zotero's preferences (plain text) and the authorize
        // dialog being declined (a JSON grant refusal). The body tells them
        // apart; unparseable detail means the API-disabled statement.
        let json: unknown
        try {
          json = JSON.parse(detail)
        } catch {
          json = undefined
        }
        if (asRecord(json)?.denied === true) {
          throw new ZoteroError(WRITE_AUTH_DENIED_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED)
        }
        throw new ZoteroError(API_DISABLED_MESSAGE, ZOTERO_API_DISABLED)
      }
      case 412:
        if (detail.includes(SERVER_ID_MISMATCH_STATEMENT)) {
          throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
        }
        throw new ZoteroError(WRITE_CONFLICT_MESSAGE, ZOTERO_WRITE_CONFLICT)
      case 428:
        throw new ZoteroError(WRITE_PRECONDITION_REFUSED_MESSAGE, ZOTERO_UNEXPECTED)
      case 429: {
        const raw = response.headers.get('retry-after')
        const waitSeconds = raw === null ? undefined : Number(raw)
        throw new ZoteroError(
          writeRateLimitedMessage(
            waitSeconds !== undefined && Number.isFinite(waitSeconds) ? waitSeconds : undefined,
          ),
          ZOTERO_WRITE_RATE_LIMITED,
        )
      }
      case 413:
        throw new ZoteroError(WRITE_BATCH_REFUSED_MESSAGE, ZOTERO_UNEXPECTED)
      default:
        throw sharedHttpStatusError(status)
    }
  }

  /**
   * Parse the batch outcome buckets. The documented write shape names four
   * buckets and Zotero answers with all of them; a bucket that is present
   * but malformed is protocol drift and fails loud rather than being
   * silently reshaped.
   */
  private parseBatchWrite(body: string, libraryVersion: number): ZoteroBatchWrite {
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch (error) {
      throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED, { cause: error })
    }
    const record = asRecord(json)
    if (record === undefined) {
      throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED)
    }
    const failed: Record<string, ZoteroWriteObjectFailure> = {}
    for (const [index, entry] of Object.entries(bucketOf(record, 'failed'))) {
      const shape = asRecord(entry)
      const key = shape === undefined ? undefined : asString(shape.key)
      const message = shape === undefined ? undefined : asString(shape.message)
      const code = shape === undefined ? undefined : shape.code
      if (
        key === undefined ||
        message === undefined ||
        typeof code !== 'number' ||
        !Number.isFinite(code)
      ) {
        throw new ZoteroError(writeBatchShapeMessage('failed'), ZOTERO_UNEXPECTED)
      }
      failed[index] = { key, code, message }
    }
    const successful: Record<string, Record<string, unknown>> = {}
    for (const [index, entry] of Object.entries(bucketOf(record, 'successful'))) {
      const shape = asRecord(entry)
      if (shape === undefined) {
        throw new ZoteroError(writeBatchShapeMessage('successful'), ZOTERO_UNEXPECTED)
      }
      successful[index] = shape
    }
    return {
      successful,
      success: stringBucketOf(record, 'success'),
      unchanged: stringBucketOf(record, 'unchanged'),
      failed,
      libraryVersion,
    }
  }
}

/** Read one bucket of the batch response, tolerating absence, refusing malformed shapes. */
function bucketOf(record: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = record[name]
  if (value === undefined) return {}
  const bucket = asRecord(value)
  if (bucket === undefined) {
    throw new ZoteroError(writeBatchShapeMessage(name), ZOTERO_UNEXPECTED)
  }
  return bucket
}

/** Read a key→string bucket (success/unchanged), tolerating absence, refusing malformed shapes. */
function stringBucketOf(record: Record<string, unknown>, name: string): Record<string, string> {
  const bucket: Record<string, string> = {}
  for (const [index, entry] of Object.entries(bucketOf(record, name))) {
    const key = asString(entry)
    if (key === undefined) {
      throw new ZoteroError(writeBatchShapeMessage(name), ZOTERO_UNEXPECTED)
    }
    bucket[index] = key
  }
  return bucket
}
