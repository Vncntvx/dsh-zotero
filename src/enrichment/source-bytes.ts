/**
 * Obtain the exact bytes of one document to send to MinerU, and probe the
 * source cheaply enough for the cache to answer first.
 *
 * Two authorized sources, both gated by the service before this module runs:
 * a local Zotero attachment (resolved through the core's `resolveAttachment`,
 * then read from disk) and a public URL PDF (downloaded through the same
 * public-address double gate as the URL-PDF reader). A caller that already
 * holds the bytes (the scholarly PDF arm) passes them in and no network read
 * happens. Every arm checks the PDF signature and the selected API's byte cap.
 *
 * `probeSource` is the cache arm: a local attachment is only `stat`ed, a URL
 * only receives a HEAD (no token), and caller-supplied bytes are only hashed.
 * `obtainSourceBytes` returns the bytes together with the stamp that the
 * service records in the source index.
 * @module dsh-zotero/enrichment/source-bytes
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type {
  FulltextEnhancerInput,
  FulltextEnhancerSource,
  FulltextSourceStamp,
} from '../local/fulltext-enhancer.js'
import { ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT, ZoteroError } from '../errors.js'
import { HEAD_TIMEOUT_MS, SOURCE_TRANSFER_TIMEOUT_MS } from './limits.js'
import type { MineruClient } from './transport.js'

/** The resolved shape of one local attachment, as the core reports it. */
export interface ResolvedAttachment {
  readonly kind: 'file' | 'url'
  readonly path?: string
  readonly url?: string
}

/** Host seams, injectable so unit tests never touch a real disk or socket. */
export interface SourceBytesDeps {
  readonly resolveAttachment: (ref: string, signal?: AbortSignal) => Promise<ResolvedAttachment>
  readonly stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
  readonly readFile: (path: string, signal?: AbortSignal) => Promise<Uint8Array>
  readonly client: MineruClient
}

/** Bytes plus the source stamp the cache records. */
export interface SourceBytesResult {
  readonly bytes: Uint8Array
  readonly stamp: FulltextSourceStamp
}

const PDF_MAGIC = /^\s*%PDF-\d\.\d/

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function refuse(reason: string): never {
  throw new ZoteroError(`Document cannot be parsed: ${reason}`, ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT)
}

/** Validate PDF signature and size; return the bytes unchanged. */
export function validatedPdfBytes(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength > maxBytes) {
    refuse(`the file is ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit`)
  }
  const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, 1024))
  if (!PDF_MAGIC.test(prefix)) refuse('the bytes do not carry a PDF file signature')
  return bytes
}

function headerOf(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)
  if (value === null) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Build a URL stamp from response headers, keeping only useful validators. */
