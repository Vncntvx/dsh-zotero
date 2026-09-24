/**
 * The Local API HTTP boundary: plain-loopback `fetch` with a pinned API
 * version, instance-identity protection, a streaming response byte bound,
 * and strict transport-error translation. Every request is request-driven —
 * there is no keep-alive state, no background work, and no redirect
 * following, so a loopback endpoint can never be taken elsewhere.
 * @module dsh-zotero/http-client
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { acquireSlot, ConcurrencyGate } from './concurrency.js'
import {
  ZOTERO_API_VERSION_HEADER,
  ZOTERO_LOCAL_API_VERSION,
  ZOTERO_MAX_INFLIGHT_REQUESTS,
  ZOTERO_SERVER_ID_HEADER,
} from './constants.js'
import {
  API_DISABLED_MESSAGE,
  NOT_RUNNING_MESSAGE,
  RANGE_UNSUPPORTED_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  TOOL_ABORTED_MESSAGE,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_IMPLEMENTED,
  ZOTERO_NOT_RUNNING,
  ZOTERO_RANGE_UNSUPPORTED,
  ZOTERO_RESPONSE_TOO_LARGE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_TIMEOUT,
  ZOTERO_UNEXPECTED,
  ZoteroError,
  errorCauseOf,
  isUnreachableCause,
} from './errors.js'

export interface ZoteroHttpClientOptions {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  /**
   * How many data requests this client keeps in flight. Defaults to
   * {@link ZOTERO_MAX_INFLIGHT_REQUESTS}; a caller that needs more requests
   * at once (tests) may raise it, but no route through the plugin does.
   */
  readonly maxInFlight?: number
}

export interface ZoteroHttpGetOptions {
  /** Caller cancellation; an abort preserves harness cancellation semantics, never a timeout. */
  readonly signal?: AbortSignal
  /** Override the remembered instance id for this request. */
  readonly serverId?: string
  /** Send the remembered instance id (default true); false suppresses it for identity refreshes. */
  readonly sendServerId?: boolean
}

export interface ZoteroHttpResponse {
  readonly body: string
  readonly headers: Headers
}

/** Shown when the provider deadline elapses before Zotero answers. */
export function requestTimeoutMessage(timeoutMs: number): string {
  return `Zotero did not respond within ${timeoutMs} ms.`
}

/** Shown when a transport failure carries no more specific diagnosis. */
export const UNEXPECTED_REQUEST_MESSAGE = 'Zotero local API request failed unexpectedly.'

/** Shown when Zotero answers a request with a redirect, which this client refuses to follow. */
export const REDIRECT_REFUSED_MESSAGE =
  'Zotero responded with a redirect, which this plugin refuses to follow.'

/** Shown when the requested object is not in the library. */
export const OBJECT_NOT_FOUND_MESSAGE = 'Zotero did not find the requested object.'

/** Shown when Zotero answers with an HTTP status this client has no translation for. */
export function httpStatusMessage(status: number): string {
  return `Zotero local API returned HTTP ${status}.`
}

/**
 * Statuses the read and write transports translate identically: redirects
 * (never followed), a missing object, and anything else unmapped. Each
 * transport's own switch handles its specific codes first and falls through
 * here, so the shared arms cannot shadow a specific one.
 * @param status - the response status.
 * @returns the error to throw.
 */
export function sharedHttpStatusError(status: number): ZoteroError {
  if (status >= 300 && status < 400) {
    return new ZoteroError(REDIRECT_REFUSED_MESSAGE, ZOTERO_UNEXPECTED)
  }
  if (status === 404) {
    return new ZoteroError(OBJECT_NOT_FOUND_MESSAGE, ZOTERO_NOT_FOUND)
  }
  return new ZoteroError(httpStatusMessage(status), ZOTERO_UNEXPECTED)
}

/** Shown when a response body is not the JSON the API documents. */
export const UNPARSEABLE_RESPONSE_MESSAGE = 'Zotero returned an unparseable response.'

/** Shown when a response passes the byte bound while streaming. */
export function responseTooLargeMessage(maxResponseBytes: number): string {
  return `Zotero response exceeded the ${maxResponseBytes}-byte limit.`
}

/**
 * The remedy when the running Zotero refused a version older than its own: it
 * is newer than this plugin line, so the plugin is the side to update.
 */
export const NEWER_ZOTERO_ROUTE_MESSAGE =
  'The running Zotero is newer than this plugin line: update dsh-zotero to a version that speaks its local API version.'

/** The remedy when the running Zotero is older than the refused version. */
export function upgradeZoteroRouteMessage(requiredVersion: string): string {
  return `Upgrade Zotero to a version whose local API supports version ${requiredVersion}.`
}

