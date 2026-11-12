/**
 * The SSRF-safe streaming download client for pinned model files.
 *
 * The model sources are fixed hosts (hf-mirror.com, huggingface.co), but every
 * redirect target is a dynamic untrusted address, so each hop re-runs the same
 * public-address double gate the MinerU client uses: `isPublicUrl` (lexical)
 * plus `resolvePublicAddresses` with the answers pinned into the connection,
 * HTTPS only, no downgrade, no userinfo, five hops at most.
 *
 * A pinned dispatcher is owned by one response-consumption scope: the response
 * body is drained or cancelled before `close()`. Redirect, error, length,
 * checksum and abort paths end the body first to avoid deadlocking a slow large
 * response against a closed connection. Streamed bytes land in an exclusively
 * created file inside a caller-owned directory; predictable temp symlinks are
 * not followed.
 * @module dsh-zotero/enrichment/model-download-client
 */

import { createHash } from 'node:crypto'
import { lstat, mkdir, open as openFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { SemanticDownloadSource, SemanticModelSpec } from '../enrichment-model-catalog.js'
import { isPublicUrl, PublicAddressError } from '../transport/public-url.js'
import {
  createPinnedDispatcher,
  dnsAddressResolver,
  publicFetch,
} from '../transport/connections.js'
import {
  resolvePublicAddresses,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from '../transport/network.js'
import {
  ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT,
  ZoteroError,
} from '../errors.js'

/** The fixed model mirrors. URLs pin the revision, not a moving branch. */
export const MODEL_SOURCES: Record<
  SemanticDownloadSource,
  { readonly label: string; readonly url: (model: SemanticModelSpec, path: string) => string }
> = Object.freeze({
  'hf-mirror': {
    label: 'hf-mirror.com',
    url: (model, path) =>
      `https://hf-mirror.com/${model.modelId}/resolve/${model.revision}/${path}`,
  },
  huggingface: {
    label: 'Hugging Face',
    url: (model, path) =>
      `https://huggingface.co/${model.modelId}/resolve/${model.revision}/${path}`,
  },
})

export const DEFAULT_SOURCE_ORDER: readonly SemanticDownloadSource[] = Object.freeze([
  'hf-mirror',
  'huggingface',
])

/** Maximum redirect hops, matching the other public-HTTP paths in the plugin. */
const MAX_REDIRECTS = 5

/** One file may take this long in total, mirrors included. */
export const DOWNLOAD_FILE_TIMEOUT_MS = 30 * 60 * 1000

/** No bytes for this long aborts the attempt; mirrors stall silently. */
export const DOWNLOAD_STALL_TIMEOUT_MS = 60 * 1000

/** The slice of undici's Response the client relies on; tests stub it. */
export interface FetchLike {
  (
    url: string,
    init?: {
      readonly method?: string
      readonly redirect?: 'manual'
      readonly signal?: AbortSignal
      readonly dispatcher?: PinnedDispatcher['dispatcher']
    },
  ): Promise<{
    readonly ok: boolean
    readonly status: number
    readonly headers: { get(name: string): string | null }
    readonly body: ReadableStream<Uint8Array> | null
  }>
}

/** Filesystem seams, injectable so tests never write to real disk. */
export interface DownloadFsDeps {
  readonly mkdir: (path: string) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly rm: (path: string) => Promise<void>
  /** Exclusive create: an existing path (including a symlink) is refused. */
  readonly openExclusive: (path: string) => Promise<NodeJS.WritableStream>
}

export const hostDownloadFsDeps: DownloadFsDeps = {
  mkdir: async (path) => {
    // Resolve the longest existing ancestor to its canonical path first (this
    // tolerates OS-level root symlinks such as macOS /var -> /private/var), then
    // create the missing suffix one segment at a time. A symlink planted inside
    // the owned model tree is still refused rather than followed.
    const absolute = resolve(path)
    let existing = absolute
    const missing: string[] = []
    for (;;) {
      try {
        const info = await lstat(existing)
        if (!info.isDirectory())
          throw new Error(`the destination parent is not a directory: ${existing}`)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = dirname(existing)
        if (parent === existing) throw error
        missing.unshift(basename(existing))
        existing = parent
      }
    }
    let current = await realpath(existing).catch(() => existing)
    for (const segment of missing) {
      current = join(current, segment)
      const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (info === undefined) await mkdir(current)
      else if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error(`the destination parent is not a regular directory: ${current}`)
    }
    // Guard against a symlink at the final requested parent as well.
    const final = await lstat(current).catch(() => undefined)
    if (final !== undefined && (final.isSymbolicLink() || !final.isDirectory()))
      throw new Error(`the destination parent is not a regular directory: ${current}`)
  },
  rename,
  rm: async (path) => {
    await rm(path, { force: true })
  },
  openExclusive: async (path) => {
    const handle = await openFile(path, 'wx', 0o600)
    return handle.createWriteStream()
  },
}

export interface DownloadClientDeps {
  readonly fetch?: FetchLike
  readonly resolver?: AddressResolver
  readonly dispatcher?: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher
  readonly fs?: DownloadFsDeps
}

export interface DownloadPinnedFileOptions {
  readonly model: SemanticModelSpec
  readonly file: { readonly path: string; readonly bytes: number; readonly sha256: string }
  readonly dir: string
  /** Preferred source first; the rest are fallbacks in catalog order. */
  readonly sources: readonly SemanticDownloadSource[]
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly stallMs?: number
  readonly deps?: DownloadClientDeps
}

export interface DownloadPinnedFileResult {
  readonly source: SemanticDownloadSource
  readonly bytes: number
  readonly sha256: string
}

interface GatedResponse {
  readonly status: number
  readonly location: string | null
  readonly headers: { get(name: string): string | null }
  readonly body: ReadableStream<Uint8Array> | null
  /** Owns the connection: run after the body has been drained/cancelled. */
  readonly release: () => Promise<void>
  /** End an unused body (redirect, error, length rejection). */
  readonly discardBody: () => Promise<void>
}

function downloadFailed(reason: string): ZoteroError {
  return new ZoteroError(
    `Model download failed: ${reason}`,
    ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  )
}

/** One gated fetch. The dispatcher stays owned until `release()` runs. */
async function gatedFetch(
  url: string,
  deps: Required<Pick<DownloadClientDeps, 'fetch' | 'resolver' | 'dispatcher'>>,
  signal: AbortSignal,
): Promise<GatedResponse> {
  if (!isPublicUrl(url)) {
    throw new PublicAddressError(`model download refused a non-public address (${url})`)
  }
  const { hostname, origin } = new URL(url)
  const addresses = await resolvePublicAddresses(hostname, deps.resolver, signal)
  const pinned = deps.dispatcher(addresses)
  let body: ReadableStream<Uint8Array> | null = null
  try {
    const response = await deps.fetch(url, {
      redirect: 'manual',
      signal,
      dispatcher: pinned.dispatcher,
    })
    body = response.body
    const location = response.headers.get('location')
    if (location !== null) {
      // The next hop is untrusted input: it must be absolute HTTPS on a
      // public host, or the attempt dies here.
      const next = new URL(location, origin)
      if (next.protocol !== 'https:') {
        throw new PublicAddressError('model download redirect downgraded to insecure HTTP')
      }
      return {
        status: response.status,
        location: next.toString(),
        headers: response.headers,
        body: null,
        release: async () => {
          await pinned.close()
        },
        discardBody: async () => {
          await cancelBody(body, signal)
        },
      }
    }
    return {
      status: response.status,
      location: null,
      headers: response.headers,
      body,
      release: async () => {
        await pinned.close()
      },
      discardBody: async () => {
        await cancelBody(body, signal)
      },
    }
  } catch (error) {
    await cancelBody(body, signal).catch(() => undefined)
    await pinned.close().catch(() => undefined)
    throw error
  }
}

/** End a response body that will not be consumed, then let go of the socket. */
async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (body === null) return
  try {
    await body.cancel(signal?.reason)
  } catch {
    // A body that is already errored or aborted still releases its connection.
  }
}

/**
 * Download one pinned file from the first mirror that serves the exact bytes.
 * @returns where the bytes came from and their verified digest.
 */
export async function downloadPinnedFile(
  options: DownloadPinnedFileOptions,
): Promise<DownloadPinnedFileResult> {
  // An already-aborted caller must not create a directory or open a socket.
  options.signal?.throwIfAborted()
  const fs = options.deps?.fs ?? hostDownloadFsDeps
  const fetchFn = options.deps?.fetch ?? (publicFetch as unknown as FetchLike)
  const resolver = options.deps?.resolver ?? dnsAddressResolver
  const dispatcher = options.deps?.dispatcher ?? createPinnedDispatcher
  const gatedDeps = { fetch: fetchFn, resolver, dispatcher }

  const timeoutMs = options.timeoutMs ?? DOWNLOAD_FILE_TIMEOUT_MS
  const stallMs = options.stallMs ?? DOWNLOAD_STALL_TIMEOUT_MS
  const dest = join(options.dir, options.file.path)
  // The parent is validated before creation; cancellation here must stop the
  // attempt before any HTTP request is admitted.
  await fs.mkdir(dirname(dest))
  options.signal?.throwIfAborted()

  // One budget for the whole file, not one per mirror: the previous timer was
  // created inside this loop, so a hanging mirror handed the next one a fresh
  // `timeoutMs` and the documented per-file bound was really two.
  const budget = deadline(options.signal, timeoutMs, ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT)
  let lastError: unknown
  try {
    for (const source of options.sources) {
      const mirror = MODEL_SOURCES[source]
      if (mirror === undefined) {
        lastError = downloadFailed(`unknown download source "${source}"`)
        continue
      }
      // A private, unpredictable name inside the owned destination parent.
      const tmp = join(
        dirname(dest),
        `.${source}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
      )
      // The attempt's own controller still owns the stall timer and the body
      // teardown; the budget and the caller's signal arrive through the fused
      // signal, so an elapsed deadline reaches the transfer itself.
      const controller = new AbortController()
      const attempt = AbortSignal.any([budget.signal, controller.signal])
      let stall: NodeJS.Timeout | undefined
      let current: GatedResponse | undefined
      let released = false
      const releaseCurrent = async () => {
        if (released || current === undefined) return
        released = true
        await cancelBody(current.body, attempt).catch(() => undefined)
        await current.release().catch(() => undefined)
      }
      try {
        // Walk redirects manually; every hop re-runs both gates. Each hop owns
        // one dispatcher until its unused body has been cancelled.
        let url = mirror.url(options.model, options.file.path)
        for (let hop = 0; ; hop += 1) {
          attempt.throwIfAborted()
          const response = await gatedFetch(url, gatedDeps, attempt)
          if (response.location === null) {
            current = response
            break
          }
          await response.discardBody()
          await response.release()
          if (hop >= MAX_REDIRECTS) {
            throw downloadFailed(`more than ${MAX_REDIRECTS} redirect hops from ${mirror.label}`)
          }
          url = response.location
        }
        options.signal?.throwIfAborted()
        const response = current!
        const endBody = releaseCurrent
        if (response.status < 200 || response.status >= 300 || response.body === null) {
          await endBody()
          throw downloadFailed(`HTTP ${response.status} from ${mirror.label}`)
        }
        const contentLength = response.headers.get('content-length')
        if (contentLength !== null && Number(contentLength) !== options.file.bytes) {
          await endBody()
          throw downloadFailed(
            `${mirror.label} serves ${contentLength} bytes for ${options.file.path}, expected ${options.file.bytes}`,
          )
        }

        const hash = createHash('sha256')
        let received = 0
        const counting = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            received += chunk.length
            if (received > options.file.bytes) {
              cb(downloadFailed(`${options.file.path} exceeded its pinned size`))
              return
            }
            hash.update(chunk)
            // The watchdog resets on every chunk: a mirror that stops sending
            // mid-body must release the socket, not hang the download forever.
            clearTimeout(stall)
            stall = setTimeout(() => controller.abort(new Error('model download stalled')), stallMs)
            cb(null, chunk)
          },
        })
        stall = setTimeout(() => controller.abort(new Error('model download stalled')), stallMs)
        let writeFailure: unknown
        const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
        try {
          await pipeline(body, counting, await fs.openExclusive(tmp))
        } catch (error) {
          writeFailure = error
        }
        clearTimeout(stall)
        // The body and the pinned connection are released only after the full
        // response has been consumed (or the pipeline has torn it down).
        await endBody()
        attempt.throwIfAborted()
        if (writeFailure !== undefined) throw writeFailure
        const digest = hash.digest('hex')
        if (received !== options.file.bytes || digest !== options.file.sha256) {
          throw downloadFailed(
            `checksum failure for ${options.file.path}: expected ${options.file.bytes}B/${options.file.sha256}, got ${received}B/${digest}`,
          )
        }
        options.signal?.throwIfAborted()
        await fs.rename(tmp, dest)
        return { source, bytes: received, sha256: digest }
      } catch (error) {
        await releaseCurrent()
        await fs.rm(tmp).catch(() => {})
        if (options.signal?.aborted) throw options.signal.reason
        lastError = error instanceof Error ? error : new Error(String(error))
      } finally {
        clearTimeout(stall)
      }
      if (options.signal?.aborted) throw options.signal.reason
      if (budget.signal.aborted) break
    }
  } finally {
    budget[Symbol.dispose]()
  }
  if (options.signal?.aborted) throw options.signal.reason
  // A deadline aborted the transfer: report it as this layer's timeout rather
  // than folding it into the generic download failure.
  if (timeoutOf(budget.signal, ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT) !== undefined) {
    throw new ZoteroError(
      `The model download did not finish within ${timeoutMs} ms.`,
      ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT,
    )
  }
  throw lastError ?? downloadFailed(`every mirror failed for ${options.file.path}`)
}
