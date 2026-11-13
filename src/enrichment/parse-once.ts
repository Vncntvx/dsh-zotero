/**
 * Orchestrate one MinerU parse inside a single async body.
 *
 * No registered job and no resident poller: the submit → upload → poll →
 * download loop lives in this one call, bounded by a total deadline, a
 * poll-count cap, and the shared flight's signal. Each parse is cached on disk
 * and single-flighted per `EnrichmentService` and job generation. Retrying a
 * generation resumes its receipt; a new generation creates a new parse.
 *
 * **Cancellation belongs to one caller.** The shared flight runs on its own
 * `AbortController`; a caller's abort only rejects that caller's wait. The
 * flight is aborted when its last waiter leaves, so one cancelled job cannot
 * kill another waiter. Only the private active-parse domain calls this module;
 * ordinary readers consume artifacts through the lookup slot.
 * @module dsh-zotero/enrichment/parse-once
 */

import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  freeSubmit,
  proSubmit,
  freeStatus,
  proStatus,
  responseData,
  responseWithData,
  MineruApiError,
} from './api.js'
import { raceWithSignal } from '../race-signal.js'
import { ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import type { EnrichmentMode } from '../enrichment-preferences.js'
import type { ParsedArtifact, ParsedArtifactMeta } from './types.js'
import { MINERU_ENDPOINTS, PRO_MODEL_VERSION } from './hosts.js'
import { MineruClient } from './transport.js'
import type { ParsedArtifactStore } from './artifact-store.js'
import { extractParsedFiles, ZIP_MAX_ARCHIVE_BYTES, type ExtractedParsedFiles } from './zip.js'
import { parsedIdentityOf } from './identity.js'
import { canonicalSourceIdentityOf } from './identity.js'
import { sourceKeyOf } from './source-stamp.js'
import { PARSE_GENERATION, SHA256 } from './artifact-schema.js'
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

export type ParsePhase =
  'acquiring' | 'uploading' | 'waiting' | 'downloading' | 'validating' | 'writing'

export interface ParseOnceInput {
  /** Stable identity (attachment ref or URL); also the cache-key input. */
  readonly identity: string
  /** Job-owned parse attempt: retries keep it; explicit re-parses replace it. */
  readonly generation: string
  readonly mode: EnrichmentMode
  readonly bytes: Uint8Array
  /**
   * The SHA-256 of `bytes`, when the caller already hashed them — the service
   * fingerprints once for its cache write and hands the digest in, so the
   * same bytes are not hashed again here. Absent (tests, direct callers),
   * one is computed.
   */
  readonly fingerprint?: string
  /** Resolved precise-API token; present only in pro mode. */
  readonly token?: string
  readonly signal?: AbortSignal
  readonly onProgress?: (phase: ParsePhase) => void
}

function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The SHA-256 of one document, the fingerprint the cache and meta agree on. */
export function contentFingerprintOf(bytes: Uint8Array): string {
  return sha256(bytes)
}

export interface ParseOnceResult {
  readonly artifact: ParsedArtifact
  readonly cacheKey: string
  /** True only when this generation reused an already committed artifact. */
  readonly cached: boolean
}

type ParseCacheIdentity = Pick<ParseOnceInput, 'identity' | 'generation' | 'mode'> &
  (
    | { readonly fingerprint: string; readonly bytes?: Uint8Array }
    | { readonly fingerprint?: string; readonly bytes: Uint8Array }
  )

/** Cache key folds identity, mode, generation, and the exact content fingerprint. */
export function cacheKeyOf(input: ParseCacheIdentity): string {
  if (!PARSE_GENERATION.safeParse(input.generation).success) {
    throw new ZoteroError('A UUID parse generation is required.', ZOTERO_INVALID_ARGUMENT)
  }
  const fingerprint =
    input.fingerprint ?? (input.bytes !== undefined ? contentFingerprintOf(input.bytes) : undefined)
  if (!SHA256.safeParse(fingerprint).success) {
    throw new ZoteroError(
      'A SHA-256 document fingerprint or bytes are required.',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  return sha256(
    JSON.stringify({
      identity: canonicalSourceIdentityOf(input.identity),
      mode: input.mode,
      generation: input.generation,
      fingerprint,
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
    const data = responseData(
      await client.json(MINERU_ENDPOINTS.free.submit, {
        method: 'POST',
        body: JSON.stringify({ file_name: fileName, language: 'ch' }),
        signal: combined,
        timeoutMs: SUBMIT_TIMEOUT_MS,
        maxBytes: 1024 * 1024,
      }),
      freeSubmit,
      'free submit',
    )
    return { taskId: data.task_id, uploadUrl: data.file_url }
  }
  const data = responseData(
    await client.json(MINERU_ENDPOINTS.pro.submit, {
      method: 'POST',
      body: JSON.stringify({ files: [{ name: fileName }], model_version: PRO_MODEL_VERSION }),
      token: input.token,
      signal: combined,
      timeoutMs: SUBMIT_TIMEOUT_MS,
      maxBytes: 1024 * 1024,
    }),
    proSubmit,
    'precise submit',
  )
  return { taskId: data.batch_id, uploadUrl: data.file_urls[0]! }
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
  | { readonly kind: 'pending'; readonly pageCount?: number }

/** One poll, normalized across the free and precise result shapes. */
async function pollOnce(
  input: ParseOnceInput,
  taskId: string,
  client: MineruClient,
  combined: AbortSignal,
): Promise<PollState> {
  const value = await client.json(
    input.mode === 'free' ? MINERU_ENDPOINTS.free.poll(taskId) : MINERU_ENDPOINTS.pro.poll(taskId),
    {
      method: 'GET',
      ...(input.mode === 'pro' ? { token: input.token } : {}),
      signal: combined,
      timeoutMs: POLL_TIMEOUT_MS,
      maxBytes: 1024 * 1024,
    },
  )
  if (input.mode === 'free') {
    const { data, traceId } = responseWithData(value, freeStatus, 'free poll', taskId)
    if (data.task_id !== taskId)
      throw new MineruApiError('MinerU returned a different task ID', undefined, traceId, taskId)
    if (data.state === 'failed')
      throw new MineruApiError(
        data.err_msg || 'MinerU reported a failed task',
        data.err_code ?? undefined,
        traceId,
        taskId,
        true,
      )
    if (data.state === 'done') {
      if (data.markdown_url === undefined)
        throw new MineruApiError(
          'MinerU reported done without a Markdown URL',
          undefined,
          traceId,
          taskId,
        )
      return { kind: 'done', markdownUrl: data.markdown_url }
    }
    return { kind: 'pending' }
  }
  const { data, traceId } = responseWithData(value, proStatus, 'precise poll', taskId)
  if (data.batch_id !== taskId)
    throw new MineruApiError('MinerU returned a different batch ID', undefined, traceId, taskId)
  const result = data.extract_result[0]
  if (result === undefined) return { kind: 'pending' }
  if (result.file_name !== 'document.pdf')
    throw new MineruApiError('MinerU returned a different file', undefined, traceId, taskId)
  if (result.state === 'failed')
    throw new MineruApiError(
      result.err_msg || 'MinerU reported a failed task',
      undefined,
      traceId,
      taskId,
      true,
    )
  if (result.state === 'done') {
    if (result.full_zip_url === undefined)
      throw new MineruApiError(
        'MinerU reported done without a result archive URL',
        undefined,
        traceId,
        taskId,
      )
    return {
      kind: 'done',
      zipUrl: result.full_zip_url,
      pageCount: result.extract_progress?.total_pages,
    }
  }
  return { kind: 'pending', pageCount: result.extract_progress?.total_pages }
}

/** Download and normalize the finished result into text payloads. */
async function downloadResult(
  state: Extract<PollState, { kind: 'done' }>,
  client: MineruClient,
  combined: AbortSignal,
  onProgress?: (phase: ParsePhase) => void,
): Promise<{
  markdown: string
  contentList?: string
  images?: ExtractedParsedFiles['images']
}> {
  if (state.markdownUrl !== undefined) {
    const bytes = await client.bytes(state.markdownUrl, {
      method: 'GET',
      signal: combined,
      timeoutMs: RESULT_TIMEOUT_MS,
      maxBytes: RESULT_MAX_BYTES,
    })
    onProgress?.('validating')
    combined.throwIfAborted()
    const markdown = MineruClient.textOf(bytes, RESULT_MAX_BYTES).trim()
    if (markdown === '') {
      throw new ZoteroError(
        'MinerU returned an empty Markdown file.',
        ZOTERO_ENRICHMENT_TASK_FAILED,
      )
    }
    return { markdown }
  }
  const zipBytes = await client.bytes(state.zipUrl!, {
    method: 'GET',
    signal: combined,
    timeoutMs: RESULT_TIMEOUT_MS,
    maxBytes: ZIP_MAX_ARCHIVE_BYTES,
  })
  onProgress?.('validating')
  combined.throwIfAborted()
  return await Promise.resolve(extractParsedFiles(zipBytes))
}

interface FlightEntry {
  readonly promise: Promise<ParseOnceResult>
  readonly controller: AbortController
  waiters: number
}

/**
 * One `EnrichmentService`'s in-flight parse table.
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
    task: (flightSignal: AbortSignal) => Promise<ParseOnceResult>,
  ): Promise<ParseOnceResult> {
    callerSignal?.throwIfAborted()
    const existing = this.entries.get(key)
    const entry = existing ?? this.start(key, task)
    entry.waiters += 1
    const wait =
      callerSignal === undefined ? entry.promise : raceWithSignal(entry.promise, callerSignal)
    return wait.finally(async () => {
      entry.waiters -= 1
      if (entry.waiters === 0) {
        if (this.entries.get(key) === entry) this.entries.delete(key)
        entry.controller.abort()
        // A cancelled last waiter owns cleanup of the work it stopped. Jobs
        // cannot report cancellation while an upload/stream/store is still live.
        await entry.promise.catch(() => {})
      }
    })
  }

  private start(
    key: string,
    task: (flightSignal: AbortSignal) => Promise<ParseOnceResult>,
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

function cachedResultOf(
  artifact: ParsedArtifact,
  input: ParseOnceInput,
  cacheKey: string,
): ParseOnceResult {
  if (
    artifact.meta.sourceId !== sourceKeyOf(input.identity) ||
    artifact.meta.generation !== input.generation ||
    artifact.meta.mode !== input.mode ||
    artifact.meta.contentFingerprint !== (input.fingerprint ?? contentFingerprintOf(input.bytes))
  ) {
    throw new ZoteroError(
      'The parsed artifact does not match its cache identity.',
      ZOTERO_ENRICHMENT_TASK_FAILED,
    )
  }
  return { artifact, cacheKey, cached: true }
}

/**
 * Parse one generation, reusing only that generation's committed artifact.
 * @throws {ZoteroError} on any submit/task/runtime failure.
 */
export async function parseOnce(
  input: ParseOnceInput,
  deps: ParseOnceDeps,
): Promise<ParseOnceResult> {
  input.signal?.throwIfAborted()
  const cacheKey = cacheKeyOf(input)
  const cached = await deps.store.get(cacheKey)
  input.signal?.throwIfAborted()
  if (cached !== undefined) return cachedResultOf(cached, input, cacheKey)

  if (input.mode === 'pro' && !input.token?.trim())
    throw new MineruApiError('MinerU precise mode requires a token')

  const timing = deps.timing
  const pollIntervalMs = timing?.pollIntervalMs ?? POLL_INTERVAL_MS
  const maxPolls = timing?.maxPolls ?? MAX_POLLS
  const totalTimeoutMs = timing?.totalTimeoutMs ?? PARSE_TOTAL_TIMEOUT_MS

  return await deps.flight.run(
    `${deps.store.root}:${cacheKey}`,
    input.signal,
    async (flightSignal) => {
      const timeout = AbortSignal.timeout(totalTimeoutMs)
      const combined = AbortSignal.any([flightSignal, timeout])

      // Re-check inside the shared flight: another caller may have committed
      // between the outer cache read and joining this flight.
      const cached = await deps.store.get(cacheKey)
      combined.throwIfAborted()
      if (cached !== undefined) return cachedResultOf(cached, input, cacheKey)
      let task = await deps.store.getTask(cacheKey)
      combined.throwIfAborted()
      if (task === undefined) {
        input.onProgress?.('uploading')
        combined.throwIfAborted()
        const submitted = await submit(input, deps.client, combined)
        task = { ...submitted, uploaded: false, createdAt: Date.now() }
        await deps.store.putTask(cacheKey, task)
      }
      const { taskId } = task
      // The document bytes are owned by this shared task and needed only
      // until the upload lands; dropping the reference afterwards releases a
      // pro-sized buffer (up to the API's 200 MB) for the rest of the poll
      // loop, which can run for many minutes.
      let documentBytes: Uint8Array | undefined = input.bytes
      try {
        if (!task.uploaded) {
          if (Date.now() - task.createdAt >= 24 * 60 * 60_000)
            throw new MineruApiError(
              'MinerU upload URL expired; the next explicit read can create a new task',
              undefined,
              undefined,
              taskId,
              true,
            )
          if (documentBytes === undefined) {
            throw new ZoteroError(
              'The upload bytes were already released; the next explicit read can re-parse the document',
              ZOTERO_ENRICHMENT_TASK_FAILED,
            )
          }
          input.onProgress?.('uploading')
          combined.throwIfAborted()
          await upload(task.uploadUrl, documentBytes, deps.client, combined)
          documentBytes = undefined
          task = { taskId, createdAt: task.createdAt, uploaded: true }
          await deps.store.putTask(cacheKey, task)
        } else {
          documentBytes = undefined
        }

        input.onProgress?.('waiting')
        combined.throwIfAborted()
        let done: Extract<PollState, { kind: 'done' }> | undefined
        let pageCount: number | undefined
        for (let attempt = 0; attempt < maxPolls; attempt++) {
          combined.throwIfAborted()
          let state: PollState
          try {
            state = await pollOnce(input, taskId, deps.client, combined)
          } catch (error) {
            if (!(error instanceof MineruApiError) || error.terminal || !error.retryable)
              throw error
            if (attempt + 1 === maxPolls) throw error
            await delay(Math.min(30_000, pollIntervalMs * 2 ** Math.min(attempt, 4)), undefined, {
              signal: combined,
            })
            continue
          }
          if (state.pageCount !== undefined) pageCount = state.pageCount
          if (state.kind === 'done') {
            done = state
            break
          }
          if (attempt + 1 < maxPolls) await delay(pollIntervalMs, undefined, { signal: combined })
        }
        if (done === undefined) {
          throw new ZoteroError(
            `MinerU parse did not finish within ${maxPolls} polls; try again later.`,
            ZOTERO_ENRICHMENT_TASK_FAILED,
          )
        }

        input.onProgress?.('downloading')
        combined.throwIfAborted()
        const payload = await downloadResult(done, deps.client, combined, input.onProgress)
        if (/^\s*(?:<!doctype\s+html|<html|<head|<body|<\?xml)/i.test(payload.markdown))
          throw new MineruApiError(
            'MinerU returned an HTML/XML error document instead of Markdown',
            undefined,
            undefined,
            taskId,
          )
        const meta: ParsedArtifactMeta = {
          version: 2,
          parser: 'mineru',
          format: 'markdown',
          sourceId: sourceKeyOf(input.identity),
          generation: input.generation,
          identity: parsedIdentityOf(input.identity),
          mode: input.mode,
          contentFingerprint: input.fingerprint ?? contentFingerprintOf(input.bytes),
          taskId,
          files: payload.contentList === undefined ? ['full.md'] : ['full.md', 'content_list.json'],
          ...(payload.images !== undefined && payload.images.length > 0
            ? {
                images: payload.images.map((image) => ({
                  name: image.name,
                  mediaType: image.mediaType,
                  bytes: image.data.byteLength,
                })),
              }
            : {}),
          ...(pageCount !== undefined ? { pageCount } : {}),
        }
        const artifact: ParsedArtifact = {
          markdown: payload.markdown,
          ...(payload.contentList !== undefined ? { contentList: payload.contentList } : {}),
          ...(payload.images !== undefined && payload.images.length > 0
            ? {
                images: payload.images.map((image) => ({ name: image.name, data: image.data })),
              }
            : {}),
          meta,
        }
        input.onProgress?.('writing')
        combined.throwIfAborted()
        await deps.store.put(cacheKey, artifact)
        await deps.store.deleteTask(cacheKey)
        return { artifact, cacheKey, cached: false }
      } catch (error) {
        if (error instanceof MineruApiError && error.terminal) await deps.store.deleteTask(cacheKey)
        throw error
      }
    },
  )
}
