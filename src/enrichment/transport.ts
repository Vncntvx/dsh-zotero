/**
 * The MinerU HTTP client.
 *
 * One request path covers submit, signed upload, poll, result download, and
 * the cache's HEAD revalidation. It composes the same public-address double
 * gate the URL-PDF reader uses: `isPublicUrl` (lexical: HTTP(S), port 80/443,
 * no private/literal hosts) and `resolvePublicAddresses` + a pinned dispatcher
 * (DNS answers judged public and pinned into the socket, so rebinding cannot
 * re-point it). Every redirect hop re-runs both gates against its own URL.
 *
 * Every MinerU address is HTTPS (the API schemas refuse plain HTTP), so an
 * HTTPS target accepts the local proxy's fake-IP placeholder the way the
 * open-access PDF arm does: the TLS certificate binds the peer to the
 * requested name, which the placeholder itself does not. A plain-HTTP target
 * and an IP literal keep the strict judgment — the exception applies to a
 * resolver's answer, never to an address a URL spells.
 *
 * Credentials are dispatched **by host**: the Bearer token is attached only to
 * the fixed `mineru.net` API host. Signed upload URLs, result CDN links, and
 * source-URL HEAD requests are returned by the API or supplied by the caller
 * on arbitrary public hosts and must never receive it.
 *
 * A non-2xx response's bounded body is reduced to a sanitized one-line detail
 * (JSON `msg`/`message`, XML `Message`/`Code`, or the first line) so a signed
 * upload's `SignatureDoesNotMatch` is visible in the error without
 * leaking the signed URL.
 * @module dsh-zotero/enrichment/transport
 */

import { isPublicUrl, PublicAddressError } from '../transport/public-url.js'
import {
  isIpv4Literal,
  resolvePublicAddresses,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from '../transport/network.js'
import { readBoundedBytes, readBoundedText, ResponseTooLargeError } from '../transport-bounds.js'
import { isMineruApiHost, MINERU_API_ORIGIN } from './hosts.js'
import { ConcurrencyGate } from '../concurrency.js'
import { setTimeout as delay } from 'node:timers/promises'

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>

/** The host seams, injectable so unit tests never open a real socket. */
export interface MineruTransportDeps {
  readonly resolver: AddressResolver
  readonly dispatcher: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher
  readonly fetch: FetchFunction
}

/** One non-2xx response. Carries host and a sanitized detail, never a URL. */
export class MineruHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly host: string,
    public readonly detail?: string,
    public readonly apiCode?: string | number,
    public readonly traceId?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(
      `HTTP ${status} from ${host}${detail === undefined ? '' : `: ${detail}`}${apiCode === undefined ? '' : ` (MinerU ${apiCode})`}${traceId === undefined ? '' : ` [trace ${traceId}]`}`,
    )
    this.name = 'MineruHttpError'
  }
}

