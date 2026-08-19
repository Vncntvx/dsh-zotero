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
import {
  API_DISABLED_MESSAGE,
  NOT_RUNNING_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  ZOTERO_API_DISABLED,
  ZOTERO_API_VERSION,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_RUNNING,
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

/**
 * Translate a `fetch` or body-read rejection. Caller cancellation and the
 * provider's own deadline win over transport heuristics; the deadline is
 * classified by its stamped reason rather than by engine error names, and
 * the remaining network errors carry the unreachable-instance diagnosis.
 * @param error - the rejection to translate.
 * @param signal - the fused deadline signal; its reason identifies the timeout.
 * @param callerSignal - the caller's own signal; its abort always wins.
 * @param timeoutMs - the deadline the timeout message reports.
 */
function translateFetchError(
  error: unknown,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): never {
  if (error instanceof ZoteroError) {
    throw error
  }
  if (callerSignal?.aborted) {
    throw new HarnessError('tool call aborted', TOOL_ABORTED)
  }
  const timeout = timeoutOf(signal, ZOTERO_TIMEOUT)
  if (timeout !== undefined) {
    throw new ZoteroError(`Zotero did not respond within ${timeoutMs} ms.`, ZOTERO_TIMEOUT, {
      cause: timeout,
    })
  }
  if (isUnreachableCause(error)) {
    throw new ZoteroError(NOT_RUNNING_MESSAGE, ZOTERO_NOT_RUNNING, { cause: errorCauseOf(error) })
  }
  throw new ZoteroError('Zotero local API request failed unexpectedly.', ZOTERO_UNEXPECTED, {
    cause: errorCauseOf(error),
  })
}

/** Translate a non-2xx status. The 412 identity path is handled before this runs. */
function translateHttpStatus(response: Response): never {
  if (response.status >= 300 && response.status < 400) {
    throw new ZoteroError(
      'Zotero responded with a redirect, which this plugin refuses to follow.',
      ZOTERO_UNEXPECTED,
    )
  }
  switch (response.status) {
    case 403:
      throw new ZoteroError(API_DISABLED_MESSAGE, ZOTERO_API_DISABLED)
    case 501: {
      const version = response.headers.get('zotero-api-version') ?? 'unknown'
      throw new ZoteroError(
        `Zotero speaks API version ${version}, but this plugin requires version 3. Upgrade Zotero to a version whose local API supports version 3.`,
        ZOTERO_API_VERSION,
      )
    }
    case 404:
      throw new ZoteroError('Zotero did not find the requested object.', ZOTERO_NOT_FOUND)
    default:
      throw new ZoteroError(`Zotero local API returned HTTP ${response.status}.`, ZOTERO_UNEXPECTED)
  }
}

/**
 * Read a response body as text, enforcing the byte bound while streaming.
 * The body is never buffered past the bound, so oversized responses fail
 * before their full size reaches memory.
 */
async function readBody(response: Response, maxResponseBytes: number): Promise<string> {
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
      throw new ZoteroError(
        `Zotero response exceeded the ${maxResponseBytes}-byte limit.`,
        ZOTERO_RESPONSE_TOO_LARGE,
      )
    }
    parts.push(decoder.decode(value, { stream: true }))
  }
  // Concatenating the decoded chunks once avoids quadratic string copies on
  // large bodies (the bound above is 16 MiB).
  return parts.join('') + decoder.decode()
}

export class ZoteroHttpClient {
  private currentServerId: string | undefined
  private readonly baseUrlWithSlash: string

  constructor(private readonly options: ZoteroHttpClientOptions) {
    this.baseUrlWithSlash = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`
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
    const url = new URL(path, this.baseUrlWithSlash)
    url.search = search?.toString() ?? ''
    // The deadline fuses caller cancellation with the provider timeout; its
    // TimeoutReason later distinguishes our timeout from caller aborts.
    using d = deadline(opts.signal, this.options.timeoutMs, ZOTERO_TIMEOUT)
    const headers: Record<string, string> = { 'Zotero-API-Version': '3' }
    const serverId =
      opts.serverId ?? (opts.sendServerId === false ? undefined : this.currentServerId)
    if (serverId !== undefined) headers['Zotero-Server-ID'] = serverId
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
      translateHttpStatus(response)
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
      throw new ZoteroError('Zotero returned an unparseable response.', ZOTERO_UNEXPECTED, {
        cause: error,
      })
    }
    return { json, body, headers }
  }

  private rememberServerId(headers: Headers): void {
    const id = headers.get('zotero-server-id')
    if (id !== null && id !== '') this.currentServerId = id
  }

  /** Re-read `/api/` without the remembered id so a stale id cannot 412 the refresh. */
  private async refreshIdentity(signal?: AbortSignal): Promise<void> {
    await this.get('', undefined, { signal, sendServerId: false })
  }
}
