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
 * Credentials are dispatched **by host**: the Bearer token is attached only to
 * the fixed `mineru.net` API host. Signed upload URLs, result CDN links, and
 * source-URL HEAD requests are returned by the API or supplied by the caller
 * on arbitrary public hosts and must never receive it.
 *
 * A non-2xx response's bounded body is reduced to a sanitized one-line detail
 * (JSON `msg`/`message`, XML `Message`/`Code`, or the first line) so a signed
 * upload's `SignatureDoesNotMatch` is visible in the fallback reason without
 * leaking the signed URL.
 * @module dsh-zotero/parsing/transport
 */

import { isPublicUrl, PublicAddressError } from '../transport/public-url.js'
import {
  resolvePublicAddresses,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from '../transport/network.js'
import { readBoundedBytes, readBoundedText, ResponseTooLargeError } from '../transport-bounds.js'
import { isMineruApiHost } from './hosts.js'

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
  ) {
    super(`HTTP ${status} from ${host}${detail === undefined ? '' : `: ${detail}`}`)
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
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ERROR_DETAIL_MAX_CHARS)
  return cleaned === '' ? undefined : cleaned
}

async function errorDetailOf(response: Response): Promise<string | undefined> {
  try {
    return sanitizedErrorDetail(await readBoundedText(response, ERROR_DETAIL_MAX_BYTES))
  } catch {
    return undefined
  }
}

export class MineruClient {
  constructor(private readonly deps: MineruTransportDeps) {}

  /**
   * Perform one request, following redirects with per-hop re-validation.
   * @returns the bounded response bytes, status, and final response headers.
   */
  async request(
    url: string,
    options: MineruRequestOptions,
  ): Promise<{ status: number; bytes: Uint8Array; headers: Headers }> {
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
        throw new PublicAddressError('MinerU address is not a valid URL.')
      }
      if (parsed.username || parsed.password || !isPublicUrl(parsed.href)) {
        throw new PublicAddressError('MinerU address is not a permitted public HTTP(S) address.')
      }

      const hostname = parsed.hostname
      const addresses = await resolvePublicAddresses(hostname, this.deps.resolver, combined)
      const connection: PinnedDispatcher = this.deps.dispatcher(addresses)

      // Authorization is host-scoped: only the fixed API host ever sees it.
      const headers: Record<string, string> = {
        ...options.headers,
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
            throw new PublicAddressError('HTTPS MinerU redirects may not downgrade to HTTP.')
          }
          currentUrl = next.href
          continue
        }

        if (!response.ok) {
          const detail = await errorDetailOf(response)
          throw new MineruHttpError(response.status, hostname, detail)
        }
        const length = Number(response.headers.get('content-length'))
        if (Number.isFinite(length) && length > maxBytes) {
          await response.body?.cancel()
          throw new ResponseTooLargeError(maxBytes)
        }
        if (options.method === 'HEAD') {
          combined.throwIfAborted()
          return { status: response.status, bytes: new Uint8Array(), headers: response.headers }
        }
        const bytes = await readBoundedBytes(response, maxBytes)
        combined.throwIfAborted()
        return { status: response.status, bytes, headers: response.headers }
      } finally {
        await connection.close()
      }
    }
    throw new MineruHttpError(310, new URL(currentUrl).hostname)
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
    const text = new TextDecoder('utf-8').decode(bytes)
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
  }> {
    const { bytes, headers } = await this.request(url, { ...options, method: 'GET' })
    return { bytes, headers }
  }

  /** HEAD used by the cache to revalidate a URL source without downloading it. */
  async head(
    url: string,
    options: MineruRequestOptions,
  ): Promise<{
    status: number
    headers: Headers
  }> {
    const { status, headers } = await this.request(url, { ...options, method: 'HEAD' })
    return { status, headers }
  }

  /** Decode bounded bytes as UTF-8 text (Markdown download). */
  static textOf(bytes: Uint8Array, maxBytes: number): string {
    if (bytes.byteLength > maxBytes) throw new ResponseTooLargeError(maxBytes)
    return new TextDecoder('utf-8').decode(bytes)
  }
}