export interface MineruRequestOptions {
  readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT'
  readonly headers?: Record<string, string>
  readonly body?: string | Uint8Array
  /** Resolved precise-API token; attached only to `mineru.net` requests. */
  readonly token?: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

export interface MineruResponse {
  readonly status: number
  readonly bytes: Uint8Array
  readonly headers: Headers
  /** The validated terminal request URL, independent of Response.url. */
  readonly finalUrl: string
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const ERROR_DETAIL_MAX_BYTES = 4 * 1024
const ERROR_DETAIL_MAX_CHARS = 256
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308]
const MAX_REDIRECTS = 5

/** Reduce an error body to a bounded, URL-free one-liner. */
export function sanitizedErrorDetail(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  let message: string | undefined
  try {
    const parsed = JSON.parse(trimmed) as {
      msg?: unknown
      message?: unknown
      Message?: unknown
      code?: unknown
      Code?: unknown
    }
    const candidate = parsed.msg ?? parsed.message ?? parsed.Message
    const code = parsed.code ?? parsed.Code
    if (typeof candidate === 'string' && candidate.trim() !== '') message = candidate
    else if (typeof code === 'string' && code.trim() !== '') message = code
  } catch {
    // Not JSON; try XML below.
  }
  if (message === undefined) {
    const xmlMessage = /<Message>([^<]*)<\/Message>/i.exec(trimmed)?.[1]
    const xmlCode = /<Code>([^<]*)<\/Code>/i.exec(trimmed)?.[1]
    message = xmlMessage?.trim() || xmlCode?.trim()
  }
  if (message === undefined) message = trimmed.split(/\r?\n/)[0]
  const cleaned = (message ?? '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ERROR_DETAIL_MAX_CHARS)
  return cleaned === '' ? undefined : cleaned
}

async function errorOf(response: Response, hostname: string): Promise<MineruHttpError> {
  let detail: string | undefined
  let apiCode: string | number | undefined
  let traceId: string | undefined
  try {
    const body = await readBoundedText(response, ERROR_DETAIL_MAX_BYTES)
    detail = sanitizedErrorDetail(body)
    try {
      const data = JSON.parse(body) as Record<string, unknown>
      if (
        typeof data.code === 'number' ||
        (typeof data.code === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(data.code))
      )
        apiCode = data.code
      if (typeof data.trace_id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(data.trace_id))
        traceId = data.trace_id
    } catch {
      /* Non-JSON errors still retain their sanitized detail. */
    }
  } catch {
    /* An oversized error body is discarded. */
  }
  const raw = response.headers.get('retry-after')
  const seconds = raw === null ? NaN : Number(raw)
  const retryAfterMs =
    raw === null
      ? undefined
      : Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Math.max(0, Date.parse(raw) - Date.now())
  return new MineruHttpError(
    response.status,
    hostname,
    detail,
    apiCode,
    traceId,
    Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
  )
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal })
  } catch (error) {
    signal.throwIfAborted()
    throw error
  }
}

export class MineruClient {
  private readonly gate = new ConcurrencyGate(4)
  private blockedUntil = 0

  constructor(private readonly deps: MineruTransportDeps) {}

  /**
   * Perform one request, following redirects with per-hop re-validation.
   * @returns the bounded bytes, status, headers, and validated terminal URL.
   */
  private async attempt(url: string, options: MineruRequestOptions): Promise<MineruResponse> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    const timeout = AbortSignal.timeout(timeoutMs)
    const signals = options.signal === undefined ? [timeout] : [options.signal, timeout]
    const combined = AbortSignal.any(signals)

    let currentUrl = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      combined.throwIfAborted()
      let parsed: URL
      try {
        parsed = new URL(currentUrl)
      } catch {
        throw new PublicAddressError('MinerU address is not a valid URL.', 'policy')
      }
      if (parsed.username || parsed.password || !isPublicUrl(parsed.href)) {
        throw new PublicAddressError(
          'MinerU address is not a permitted public HTTP(S) address.',
          'policy',
        )
      }

      const hostname = parsed.hostname
      if (isMineruApiHost(hostname) && parsed.origin !== MINERU_API_ORIGIN)
        throw new PublicAddressError(
          'MinerU API requests require the fixed HTTPS origin.',
          'policy',
        )
      const addresses = await resolvePublicAddresses(hostname, this.deps.resolver, {
        signal: combined,
        acceptFakeIp: parsed.protocol === 'https:' && !isIpv4Literal(hostname),
      })
      const connection: PinnedDispatcher = this.deps.dispatcher(addresses)

      // Authorization is host-scoped: only the fixed API host ever sees it.
      const suppliedHeaders = Object.fromEntries(
        Object.entries(options.headers ?? {}).filter(
          ([key]) => key.toLowerCase() !== 'authorization',
        ),
      )
      const headers: Record<string, string> = {
        ...suppliedHeaders,
        ...(options.token !== undefined && isMineruApiHost(hostname)
          ? { authorization: `Bearer ${options.token}` }
          : {}),
      }

