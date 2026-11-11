/**
 * The SSRF-safe streaming download client for pinned model files.
 *
 * The model sources are fixed hosts (hf-mirror.com, huggingface.co), but every
 * redirect target is a dynamic untrusted address, so each hop re-runs the same
 * public-address double gate the MinerU client uses: `isPublicUrl` (lexical)
 * plus `resolvePublicAddresses` with the answers pinned into the connection,
 * HTTPS only, no downgrade, no userinfo, five hops at most.
 *
 * Responses stream to a temp file through a counting Transform that aborts as
 * soon as the byte count passes the pinned size, hashes on the way through,
 * and is guarded by a stall watchdog and a per-file deadline. The digest is
 * checked before the rename, so a wrong bundle never becomes visible at its
 * final path.
 * @module dsh-zotero/enrichment/model-download-client
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetch as undiciFetch } from 'undici'
import type { SemanticDownloadSource, SemanticModelSpec } from '../enrichment-model-catalog.js'
import { isPublicUrl, PublicAddressError } from '../transport/public-url.js'
import {
  resolvePublicAddresses,
  type AddressResolver,
  type PinnedDispatcher,
  type ResolvedAddress,
} from '../transport/network.js'
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED, ZoteroError } from '../errors.js'

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
  readonly writeStream: (path: string) => NodeJS.WritableStream
}

export const hostDownloadFsDeps: DownloadFsDeps = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  rename,
  rm: async (path) => {
    await rm(path, { force: true })
  },
  writeStream: (path) => createWriteStream(path),
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

function downloadFailed(reason: string): ZoteroError {
  return new ZoteroError(
    `Model download failed: ${reason}`,
    ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  )
}

/** One gated fetch: lexical gate, DNS answers judged public and pinned. */
async function gatedFetch(
  url: string,
  deps: Required<Pick<DownloadClientDeps, 'fetch' | 'resolver' | 'dispatcher'>>,
  signal: AbortSignal,
): Promise<{
  status: number
  location: string | null
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}> {
  if (!isPublicUrl(url)) {
    throw new PublicAddressError(`model download refused a non-public address (${url})`)
  }
  const { hostname, origin } = new URL(url)
  const addresses = await resolvePublicAddresses(hostname, deps.resolver, signal)
  const pinned = deps.dispatcher(addresses)
  try {
    const response = await deps.fetch(url, {
      redirect: 'manual',
      signal,
      dispatcher: pinned.dispatcher,
    })
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
      }
    }
    return {
      status: response.status,
      location: null,
      headers: response.headers,
      body: response.body,
    }
  } finally {
    await pinned.close()
  }
}

/**
 * Download one pinned file from the first mirror that serves the exact bytes.
 * @returns where the bytes came from and their verified digest.
 */
export async function downloadPinnedFile(
  options: DownloadPinnedFileOptions,
): Promise<DownloadPinnedFileResult> {
  const fs = options.deps?.fs ?? hostDownloadFsDeps
  const fetchFn = options.deps?.fetch ?? (undiciFetch as unknown as FetchLike)
  const resolver =
    options.deps?.resolver ?? (await import('../transport/connections.js')).dnsAddressResolver
  const dispatcher =
    options.deps?.dispatcher ?? (await import('../transport/connections.js')).createPinnedDispatcher
  const gatedDeps = { fetch: fetchFn, resolver, dispatcher }

  const timeoutMs = options.timeoutMs ?? DOWNLOAD_FILE_TIMEOUT_MS
  const stallMs = options.stallMs ?? DOWNLOAD_STALL_TIMEOUT_MS
  const dest = `${options.dir}/${options.file.path}`
  await fs.mkdir(dirname(dest))

  let lastError: Error | undefined
  for (const source of options.sources) {
    const mirror = MODEL_SOURCES[source]
    if (mirror === undefined) {
      lastError = downloadFailed(`unknown download source "${source}"`)
      continue
    }
    const tmp = `${dest}.${source}.tmp`
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const deadline = setTimeout(() => controller.abort(), timeoutMs)
    let stall: NodeJS.Timeout | undefined
    try {
      // Walk redirects manually; every hop re-runs both gates.
      let url = mirror.url(options.model, options.file.path)
      let response: Awaited<ReturnType<typeof gatedFetch>> | undefined
      for (let hop = 0; ; hop += 1) {
        if (controller.signal.aborted) throw downloadFailed('download timed out or was cancelled')
        response = await gatedFetch(url, gatedDeps, controller.signal)
        if (response.location === null) break
        if (hop >= MAX_REDIRECTS) {
          throw downloadFailed(`more than ${MAX_REDIRECTS} redirect hops from ${mirror.label}`)
        }
        url = response.location
      }
      if (response!.status < 200 || response!.status >= 300 || response!.body === null) {
        throw downloadFailed(`HTTP ${response!.status} from ${mirror.label}`)
      }
      const contentLength = response!.headers.get('content-length')
      if (contentLength !== null && Number(contentLength) !== options.file.bytes) {
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
          stall = setTimeout(() => controller.abort(), stallMs)
          cb(null, chunk)
        },
      })
      stall = setTimeout(() => controller.abort(), stallMs)
      const body = Readable.fromWeb(response!.body as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(body, counting, fs.writeStream(tmp))
      clearTimeout(stall)
      const digest = hash.digest('hex')
      if (received !== options.file.bytes || digest !== options.file.sha256) {
        throw downloadFailed(
          `checksum failure for ${options.file.path}: expected ${options.file.bytes}B/${options.file.sha256}, got ${received}B/${digest}`,
        )
      }
      await fs.rename(tmp, dest)
      return { source, bytes: received, sha256: digest }
    } catch (error) {
      await fs.rm(tmp).catch(() => {})
      if (options.signal?.aborted) {
        throw downloadFailed('download cancelled')
      }
      lastError = error instanceof Error ? error : new Error(String(error))
    } finally {
      clearTimeout(deadline)
      clearTimeout(stall)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw lastError ?? downloadFailed(`every mirror failed for ${options.file.path}`)
}
