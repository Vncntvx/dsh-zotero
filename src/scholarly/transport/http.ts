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
 *   cannot outrun the process-wide slot budget. A slot covers one attempt's
 *   fetch plus its body read: retry backoff happens outside the gate, so one
 *   host's rate-limit wait cannot starve the other sources of their slots.
 * - **Address safety** is two gates: `allowlist.ts` judges the name lexically
 *   (and refuses non-standard ports), and for the open-access PDF arm — the
 *   only arm that leaves the allowlist — `network.ts` resolves the hostname,
 *   refuses non-public answers, and pins the resolved set into the connection
 *   through an undici `Agent`, so DNS rebinding cannot re-bind the socket.
 *   Every redirect hop re-runs both gates against its own URL.
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
import { resolvePublicAddresses, type AddressResolver, type ResolvedAddress } from './network.js'

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>

/**
 * The host seams both scholarly arms need: the DNS resolver that answers a
 * hostname, the factory that pins a validated closed address set into the
 * open-access PDF arm's per-attempt connection, and the factory for the
 * validating pool the allowlist arm connects through. The host composition
 * supplies them from `host-connections.ts`; a test supplies stubs. When the
 * transport runs without them, every external request fails loud instead of
 * connecting to an unjudged address.
 */
export interface ScholarlyPublicAccess {
  readonly resolver: AddressResolver
  readonly createDispatcher: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher
  readonly createValidatingDispatcher: () => PinnedDispatcher
}

/** One pinned connection: the dispatcher rides in the fetch `init`. */
export interface PinnedDispatcher {
  /** Passed through to fetch as undici's `dispatcher` init extension. */
  readonly dispatcher: unknown
  /** Ends the connection pool once the attempt's response has settled. */
  close(): Promise<void>
}

/** Deadline code stamped on a provider timeout, so a call can classify it. */
const SCHOLARLY_TIMEOUT = 'SCHOLARLY_TIMEOUT'

/** Default byte ceiling for one response: the same bound the local transport uses. */
export const DEFAULT_MAX_BYTES = DEFAULT_MAX_RESPONSE_BYTES

/** Default per-request deadline. */
const DEFAULT_TIMEOUT_MS = 25_000

/** Redirect statuses the loop follows, one hop per attempt. */
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308]

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

interface ScholarlyRequestOptions {
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
  /** Close the shared validating connection pool. Safe to call once. */
  dispose(): Promise<void>
}

