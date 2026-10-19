/**
 * Resilient HTTP client for external scholarly services.
 *
 * It composes pieces the harness already supplies instead of restating them:
 *
 * - **Deadlines** come from `@deepseek-ai/dsh-timeout`'s `deadline()` /
 *   `timeoutOf()`, so a provider timeout and a caller abort stay
 *   distinguishable. A `setTimeout` signal cannot say which one fired, and the
 *   retry decision differs: a caller who aborted must not be retried at all.
 * - **Bounded reads** come from `transport-bounds.ts`, shared with the local
 *   Zotero transport.
 * - **Host acceptance and pacing** come from `hosts.ts`, the single host table.
 * - **In-flight bounds** come from `ConcurrencyGate`, so a seven-source fan-out
 *   cannot outrun the process-wide slot budget.
 *
 * A redirect is not a success. Counting each 3xx as one resets the breaker's
 * failure count once per hop for a redirect-looping host.
 *
 * @module dsh-zotero/scholarly/transport/http
 */

import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { ConcurrencyGate } from '../../concurrency.js'
import { DEFAULT_MAX_RESPONSE_BYTES } from '../../constants.js'
import { readBoundedBytes, readBoundedText, ResponseTooLargeError } from '../../transport-bounds.js'
import { assertAllowedScholarlyUrl, ScholarlySecurityError } from './allowlist.js'
import { CircuitBreaker, ScholarlyCircuitOpenError } from './circuit-breaker.js'
import { HostPacer, abortableSleep } from './pacing.js'

export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>

/** Deadline code stamped on a provider timeout, so a call can classify it. */
const SCHOLARLY_TIMEOUT = 'SCHOLARLY_TIMEOUT'

/** Default byte ceiling for one response: the same bound the local transport uses. */
export const DEFAULT_MAX_BYTES = DEFAULT_MAX_RESPONSE_BYTES

/** Default per-request deadline. */
export const DEFAULT_TIMEOUT_MS = 25_000

/**
 * One non-2xx response from a scholarly host.
 *
 * Carries the **host only**, never the request URL: a scholarly URL can hold a
 * credential (NCBI's eutils accepts `api_key` nowhere else) or a DOI that is
 * itself sensitive research context, and this object is handed to callers and
 * message formatters. The host is all a caller needs to route on.
 */
export class ScholarlyHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly host: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(
      status === 429
        ? `Rate limited by ${host}${
            retryAfterSeconds === undefined ? '' : ` (retry after ${retryAfterSeconds}s)`
          }`
        : `HTTP ${status} from ${host}`,
    )
    this.name = 'ScholarlyHttpError'
  }
}

/** Raised when a host is refusing requests after repeated failures. */
export { ScholarlyCircuitOpenError } from './circuit-breaker.js'

export { ScholarlySecurityError } from './allowlist.js'

/**
 * Extract an HTTP status code from an error, without unchecked type casts.
 * @param error - the rejection from a transport or registry read.
 * @returns the status code, or undefined when the error carries none.
 */
export function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof ScholarlyHttpError) return error.status
  if (typeof (error as { status?: unknown })?.status === 'number') {
    return (error as { status: number }).status
  }
  return undefined
}

export interface ScholarlyRequestOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  retries?: number
  allowPublicPdf?: boolean
}

export interface ScholarlyHttp {
  bytes(url: string, options?: ScholarlyRequestOptions): Promise<Uint8Array>
  text(url: string, options?: ScholarlyRequestOptions): Promise<string>
  json<T = unknown>(url: string, options?: ScholarlyRequestOptions): Promise<T>
  circuitBreaker: CircuitBreaker
  pacer: HostPacer
}

export interface CreateScholarlyHttpOptions {
  fetchImpl?: FetchFunction
  circuitBreaker?: CircuitBreaker
  pacer?: HostPacer
  /** Process-wide in-flight ceiling for scholarly requests. */
  maxInFlight?: number
}

/**
 * Whether a caller signal has fired.
 *
 * Read through a function so the compiler does not narrow `aborted` to `false`
 * across the request: the caller may abort at any await point.
 * @param signal - the caller's signal, when given.
 * @returns true when it fired.
 */
function callerAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/**
 * Whether a signal fired because the provider's deadline elapsed.
 * @param signal - the fused signal.
 * @returns true when this component's own deadline message is present.
 */
function isProviderTimeout(signal: AbortSignal): boolean {
  return timeoutOf(signal, SCHOLARLY_TIMEOUT) !== undefined
}