      try {
        const response = await this.deps.fetch(parsed.href, {
          method: options.method,
          headers,
          body: options.body as RequestInit['body'],
          redirect: 'manual',
          signal: combined,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          dispatcher: connection.dispatcher,
        } as RequestInit)

        if (REDIRECT_STATUSES.includes(response.status)) {
          const location = response.headers.get('location')
          await response.body?.cancel()
          if (location === null || hop === MAX_REDIRECTS) {
            throw new MineruHttpError(response.status, hostname)
          }
          const next = new URL(location, parsed)
          if (parsed.protocol === 'https:' && next.protocol !== 'https:') {
            throw new PublicAddressError(
              'HTTPS MinerU redirects may not downgrade to HTTP.',
              'policy',
            )
          }
          if (
            isMineruApiHost(hostname) ||
            (options.method === 'PUT' && response.status !== 307 && response.status !== 308) ||
            options.method === 'POST'
          )
            throw new MineruHttpError(response.status, hostname, 'Unsafe request redirect refused')
          currentUrl = next.href
          continue
        }

        if (!response.ok) {
          throw await errorOf(response, hostname)
        }
        if (response.status === 206)
          throw new MineruHttpError(206, hostname, 'Partial response refused')
        const length = Number(response.headers.get('content-length'))
        if (Number.isFinite(length) && length > maxBytes) {
          await response.body?.cancel()
          throw new ResponseTooLargeError(maxBytes)
        }
        if (options.method === 'HEAD') {
          combined.throwIfAborted()
          return {
            status: response.status,
            bytes: new Uint8Array(),
            headers: response.headers,
            finalUrl: parsed.href,
          }
        }
        const bytes = await readBoundedBytes(response, maxBytes)
        combined.throwIfAborted()
        return { status: response.status, bytes, headers: response.headers, finalUrl: parsed.href }
      } finally {
        await connection.close()
      }
    }
    throw new MineruHttpError(310, new URL(currentUrl).hostname)
  }

  /** Retry only idempotent operations, bounded by one shared request deadline. */
  async request(url: string, options: MineruRequestOptions): Promise<MineruResponse> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal])
    // Cache revalidation is one HEAD operation; a failed probe cannot create
    // extra network requests or silently acquire the document with GET.
    const attempts = options.method === 'POST' || options.method === 'HEAD' ? 1 : 3
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted()
      if (this.blockedUntil > Date.now()) await pause(this.blockedUntil - Date.now(), signal)
      let release: (() => void) | undefined
      let retryMs = 0
      try {
        release = await this.gate.acquire(signal)
        if (this.blockedUntil > Date.now()) await pause(this.blockedUntil - Date.now(), signal)
        const response = await this.attempt(url, { ...options, signal })
        signal.throwIfAborted()
        return response
      } catch (error) {
        signal.throwIfAborted()
        const transient =
          error instanceof MineruHttpError
            ? [408, 429, 500, 502, 503, 504].includes(error.status)
            : error instanceof TypeError ||
              (error instanceof Error &&
                ['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT'].includes(
                  String((error as NodeJS.ErrnoException).code),
                ))
        retryMs =
          error instanceof MineruHttpError && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : 1000 * 2 ** attempt
        if (error instanceof MineruHttpError && error.status === 429)
          this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryMs)
        if (!transient || attempt + 1 === attempts) throw error
      } finally {
        release?.()
      }
      await pause(retryMs, signal)
    }
    throw new Error('MinerU retry budget exhausted')
  }

  /** JSON request/response with a bounded body. */
  async json<T>(url: string, options: MineruRequestOptions): Promise<T> {
    const { bytes } = await this.request(url, {
      ...options,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...options.headers,
      },
    })
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error('MinerU returned a malformed JSON response.', { cause: error })
    }
  }

  /** Raw-byte request/response (signed upload, result download). */
  async bytes(url: string, options: MineruRequestOptions): Promise<Uint8Array> {
    return (await this.request(url, options)).bytes
  }

  /** GET returning the bounded body and its response headers. */
  async get(
    url: string,
    options: MineruRequestOptions,
  ): Promise<{
    bytes: Uint8Array
    headers: Headers
    finalUrl: string
  }> {
    const { bytes, headers, finalUrl } = await this.request(url, { ...options, method: 'GET' })
    return { bytes, headers, finalUrl }
  }

  /** HEAD used by the cache to revalidate a URL source without downloading it. */
  async head(
    url: string,
    options: MineruRequestOptions,
  ): Promise<{
    status: number
    headers: Headers
    finalUrl: string
  }> {
    const { status, headers, finalUrl } = await this.request(url, { ...options, method: 'HEAD' })
    return { status, headers, finalUrl }
  }

  /** Decode bounded bytes as UTF-8 text (Markdown download). */
  static textOf(bytes: Uint8Array, maxBytes: number): string {
    if (bytes.byteLength > maxBytes) throw new ResponseTooLargeError(maxBytes)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
}
