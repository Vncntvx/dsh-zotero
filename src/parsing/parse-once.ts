/**
 * Orchestrate one MinerU parse inside a single async body.
 *
 * No registered job and no resident poller: the submit → upload → poll →
 * download loop lives in this one call, bounded by a total deadline, a
 * poll-count cap, and the shared flight's signal. Each parse is cached on disk
 * and single-flighted per `ParsingService`, so a second read of the same bytes
 * never re-submits.
 *
 * **Cancellation belongs to one caller.** The shared flight runs on its own
 * `AbortController`; a caller's abort only rejects that caller's wait. The
 * flight is aborted when its last waiter leaves, so one cancelled tool call
 * can neither kill a concurrent reader nor keep the work alive after everyone
 * has gone. Nothing here reaches a read tool directly; the service calls it
 * through the enhancer slot.
 * @module dsh-zotero/parsing/parse-once
 */

import { createHash } from 'node:crypto'
import { raceWithSignal } from '../race-signal.js'
import { ZOTERO_PARSING_TASK_FAILED, ZoteroError } from '../errors.js'
import type { ParsingMode } from '../parsing-preferences.js'
import type { ParsedArtifact, ParsedArtifactMeta } from './types.js'
import { MINERU_ENDPOINTS, PRO_MODEL_VERSION } from './hosts.js'
import { MineruClient } from './transport.js'
import type { ParsedArtifactStore } from './artifact-store.js'
import { extractParsedFiles, ZIP_MAX_ARCHIVE_BYTES } from './zip.js'
import { parsedIdentityOf } from './identity.js'
import {
  MAX_POLLS,
  PARSE_TOTAL_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESULT_TIMEOUT_MS,
  SUBMIT_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from './limits.js'

const RESULT_MAX_BYTES = 64 * 1024 * 1024

export interface ParseOnceDeps {
  readonly client: MineruClient
  readonly store: ParsedArtifactStore
  /** The per-service single-flight table. */
  readonly flight: ParseFlight
  /** Poll/size bounds; tests supply small values, production uses the defaults. */
  readonly timing?: {
    readonly pollIntervalMs?: number
    readonly maxPolls?: number
    readonly totalTimeoutMs?: number
  }
}

export interface ParseOnceInput {
  /** Stable identity (attachment ref or URL); also the cache-key input. */
  readonly identity: string
  /** Provenance identity; defaults to the redacted identity. */
  readonly metaIdentity?: string
  readonly mode: ParsingMode
  readonly bytes: Uint8Array
  /** Resolved precise-API token; present only in pro mode. */
  readonly token?: string
  readonly signal?: AbortSignal
}

function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Cache key folds identity, mode, and a content fingerprint. */
export function cacheKeyOf(input: ParseOnceInput): string {
  return sha256(
    JSON.stringify({
      identity: input.identity,
      mode: input.mode,
      fingerprint: sha256(input.bytes),
    }),
  )
}

interface SubmitResult {
  readonly taskId: string
  readonly uploadUrl: string
}

/** Submit a document and return the task id plus its signed upload URL. */
async function submit(
  input: ParseOnceInput,
  client: MineruClient,
  combined: AbortSignal,
): Promise<SubmitResult> {
  const fileName = 'document.pdf'
  if (input.mode === 'free') {
    const response = await client.json<{
      code?: number
      msg?: string
      data?: { task_id?: string; file_url?: string }
    }>(MINERU_ENDPOINTS.free.submit, {
      method: 'POST',
      body: JSON.stringify({ file_name: fileName, language: 'ch' }),
      signal: combined,
      timeoutMs: SUBMIT_TIMEOUT_MS,
      maxBytes: 1 * 1024 * 1024,
    })
    if (response.code !== 0 || !response.data?.task_id || !response.data?.file_url) {
      throw new ZoteroError(
        `MinerU free submit failed${response.msg ? `: ${response.msg}` : ''}.`,
        ZOTERO_PARSING_TASK_FAILED,
      )
    }
    return { taskId: response.data.task_id, uploadUrl: response.data.file_url }
  }

  const response = await client.json<{
    code?: number
    msg?: string
    data?: { batch_id?: string; file_urls?: string[] }
  }>(MINERU_ENDPOINTS.pro.submit, {
    method: 'POST',
    body: JSON.stringify({
      files: [{ name: fileName }],
      model_version: PRO_MODEL_VERSION,
    }),
    token: input.token,
    signal: combined,
    timeoutMs: SUBMIT_TIMEOUT_MS,
    maxBytes: 1 * 1024 * 1024,
  })
  const batchId = response.data?.batch_id
  const uploadUrl = response.data?.file_urls?.[0]
  if (response.code !== 0 || !batchId || !uploadUrl) {
    throw new ZoteroError(
      `MinerU precise submit failed${response.msg ? `: ${response.msg}` : ''}.`,
      ZOTERO_PARSING_TASK_FAILED,
    )
  }
  return { taskId: batchId, uploadUrl }
}

/**
 * PUT the raw bytes to the signed URL. The token is never sent to this host,
 * and no header is added: the OSS pre-signed URL's signature does not cover
 * `Content-Type`, so sending one breaks it with `403 SignatureDoesNotMatch`.
 */
async function upload(
  uploadUrl: string,
  bytes: Uint8Array,
  client: MineruClient,
  combined: AbortSignal,
): Promise<void> {
  await client.bytes(uploadUrl, {
    method: 'PUT',
    body: bytes,
    signal: combined,
    timeoutMs: UPLOAD_TIMEOUT_MS,
    maxBytes: 1 * 1024 * 1024,
  })
}

type PollState =
  | {
      readonly kind: 'done'
      readonly markdownUrl?: string
      readonly zipUrl?: string
      readonly pageCount?: number
    }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'pending' }