export function createScholarlyHttp(options: CreateScholarlyHttpOptions = {}): ScholarlyHttp {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const circuitBreaker = options.circuitBreaker ?? new CircuitBreaker()
  const pacer = options.pacer ?? new HostPacer()
  const gate = new ConcurrencyGate(options.maxInFlight ?? 8)

  const requestWithReader = async <T>(
    url: string,
    reqOptions: ScholarlyRequestOptions = {},
    reader: (response: Response, maxBytes: number) => Promise<T>,
  ): Promise<T> => {
    let currentUrl = url
    let redirectCount = 0
    const maxRedirects = 5
    const maxRetries = reqOptions.retries ?? 2
    const timeoutMs = reqOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = reqOptions.maxBytes ?? DEFAULT_MAX_BYTES

    // The caller's cancellation is the only abort that stops a retry: their
    // signal is checked directly, never inferred from a fused one.
    for (let attempt = 0; ; attempt++) {
      if (callerAborted(reqOptions.signal)) {
        throw reqOptions.signal?.reason ?? new Error('Operation aborted')
      }
      assertAllowedScholarlyUrl(currentUrl, reqOptions.allowPublicPdf ?? false)
      const host = new URL(currentUrl).host

      circuitBreaker.beforeRequest(host)

      await pacer.pace(host, reqOptions.signal)

      const release = await gate.acquire(reqOptions.signal)
      using d = deadline(reqOptions.signal, timeoutMs, SCHOLARLY_TIMEOUT)

      try {
        const response = await fetchImpl(currentUrl, {
          headers: {
            'user-agent': 'dsh-zotero/scholarly (https://github.com/Vncntvx/dsh-zotero)',
            ...reqOptions.headers,
          },
          signal: d.signal,
          redirect: 'manual',
        })

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          // A redirect is neither success nor failure for the host's health;
          // counting it as success would reset a count a peer just raised.
          redirectCount += 1
          if (redirectCount > maxRedirects) {
            throw new ScholarlySecurityError(`Too many redirects (maximum ${maxRedirects})`)
          }
          const location = response.headers.get('location')
          if (location === null) {
            throw new ScholarlyHttpError(response.status, host)
          }
          const nextUrl = new URL(location, currentUrl).href
          assertAllowedScholarlyUrl(nextUrl, reqOptions.allowPublicPdf ?? false)
          currentUrl = nextUrl
          continue
        }

        if (response.ok) {
          circuitBreaker.recordSuccess(host)
          return await reader(response, maxBytes)
        }

        const status = response.status
        circuitBreaker.recordFailure(host, status)
        await response.body?.cancel()

        const retryAfterHeader = Number(response.headers.get('retry-after'))
        const retryAfterSeconds =
          Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined

        if (
          (status === 429 || status === 503) &&
          attempt < maxRetries &&
          (retryAfterSeconds ?? 0) <= 20
        ) {
          const waitMs = Math.max((retryAfterSeconds ?? 0) * 1_000, 1_000 * Math.pow(2, attempt))
          await abortableSleep(waitMs, reqOptions.signal)
          continue
        }

        throw new ScholarlyHttpError(status, host, retryAfterSeconds)
      } catch (error) {
        // Caller cancellation is final: no retry, no translation.
        if (callerAborted(reqOptions.signal)) throw error
        if (error instanceof ScholarlySecurityError) throw error
        if (error instanceof ScholarlyHttpError) throw error
        if (error instanceof ScholarlyCircuitOpenError) throw error
        // An oversized body is a property of the resource, not of the host's
        // health: retrying it re-downloads the same too-large body.
        if (error instanceof ResponseTooLargeError) throw error

        // A provider deadline is one failure of this host; a connection drop is
        // another. Both are retried, and neither is reported as a caller abort.
        if (isProviderTimeout(d.signal) || attempt >= maxRetries) {
          circuitBreaker.recordFailure(host)
          if (isProviderTimeout(d.signal)) {
            throw new ScholarlyHttpError(504, host)
          }
          throw error
        }
        await abortableSleep(1_000 * Math.pow(2, attempt), reqOptions.signal)
        continue
      } finally {
        release()
      }
    }
  }

  const bytes = (url: string, reqOptions?: ScholarlyRequestOptions): Promise<Uint8Array> =>
    requestWithReader(url, reqOptions, readBoundedBytes)

  const text = (url: string, reqOptions?: ScholarlyRequestOptions): Promise<string> =>
    requestWithReader(url, reqOptions, readBoundedText)

  const json = async <T = unknown>(
    url: string,
    reqOptions?: ScholarlyRequestOptions,
  ): Promise<T> => {
    const content = await text(url, {
      ...reqOptions,
      headers: { accept: 'application/json,*/*', ...reqOptions?.headers },
    })
    return JSON.parse(content) as T
  }

  return {
    bytes,
    text,
    json,
    circuitBreaker,
    pacer,
  }
}

/** Re-exported so a caller can classify a deadline without importing the util. */
export { SCHOLARLY_TIMEOUT }