/**
 * Shown when Zotero's local API does not implement the API version this plugin
 * requires. Both sides are named — the version Zotero refused and the version
 * it answered as — because the direction decides which side has to move.
 */
export function apiVersionMismatchMessage(rejected: string, serverVersion: string | null): string {
  const speaks = serverVersion === null ? 'an unnamed version' : `version ${serverVersion}`
  const route =
    serverVersion !== null && Number(serverVersion) > Number(rejected)
      ? NEWER_ZOTERO_ROUTE_MESSAGE
      : upgradeZoteroRouteMessage(ZOTERO_LOCAL_API_VERSION)
  return `Zotero does not implement local API version ${rejected}, which this plugin requires; it answers as ${speaks}. ${route}`
}

/**
 * Shown when a 501 is about the endpoint or its output format rather than the
 * API version. `path` is the API-relative path that was refused, so the model
 * knows which call this build cannot serve.
 */
export function notImplementedRequestMessage(path: string): string {
  return `Zotero's local API does not implement the request this plugin made (${path}), and it reports no API-version problem: the endpoint or its output format is not available in this build. The connection and the API version are fine.`
}

/**
 * Translate a `fetch` or body-read rejection. Caller cancellation and the
 * provider's own deadline win over transport heuristics; the deadline is
 * classified by its stamped reason rather than by engine error names, and
 * the remaining network errors carry the unreachable-instance diagnosis.
 * Shared with the write transport (`write-http.ts`), which adds the
 * write-specific status translations on top of this base.
 * @param error - the rejection to translate.
 * @param signal - the fused deadline signal; its reason identifies the timeout.
 * @param callerSignal - the caller's own signal; its abort always wins.
 * @param timeoutMs - the deadline the timeout message reports.
 */
export function translateFetchError(
  error: unknown,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): never {
  if (error instanceof ZoteroError) {
    throw error
  }
  if (callerSignal?.aborted) {
    throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
  }
  const timeout = timeoutOf(signal, ZOTERO_TIMEOUT)
  if (timeout !== undefined) {
    throw new ZoteroError(requestTimeoutMessage(timeoutMs), ZOTERO_TIMEOUT, {
      cause: timeout,
    })
  }
  if (isUnreachableCause(error)) {
    throw new ZoteroError(NOT_RUNNING_MESSAGE, ZOTERO_NOT_RUNNING, { cause: errorCauseOf(error) })
  }
  throw new ZoteroError(UNEXPECTED_REQUEST_MESSAGE, ZOTERO_UNEXPECTED, {
    cause: errorCauseOf(error),
  })
}

/** The API-relative path of a request URL, as the API's own messages name paths. */
function relativePathOf(url: URL, baseUrlWithSlash: string): string {
  return url.href.startsWith(baseUrlWithSlash)
    ? url.href.slice(baseUrlWithSlash.length)
    : url.pathname
}

/**
 * Zotero's own statement that it does not implement the requested API
 * version (`API version not implemented: 9`, observed live on 10.0.2-beta.9).
 * A 501 carrying anything else is about the endpoint or the format, not the
 * version, and must not be answered with upgrade advice.
 */
const NOT_IMPLEMENTED_VERSION = /^API version not implemented:\s*(\d+)/

/**
 * Translate a non-2xx status. The 412 identity path is handled before this
 * runs.
 * @param response - the non-ok response.
 * @param notImplementedDetail - the body a 501 carried, already read under
 *   the response byte bound; empty when it could not be read.
 * @param path - the API-relative path that was requested, named in the
 *   not-implemented message so the model knows which call this build refuses.
 */
function translateHttpStatus(
  response: Response,
  notImplementedDetail: string,
  path: string,
): never {
  switch (response.status) {
    case 403:
      throw new ZoteroError(API_DISABLED_MESSAGE, ZOTERO_API_DISABLED)
    case 501:
      throw notImplementedError(response, notImplementedDetail, path)
    case 409:
      // A versioned read older than the history the server keeps. Zotero's own
      // sync client reads a 409 on `/deleted` the same way ("'since' value is
      // earlier than the beginning of the delete log"), so it is a fact about
      // the range rather than a fault; the domain that made the request decides
      // what to make of it.
      throw new ZoteroError(RANGE_UNSUPPORTED_MESSAGE, ZOTERO_RANGE_UNSUPPORTED)
    default:
      throw sharedHttpStatusError(response.status)
  }
}

/**
 * Read what a 501 refused. Zotero's Local API refuses two different things
 * with that status — an API version it does not speak, and an output format
 * or method it does not implement — and only its own statement tells them
 * apart.
 *
 * Caller cancellation and the provider deadline still win: the request did
 * reach Zotero, but an aborted or expired read is the caller's own failure,
 * not a fact about the 501. Any other read failure leaves the statement
 * unavailable, and the 501 itself stays the finding.
 */
