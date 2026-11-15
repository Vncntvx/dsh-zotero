/** User-initiated, bounded PDF downloads. Never constructs scholarly services. */
import { PublicAddressError, isPublicUrl } from '../transport/public-url.js'
import { deadline } from '@deepseek-ai/dsh-timeout'
import {
  resolvePublicAddresses,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from '../transport/network.js'
import { readBoundedBytes, ResponseTooLargeError } from '../transport-bounds.js'
import type { PublicFetch } from '../transport/connections.js'
import { egressRouteFor } from '../transport/connections.js'
import { ZoteroError } from '../errors.js'
import type { ZoteroAttachmentLocationView } from '../contract.js'

export const URL_PDF_MAX_BYTES = 32 * 1024 * 1024
export const URL_PDF_TIMEOUT_MS = 60_000
/** The deadline's TimeoutReason code for a panel PDF download. */
const URL_PDF_TIMEOUT_REASON = 'zotero/url-pdf-download-timeout'
export interface UrlPdfDependencies {
  readonly allowed: () => boolean
  readonly resolver: AddressResolver
  readonly dispatcher: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher
  readonly fetch: PublicFetch
}
const failure = (
  suffix:
    | 'DISABLED'
    | 'BUSY'
    | 'NOT_URL'
    | 'REDIRECT'
    | 'HTTP'
    | 'NOT_PDF'
    | 'TIMEOUT'
    | 'FORBIDDEN_TARGET'
    | 'TOO_LARGE'
    | 'NETWORK',
  message: string,
) => new ZoteroError(message, `ZOTERO_URL_PDF_${suffix}`)

export class UrlPdfReader {
  private readonly running = new Set<AbortController>()
  constructor(private readonly deps: UrlPdfDependencies) {}
  revoke(): void {
    if (this.deps.allowed()) return
    for (const controller of this.running)
      controller.abort(failure('DISABLED', 'URL PDF reading permission was revoked.'))
  }
  /**
   * Stop every in-flight download because the capability itself is going
   * away (the plugin unmounted). The read's own catch treats an aborted
   * controller as the caller's verdict and rethrows this reason, so teardown
   * does not wait out a download's remaining deadline.
   */
  dispose(): void {
    for (const controller of this.running)
      controller.abort(new DOMException('URL PDF reading was disposed', 'AbortError'))
  }
  async read(
    attachment: ZoteroAttachmentLocationView,
    signal: AbortSignal,
  ): Promise<{ ref: string; title: string; contentType: 'application/pdf'; data: Uint8Array }> {
    if (!this.deps.allowed())
      throw failure('DISABLED', 'URL PDF reading is disabled in Literature panel settings.')
    if (this.running.size >= 2)
      throw failure('BUSY', 'Two PDF downloads are already running. Try again after one finishes.')
    const controller = new AbortController()
    this.running.add(controller)
    // The download deadline fused with the caller's cancellation and the
    // reader's release; its TimeoutReason is what the catch below maps to
    // the panel's TIMEOUT refusal.
    using timeoutScope = deadline(signal, URL_PDF_TIMEOUT_MS, URL_PDF_TIMEOUT_REASON)
    const timeout = timeoutScope.signal
    const combined = AbortSignal.any([timeout, controller.signal])
    try {
      if (attachment.kind !== 'url' || !attachment.url)
        throw failure('NOT_URL', 'This attachment is not a URL PDF.')
      let url = new URL(attachment.url)
      for (let hop = 0; hop <= 5; hop++) {
        combined.throwIfAborted()
        if (!this.deps.allowed()) throw failure('DISABLED', 'URL PDF reading is disabled.')
        if (url.username || url.password || !isPublicUrl(url.href))
          throw new PublicAddressError(
            'PDF address is not a permitted public HTTP(S) address.',
            'policy',
          )
        // The harness proxy policy decides the transport per hop: proxied, the
        // route's shared dispatcher performs the DNS and is never closed; direct,
        // the pinned closed set keeps the check-then-connect guarantee.
        const route = egressRouteFor(url)
        const addresses = route.proxied
          ? undefined
          : await resolvePublicAddresses(url.hostname, this.deps.resolver, {
              signal: combined,
            })
        const connection = route.proxied
          ? undefined
          : this.deps.dispatcher(addresses as readonly ResolvedAddress[])
        try {
          const response = await this.deps.fetch(url.href, {
            method: 'GET',
            redirect: 'manual',
            signal: combined,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            headers: { accept: 'application/pdf, application/octet-stream;q=0.8' },
            dispatcher: route.proxied ? route.dispatcher : connection!.dispatcher,
          } as RequestInit)
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            await response.body?.cancel()
            if (!location || hop === 5)
              throw failure('REDIRECT', 'PDF redirect limit exceeded or Location is missing.')
            const next = new URL(location, url)
            if (url.protocol === 'https:' && next.protocol !== 'https:')
              throw new PublicAddressError(
                'HTTPS PDF redirects may not downgrade to HTTP.',
                'policy',
              )
            url = next
            continue
          }
          if (!response.ok) {
            await response.body?.cancel()
            throw failure('HTTP', `PDF server returned HTTP ${response.status}.`)
          }
          const length = Number(response.headers.get('content-length'))
          if (length > URL_PDF_MAX_BYTES) {
            await response.body?.cancel()
            throw new ResponseTooLargeError(URL_PDF_MAX_BYTES)
          }
          const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
          if (type && type !== 'application/pdf' && type !== 'application/octet-stream') {
            await response.body?.cancel()
            throw failure('NOT_PDF', 'The attachment website returned a non-PDF response.')
          }
          const bytes = await readBoundedBytes(response, URL_PDF_MAX_BYTES)
          combined.throwIfAborted()
          const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, 1024))
          if (!/^\s*%PDF-\d\.\d(?:\s|$)/.test(prefix))
            throw failure('NOT_PDF', 'The response does not contain a PDF file signature.')
          return {
            ref: attachment.ref,
            title: attachment.title,
            contentType: 'application/pdf',
            data: new Uint8Array(bytes),
          }
        } finally {
          // The proxy route's dispatcher is process-wide and shared; only the
          // pinned per-attempt agent is closed here. A close rejection must
          // not replace a successful read or the original failure.
          await connection?.close().catch(() => undefined)
        }
      }
      throw failure('REDIRECT', 'PDF redirect limit exceeded.')
    } catch (error) {
      if (signal.aborted || controller.signal.aborted) throw combined.reason
      if (timeout.aborted) throw failure('TIMEOUT', 'The PDF download exceeded 60 seconds.')
      if (error instanceof PublicAddressError) throw failure('FORBIDDEN_TARGET', error.message)
      if (error instanceof ResponseTooLargeError)
        throw failure('TOO_LARGE', 'The PDF exceeds the 32 MiB reading limit.')
      if (error instanceof ZoteroError) throw error
      // Fetch errors can contain a full signed URL: never surface their raw text.
      throw failure(
        'NETWORK',
        'The PDF download failed. Check the source website and retry explicitly.',
      )
    } finally {
      this.running.delete(controller)
    }
  }
}