/** One poll, normalized across the free and precise result shapes. */
async function pollOnce(
  input: ParseOnceInput,
  taskId: string,
  client: MineruClient,
  combined: AbortSignal,
): Promise<PollState> {
  if (input.mode === 'free') {
    const response = await client.json<{
      code?: number
      data?: {
        state?: string
        markdown_url?: string
        err_msg?: string
      }
    }>(MINERU_ENDPOINTS.free.poll(taskId), {
      method: 'GET',
      signal: combined,
      timeoutMs: POLL_TIMEOUT_MS,
      maxBytes: 1 * 1024 * 1024,
    })
    const data = response.data
    if (response.code !== 0 || data === undefined) {
      return { kind: 'failed', reason: 'MinerU returned an unreadable task status' }
    }
    if (data.state === 'done') {
      return data.markdown_url
        ? { kind: 'done', markdownUrl: data.markdown_url }
        : { kind: 'failed', reason: 'MinerU reported done without a Markdown URL' }
    }
    if (data.state === 'failed') {
      return { kind: 'failed', reason: data.err_msg || 'MinerU reported a failed task' }
    }
    return { kind: 'pending' }
  }

  const response = await client.json<{
    code?: number
    data?: {
      extract_result?: Array<{
        state?: string
        full_zip_url?: string
        err_msg?: string
        extract_progress?: { total_pages?: number }
      }>
    }
  }>(MINERU_ENDPOINTS.pro.poll(taskId), {
    method: 'GET',
    token: input.token,
    signal: combined,
    timeoutMs: POLL_TIMEOUT_MS,
    maxBytes: 1 * 1024 * 1024,
  })
  const data = response.data
  if (response.code !== 0 || data === undefined) {
    return { kind: 'failed', reason: 'MinerU returned an unreadable batch status' }
  }
  // A valid batch response can list no per-file result yet (the row appears
  // after the upload is registered); that is pending, not a hard failure.
  const result = data.extract_result?.[0]
  if (result === undefined) return { kind: 'pending' }
  if (result.state === 'done') {
    return result.full_zip_url
      ? {
          kind: 'done',
          zipUrl: result.full_zip_url,
          pageCount: result.extract_progress?.total_pages,
        }
      : { kind: 'failed', reason: 'MinerU reported done without a result archive URL' }
  }
  if (result.state === 'failed') {
    return { kind: 'failed', reason: result.err_msg || 'MinerU reported a failed task' }
  }
  return { kind: 'pending' }
}

/** Download and normalize the finished result into text payloads. */
async function downloadResult(
  state: Extract<PollState, { kind: 'done' }>,
  client: MineruClient,
  combined: AbortSignal,
): Promise<{ markdown: string; contentList?: string }> {
  if (state.markdownUrl !== undefined) {
    const bytes = await client.bytes(state.markdownUrl, {
      method: 'GET',
      signal: combined,
      timeoutMs: RESULT_TIMEOUT_MS,
      maxBytes: RESULT_MAX_BYTES,
    })
    const markdown = MineruClient.textOf(bytes, RESULT_MAX_BYTES).trim()
    if (markdown === '') {
      throw new ZoteroError('MinerU returned an empty Markdown file.', ZOTERO_PARSING_TASK_FAILED)
    }
    return { markdown }
  }
  const zipBytes = await client.bytes(state.zipUrl!, {
    method: 'GET',
    signal: combined,
    timeoutMs: RESULT_TIMEOUT_MS,
    maxBytes: ZIP_MAX_ARCHIVE_BYTES,
  })
  return await Promise.resolve(extractParsedFiles(zipBytes))
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return raceWithSignal(new Promise<void>((resolve) => setTimeout(resolve, ms)), signal)
}