export function urlStampOf(url: string, headers: Headers): FulltextSourceStamp {
  const etag = headerOf(headers, 'etag')
  const lastModified = headerOf(headers, 'last-modified')
  const rawLength = headerOf(headers, 'content-length')
  const parsedLength = rawLength === undefined ? undefined : Number(rawLength)
  const contentLength =
    parsedLength !== undefined && Number.isFinite(parsedLength) && parsedLength >= 0
      ? parsedLength
      : undefined
  return {
    kind: 'url',
    url,
    ...(etag !== undefined ? { etag } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
    ...(contentLength !== undefined ? { contentLength } : {}),
  }
}

/** Probe a URL with HEAD; a failed probe never validates stale text. */
async function probeUrl(
  url: string,
  maxBytes: number,
  client: MineruClient,
  signal?: AbortSignal,
): Promise<FulltextSourceStamp> {
  const { headers } = await client.head(url, {
    method: 'HEAD',
    signal,
    maxBytes,
    timeoutMs: HEAD_TIMEOUT_MS,
  })
  return urlStampOf(url, headers)
}

/** Download a public URL PDF through the shared double gate, then validate. */
async function downloadUrl(
  url: string,
  maxBytes: number,
  client: MineruClient,
  signal?: AbortSignal,
): Promise<SourceBytesResult> {
  const { bytes, headers } = await client.get(url, {
    method: 'GET',
    signal,
    maxBytes,
    timeoutMs: SOURCE_TRANSFER_TIMEOUT_MS,
    headers: { accept: 'application/pdf, application/octet-stream;q=0.8' },
  })
  return { bytes: validatedPdfBytes(bytes, maxBytes), stamp: urlStampOf(url, headers) }
}

/** Read a local attachment file from disk, refusing one over the cap. */
async function readLocalFile(
  path: string,
  maxBytes: number,
  deps: SourceBytesDeps,
  signal?: AbortSignal,
): Promise<SourceBytesResult> {
  let info: { size: number; mtimeMs: number }
  try {
    info = await deps.stat(path)
  } catch (error) {
    refuse(`the attachment file is unreadable (${(error as Error).message})`)
  }
  if (info.size > maxBytes) {
    refuse(`the file is ${info.size} bytes, over the ${maxBytes}-byte limit`)
  }
  try {
    const bytes = validatedPdfBytes(await deps.readFile(path, signal), maxBytes)
    return { bytes, stamp: { kind: 'file', size: info.size, mtimeMs: info.mtimeMs } }
  } catch (error) {
    if (error instanceof ZoteroError) throw error
    refuse(`the attachment file could not be read (${(error as Error).message})`)
  }
}

/** Resolve one local attachment ref to bytes. */
async function localBytes(
  source: Extract<FulltextEnhancerSource, { kind: 'local' }>,
  maxBytes: number,
  deps: SourceBytesDeps,
  signal?: AbortSignal,
): Promise<SourceBytesResult> {
  const resolved = await deps.resolveAttachment(source.attachmentRef, signal)
  if (resolved.kind === 'file' && resolved.path !== undefined) {
    return await readLocalFile(resolved.path, maxBytes, deps, signal)
  }
  if (resolved.kind === 'url' && resolved.url !== undefined) {
    return await downloadUrl(resolved.url, maxBytes, deps.client, signal)
  }
  refuse('the attachment has neither a local file nor a public URL')
}

/**
 * Probe the source without reading the document. A caller-supplied stamp wins;
 * otherwise a local file is `stat`ed, a URL gets one HEAD, and supplied bytes
 * are hashed.
 */
export async function probeSource(
  input: FulltextEnhancerInput,
  maxBytes: number,
  deps: SourceBytesDeps,
  signal?: AbortSignal,
): Promise<FulltextSourceStamp> {
  if (input.bytes !== undefined) {
    return { kind: 'bytes', fingerprint: sha256(input.bytes) }
  }
  if (input.sourceStamp !== undefined) return input.sourceStamp
  if (input.source.kind === 'url') {
    return await probeUrl(input.source.url, maxBytes, deps.client, signal)
  }
  const resolved = await deps.resolveAttachment(input.source.attachmentRef, signal)
  if (resolved.kind === 'file' && resolved.path !== undefined) {
    const info = await deps.stat(resolved.path)
    if (info.size > maxBytes) {
      refuse(`the file is ${info.size} bytes, over the ${maxBytes}-byte limit`)
    }
    return { kind: 'file', size: info.size, mtimeMs: info.mtimeMs }
  }
  if (resolved.kind === 'url' && resolved.url !== undefined) {
    return await probeUrl(resolved.url, maxBytes, deps.client, signal)
  }
  refuse('the attachment has neither a local file nor a public URL')
}

/**
 * Obtain document bytes. Bytes passed in by the caller win; otherwise the
 * source is resolved. `allowUpload` is enforced by the service before this
 * call — this module is only reached once egress is authorized.
 */
export async function obtainSourceBytes(
  input: FulltextEnhancerInput,
  maxBytes: number,
  deps: SourceBytesDeps,
  signal?: AbortSignal,
): Promise<SourceBytesResult> {
  if (input.bytes !== undefined) {
    const bytes = validatedPdfBytes(input.bytes, maxBytes)
    const stamp = { kind: 'bytes' as const, fingerprint: sha256(bytes) }
    return { bytes, stamp }
  }
  if (input.source.kind === 'local') {
    return await localBytes(input.source, maxBytes, deps, signal)
  }
  return await downloadUrl(input.source.url, maxBytes, deps.client, signal)
}

/** Production deps: real disk reads plus the core's attachment resolver. */
export function hostSourceBytesDeps(
  resolveAttachment: SourceBytesDeps['resolveAttachment'],
  client: MineruClient,
): SourceBytesDeps {
  return {
    resolveAttachment,
    stat,
    readFile: async (path, signal) => new Uint8Array(await readFile(path, { signal })),
    client,
  }
}