function notImplementedError(response: Response, detail: string, path: string): ZoteroError {
  const version = NOT_IMPLEMENTED_VERSION.exec(detail.trim())
  if (version === null) {
    return new ZoteroError(notImplementedRequestMessage(path), ZOTERO_NOT_IMPLEMENTED)
  }
  const rejected = version[1]!
  const serverVersion = response.headers.get(ZOTERO_API_VERSION_HEADER)
  return new ZoteroError(apiVersionMismatchMessage(rejected, serverVersion), ZOTERO_API_VERSION)
}

/**
 * Read a response body as text, enforcing the byte bound while streaming.
 * The body is never buffered past the bound, so oversized responses fail
 * before their full size reaches memory. Shared with the write transport,
 * which applies the same bound to every write response.
 */
export async function readBody(response: Response, maxResponseBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const parts: string[] = []
  let total = 0
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxResponseBytes) {
      await reader.cancel()
      throw new ZoteroError(responseTooLargeMessage(maxResponseBytes), ZOTERO_RESPONSE_TOO_LARGE)
    }
    parts.push(decoder.decode(value, { stream: true }))
  }
  // Concatenating the decoded chunks once avoids quadratic string copies on
  // large bodies (the bound above is 16 MiB).
  return parts.join('') + decoder.decode()
}

/**
 * Read what a failure response states, under the response byte bound; shared
 * with the write transport. Caller cancellation and the deadline still win
 * over the statement: the request did reach Zotero, but an aborted read is
 * the caller's failure, not a fact about the refusal. Any other read failure
 * leaves the statement unavailable — the status itself is still the finding.
 */
export async function readFailureStatement(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  try {
    return await readBody(response, maxResponseBytes)
  } catch (error) {
    if (callerSignal?.aborted === true || timeoutOf(signal, ZOTERO_TIMEOUT) !== undefined) {
      translateFetchError(error, signal, callerSignal, timeoutMs)
    }
    return ''
  }
}

/**
 * Zotero's own statement that a write's instance id did not match
 * (`Zotero-Server-ID does not match this server`, `server_localAPI.js:635`
 * at 10.0.2). Zotero shares the 412 status between this identity refusal and
 * version preconditions failing; the statement, not the status, tells them
 * apart. The write transport matches this exact substring and answers
 * everything else with the version-conflict diagnosis, which is the common
 * case for keyed writes.
 */
export const SERVER_ID_MISMATCH_STATEMENT = 'does not match this server'

export class ZoteroHttpClient {
  private currentServerId: string | undefined
  private readonly baseUrlWithSlash: string
  /**
   * One gate for every data request this client makes. Pools bound each
   * call's fan-out, but nothing bounded their product: five concurrent tool
   * calls held twenty requests open against the local server at once. The
   * slots are held for the whole request — connection, body, streamed read —
   * because the bytes are what the bound is for.
   */
  private readonly gate: ConcurrencyGate