interface FlightEntry {
  readonly promise: Promise<ParsedArtifact>
  readonly controller: AbortController
  waiters: number
}

/**
 * One `ParsingService`'s in-flight parse table.
 *
 * The map is per service (not module-global) so two service instances cannot
 * hand each other artifacts for a store they do not own. The shared task uses
 * the entry's own controller; callers race their own signals against it.
 */
export class ParseFlight {
  private readonly entries = new Map<string, FlightEntry>()

  run(
    key: string,
    callerSignal: AbortSignal | undefined,
    task: (flightSignal: AbortSignal) => Promise<ParsedArtifact>,
  ): Promise<ParsedArtifact> {
    const existing = this.entries.get(key)
    const entry = existing ?? this.start(key, task)
    entry.waiters += 1
    const wait =
      callerSignal === undefined ? entry.promise : raceWithSignal(entry.promise, callerSignal)
    return wait.finally(() => {
      entry.waiters -= 1
      if (entry.waiters === 0) {
        if (this.entries.get(key) === entry) this.entries.delete(key)
        entry.controller.abort()
      }
    })
  }

  private start(
    key: string,
    task: (flightSignal: AbortSignal) => Promise<ParsedArtifact>,
  ): FlightEntry {
    const controller = new AbortController()
    const promise = task(controller.signal)
    const entry: FlightEntry = { promise, controller, waiters: 0 }
    // The original promise is awaited by every waiter; this handler only keeps
    // a rejection from being reported as unhandled when all waiters leave.
    void promise.catch(() => {})
    void promise
      .finally(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key)
      })
      .catch(() => {})
    this.entries.set(key, entry)
    return entry
  }
}

/**
 * Parse one document once, reusing a cached artifact when present.
 * @throws {ZoteroError} on any submit/task/runtime failure.
 */
export async function parseOnce(
  input: ParseOnceInput,
  deps: ParseOnceDeps,
): Promise<ParsedArtifact> {
  const cacheKey = cacheKeyOf(input)
  const cached = await deps.store.get(cacheKey)
  if (cached !== undefined) return cached

  const timing = deps.timing
  const pollIntervalMs = timing?.pollIntervalMs ?? POLL_INTERVAL_MS
  const maxPolls = timing?.maxPolls ?? MAX_POLLS
  const totalTimeoutMs = timing?.totalTimeoutMs ?? PARSE_TOTAL_TIMEOUT_MS

  return await deps.flight.run(cacheKey, input.signal, async (flightSignal) => {
    const timeout = AbortSignal.timeout(totalTimeoutMs)
    const combined = AbortSignal.any([flightSignal, timeout])

    const { taskId, uploadUrl } = await submit(input, deps.client, combined)
    await upload(uploadUrl, input.bytes, deps.client, combined)

    let done: Extract<PollState, { kind: 'done' }> | undefined
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      combined.throwIfAborted()
      const state = await pollOnce(input, taskId, deps.client, combined)
      if (state.kind === 'failed') {
        throw new ZoteroError(`MinerU parse failed: ${state.reason}`, ZOTERO_PARSING_TASK_FAILED)
      }
      if (state.kind === 'done') {
        done = state
        break
      }
      if (attempt + 1 < maxPolls) await sleep(pollIntervalMs, combined)
    }
    if (done === undefined) {
      throw new ZoteroError(
        `MinerU parse did not finish within ${maxPolls} polls; try again later.`,
        ZOTERO_PARSING_TASK_FAILED,
      )
    }

    const payload = await downloadResult(done, deps.client, combined)
    const meta: ParsedArtifactMeta = {
      identity: input.metaIdentity ?? parsedIdentityOf(input.identity),
      mode: input.mode,
      contentFingerprint: sha256(input.bytes),
      taskId,
      files: [],
      ...(done.pageCount !== undefined ? { pageCount: done.pageCount } : {}),
    }
    const artifact: ParsedArtifact = {
      markdown: payload.markdown,
      ...(payload.contentList !== undefined ? { contentList: payload.contentList } : {}),
      meta,
    }
    await deps.store.put(cacheKey, artifact)
    return artifact
  })
}