interface CreateScholarlyHttpOptions {
  fetchImpl?: FetchFunction
  circuitBreaker?: CircuitBreaker
  pacer?: HostPacer
  /**
   * The host seams both arms connect through: the DNS resolver, the
   * closed-set pinned dispatcher factory for the open-access PDF arm, and
   * the validating pool factory for the allowlist arm. Absent means the
   * transport is not wired, and every external request fails loud instead
   * of connecting to an unjudged address.
   */
  publicAccess?: ScholarlyPublicAccess
  /** The backoff seam; production sleeps abortably, tests substitute it. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
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
  const publicAccess = options.publicAccess
  const sleep = options.sleep ?? abortableSleep

  // One validating connection pool shared by every allowlist fetch: its
  // connector resolves through the DNS seam at connect time and refuses any
  // non-public answer, so every socket's address is judged at the moment it
  // is used. Built lazily, because an http that never fetches builds no
  // agent, and closed by `dispose` with the owning service. The attempt
  // loop already fails loud on an unwired seam before reaching this point;
  // the guard here keeps the closure total.
  let validatingAgent: PinnedDispatcher | undefined
  const sharedValidatingDispatcher = (): PinnedDispatcher => {
    if (publicAccess === undefined) {
      throw new ScholarlySecurityError(
        'Security rejection: the scholarly transport is not wired to an address resolver, so no external request can be fetched safely.',
      )
    }
    validatingAgent ??= publicAccess.createValidatingDispatcher()
    return validatingAgent
  }
  const dispose = (): Promise<void> => validatingAgent?.close() ?? Promise.resolve()

  const requestWithReader = async <T>(
    url: string,
    reqOptions: ScholarlyRequestOptions = {},
    reader: (response: Response, maxBytes: number) => Promise<T>,
  ): Promise<T> => {
    const publicOnly = reqOptions.allowPublicPdf === true
    let currentUrl = url
    let redirectCount = 0
    const maxRedirects = 5
    const maxRetries = reqOptions.retries ?? 2
    const timeoutMs = reqOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = reqOptions.maxBytes ?? DEFAULT_MAX_BYTES

    // The caller's cancellation is the only abort that stops a retry: their
    // signal is checked directly, never inferred from a fused one. A retry
    // delay is paid *after* the gate slot and the pinned agent are released,
    // so one host's rate-limit wait cannot starve the other sources.
    for (let attempt = 0; ; attempt++) {
      if (callerAborted(reqOptions.signal)) {
        throw reqOptions.signal?.reason ?? new Error('Operation aborted')
      }
      assertAllowedScholarlyUrl(currentUrl, publicOnly)
      // The breaker, the pacer, and every error message key on the bare
      // hostname: the interval table has no port column, and a keyed-by-port
      // entry would bypass pacing and split breaker circuits.
      const hostname = new URL(currentUrl).hostname

      circuitBreaker.beforeRequest(hostname)

      await pacer.pace(hostname, reqOptions.signal)

      // Every arm must prove its DNS answer public before it may connect.
      // The open-access PDF arm leaves the allowlist, so it resolves and
      // pins a closed per-attempt set: check-then-connect without pinning is
      // exactly the DNS rebinding window. The allowlist arm shares one
      // validating pool whose connector judges each answer at connect time.
      // A composition that never wired the seams fails loud here instead of
      // connecting to an unjudged address.
      let pinned: PinnedDispatcher | undefined
      if (publicAccess === undefined) {
        throw new ScholarlySecurityError(
          'Security rejection: the scholarly transport is not wired to an address resolver, so no external request can be fetched safely.',
        )
      }
      if (publicOnly) {
        const addresses = await resolvePublicAddresses(hostname, publicAccess.resolver)
        pinned = publicAccess.createDispatcher(addresses)
      }
      const dispatcher = pinned ?? sharedValidatingDispatcher()

      const release = await gate.acquire(reqOptions.signal)
      using d = deadline(reqOptions.signal, timeoutMs, SCHOLARLY_TIMEOUT)
      let retryDelayMs: number | undefined
      try {
        const response = await fetchImpl(currentUrl, {
          headers: {
            'user-agent': 'dsh-zotero/scholarly (https://github.com/Vncntvx/dsh-zotero)',
            ...reqOptions.headers,
          },
          signal: d.signal,
          redirect: 'manual',
          dispatcher: dispatcher.dispatcher,
        } as RequestInit)

        if (REDIRECT_STATUSES.includes(response.status)) {
          // A redirect is neither success nor failure for the host's health;
          // counting it as success would reset a count a peer just raised.
          redirectCount += 1
          if (redirectCount > maxRedirects) {
            throw new ScholarlySecurityError(`Too many redirects (maximum ${maxRedirects})`)
          }
          const location = response.headers.get('location')
          if (location === null) {
            throw new ScholarlyHttpError(response.status, hostname)
          }
          await response.body?.cancel()
          const nextUrl = new URL(location, currentUrl).href
          assertAllowedScholarlyUrl(nextUrl, publicOnly)
          currentUrl = nextUrl
          // The next hop re-runs the lexical gate and its own resolution at
          // the top of the loop; no spacing is owed between hops.
          retryDelayMs = 0
        } else if (response.ok) {
          circuitBreaker.recordSuccess(hostname)
          return await reader(response, maxBytes)
        } else {
          const status = response.status
          circuitBreaker.recordFailure(hostname)
          await response.body?.cancel()

          const retryAfterHeader = Number(response.headers.get('retry-after'))
          const retryAfterSeconds =
            Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined

          if (
            (status === 429 || status === 503) &&
            attempt < maxRetries &&
            (retryAfterSeconds ?? 0) <= 20
          ) {
            retryDelayMs = Math.max((retryAfterSeconds ?? 0) * 1_000, 1_000 * Math.pow(2, attempt))
          } else {
            throw new ScholarlyHttpError(status, hostname, retryAfterSeconds)
          }
        }
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
          circuitBreaker.recordFailure(hostname)
          if (isProviderTimeout(d.signal)) {
            throw new ScholarlyHttpError(504, hostname)
          }
          throw error
        }
        retryDelayMs = 1_000 * Math.pow(2, attempt)
      } finally {
        release()
        // The pinned agent served exactly this attempt's connection; its
        // response body (success, cancelled, or failed) is already settled by
        // the time this finally runs, so the pool can close here.
        await pinned?.close()
      }
      if (callerAborted(reqOptions.signal)) {
        throw reqOptions.signal?.reason ?? new Error('Operation aborted')
      }
      if (retryDelayMs !== undefined && retryDelayMs > 0) {
        await sleep(retryDelayMs, reqOptions.signal)
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
    dispose,
  }
}