  constructor(private readonly options: ZoteroHttpClientOptions) {
    this.baseUrlWithSlash = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`
    this.gate = new ConcurrencyGate(options.maxInFlight ?? ZOTERO_MAX_INFLIGHT_REQUESTS)
  }

  /** The instance id remembered from the latest response carrying one (Zotero 10+). */
  get serverId(): string | undefined {
    return this.currentServerId
  }

  /**
   * GET a path relative to the API base (no leading slash; `''` is `/api/`).
   * @param path - relative path, e.g. `users/0/items/ABCD1234`.
   * @param search - query parameters, serialized verbatim.
   */
  async get(
    path: string,
    search?: URLSearchParams,
    opts: ZoteroHttpGetOptions = {},
  ): Promise<ZoteroHttpResponse> {
    return this.doGet(path, search, opts, false)
  }

  /**
   * GET with the single-refresh guard carried as a positional parameter —
   * deliberately not part of `ZoteroHttpGetOptions`, so no caller can set
   * (or bypass) the identity-refresh recursion guard from outside.
   */
  private async doGet(
    path: string,
    search: URLSearchParams | undefined,
    opts: ZoteroHttpGetOptions,
    isIdentityRefresh: boolean,
  ): Promise<ZoteroHttpResponse> {
    const url = new URL(path, this.baseUrlWithSlash)
    url.search = search?.toString() ?? ''
    // The identity refresh rides the slot of the request that triggered it
    // rather than taking one of its own: it is a single control request, and
    // a refresh that waited for a slot could sit behind the very holder it is
    // refreshing — with every slot held by a request whose 412 is waiting on
    // its own refresh, nothing would ever move.
    const release = isIdentityRefresh ? undefined : await this.takeSlot(opts.signal)
    try {
      return await this.send(url, opts, isIdentityRefresh)
    } finally {
      release?.()
    }
  }

  /**
   * Take one gate slot; a queued abort reports as the caller's cancellation.
   */
  private takeSlot(signal: AbortSignal | undefined): Promise<() => void> {
    return acquireSlot(this.gate, signal)
  }

  /** Send one request and read its body; the caller holds a slot for this. */
  private async send(
    url: URL,
    opts: ZoteroHttpGetOptions,
    isIdentityRefresh: boolean,
  ): Promise<ZoteroHttpResponse> {
    // The deadline fuses caller cancellation with the provider timeout; its
    // TimeoutReason later distinguishes our timeout from caller aborts. It
    // starts here, after the slot was taken, so time spent queued behind the
    // gate is never reported as Zotero failing to respond in time.
    using d = deadline(opts.signal, this.options.timeoutMs, ZOTERO_TIMEOUT)
    const headers: Record<string, string> = {
      [ZOTERO_API_VERSION_HEADER]: ZOTERO_LOCAL_API_VERSION,
    }
    const serverId =
      opts.serverId ?? (opts.sendServerId === false ? undefined : this.currentServerId)
    if (serverId !== undefined) headers[ZOTERO_SERVER_ID_HEADER] = serverId
    let response: Response
    try {
      response = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal: d.signal })
    } catch (error) {
      translateFetchError(error, d.signal, opts.signal, this.options.timeoutMs)
    }
    this.rememberServerId(response.headers)
    if (response.status === 412) {
      // The instance identity changed mid-session. Refresh the identity
      // record so later diagnostics are accurate, but never replay the
      // original request: the ref's provenance no longer matches, and the
      // caller must search again. A failed refresh must not mask the
      // mismatch itself — the original error stays stable and the refresh
      // error rides along as its cause. Caller cancellation still wins, so
      // an aborted refresh aborts the call like any other.
      // Single-refresh guard: the identity refresh runs with
      // `isIdentityRefresh`, so a refresh endpoint that also 412s fails loud
      // instead of recursing into an unbounded 412→refresh→412 loop.
      if (isIdentityRefresh) {
        throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
      }
      let refreshError: unknown
      try {
        await this.refreshIdentity(opts.signal)
      } catch (error) {
        if (opts.signal?.aborted) throw error
        refreshError = error
      }
      throw new ZoteroError(
        SERVER_MISMATCH_MESSAGE,
        ZOTERO_SERVER_MISMATCH,
        refreshError === undefined ? undefined : { cause: refreshError },
      )
    }
    if (!response.ok) {
      // Only a 501 needs its body: Zotero states there what it refused, and
      // that statement is the difference between a version mismatch and an
      // unimplemented endpoint or format. It is read under the same bound;
      // caller cancellation and the deadline still win over the statement.
      const detail =
        response.status === 501
          ? await readFailureStatement(
              response,
              this.options.maxResponseBytes,
              d.signal,
              opts.signal,
              this.options.timeoutMs,
            )
          : ''
      translateHttpStatus(response, detail, relativePathOf(url, this.baseUrlWithSlash))
    }
    // Body reads can still fail mid-stream (connection resets, deadline
    // expiring during transfer, caller abort); route them through the same
    // translation as connection establishment.
    let body: string
    try {
      body = await readBody(response, this.options.maxResponseBytes)
    } catch (error) {
      translateFetchError(error, d.signal, opts.signal, this.options.timeoutMs)
    }
    return { body, headers: response.headers }
  }

  /** GET and parse a JSON response. */
  async getJson<T>(
    path: string,
    search?: URLSearchParams,
    opts: ZoteroHttpGetOptions = {},
  ): Promise<{ json: T; body: string; headers: Headers }> {
    const { body, headers } = await this.get(path, search, opts)
    let json: T
    try {
      json = JSON.parse(body) as T
    } catch (error) {
      throw new ZoteroError(UNPARSEABLE_RESPONSE_MESSAGE, ZOTERO_UNEXPECTED, {
        cause: error,
      })
    }
    return { json, body, headers }
  }

  private rememberServerId(headers: Headers): void {
    const id = headers.get(ZOTERO_SERVER_ID_HEADER)
    if (id !== null && id !== '') this.currentServerId = id
  }

  /** Re-read `/api/` without the remembered id so a stale id cannot 412 the refresh. */
  private async refreshIdentity(signal?: AbortSignal): Promise<void> {
    await this.doGet('', undefined, { signal, sendServerId: false }, true)
  }
}
