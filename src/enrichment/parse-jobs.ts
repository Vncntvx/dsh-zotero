/** Session-owned explicit parsing jobs; the UI observes jobs without owning their lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  JobId,
  type JobHandle,
  type JobHooks,
  type JobOutcome,
  type JobRegistry,
} from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import type {
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroDocumentParseReceiptRequestView,
  ZoteroDocumentParseReceiptResultView,
  ZoteroParseReceiptView,
  ZoteroStartDocumentParseRequestView,
  ZoteroStartDocumentParseResultView,
} from '../contract.js'
import type { EnrichmentPreferences } from '../enrichment-preferences.js'
import {
  ZoteroError,
  ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
  ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_ENRICHMENT_UPLOAD_DISABLED,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_PROVIDER_UNAVAILABLE,
} from '../errors.js'
import type { FulltextLookupResult } from '../local/fulltext-enhancer.js'
import { raceWithSignal } from '../race-signal.js'
import {
  zoteroDocumentArtifactRequestSchema,
  zoteroDocumentParseReceiptRequestSchema,
  zoteroDocumentParseReceiptResultSchema,
  zoteroStartDocumentParseRequestSchema,
} from '../wire-schemas.js'
import { resolveEnrichmentConfig } from './config.js'
import type { ParseDocumentResult } from './parse-document.js'
import type { ParsePhase } from './parse-once.js'
import {
  parseDigest,
  parseTargetOf,
  resolveParseTarget,
  safeParseText,
  type ParseAttachmentResolver,
  type ParseTarget,
} from './parse-target.js'
import type { ParseSourceInput } from './types.js'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'zotero-enrichment': 'zotero-enrichment'
  }
}

export const PARSE_JOB_KIND = 'zotero-enrichment'
export const PARSE_JOB_LABEL = '文档解析 · MinerU'
export const PARSE_CANCELLED_MESSAGE = 'Document parsing was cancelled.'
export const PARSE_FAILED_MESSAGE =
  'Document parsing failed. Retry the operation to resume its generation.'
export const PARSE_JOB_PHASES: Readonly<Record<ParsePhase, string>> = {
  acquiring: '获取源文档',
  uploading: '上传文档',
  waiting: '等待解析',
  downloading: '下载解析结果',
  validating: '校验解析结果',
  writing: '保存解析产物',
}
export type ParseJobPhase = ParsePhase

type ReceiptState = ZoteroDocumentParseReceiptResultView

/** Only hashes and bounded public receipts cross this durable boundary. */
export interface ParseJobRecord {
  readonly version: 1
  readonly owner: string
  readonly operationId: string
  readonly binding: string
  readonly action: 'parse' | 'reparse'
  readonly generation: string
  readonly jobId: string
  readonly state: ReceiptState
}
export interface ParseJobPersistence {
  get(
    config: EnrichmentPreferences,
    owner: string,
    operationId: string,
  ): Promise<ParseJobRecord | undefined>
  put(config: EnrichmentPreferences, record: ParseJobRecord): Promise<void>
  generation(config: EnrichmentPreferences, source: string): Promise<string | undefined>
  putGeneration(config: EnrichmentPreferences, source: string, generation: string): Promise<void>
}

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const recordSchema = z
  .object({
    version: z.literal(1),
    owner: digest,
    operationId: z.uuid(),
    binding: digest,
    action: z.enum(['parse', 'reparse']),
    generation: z.uuid(),
    jobId: z.string().min(1).max(256),
    state: zoteroDocumentParseReceiptResultSchema,
  })
  .strict()

/** Receipts survive service remounts. The root resolver must validate the snapshot directory. */
export class DiskParseJobPersistence implements ParseJobPersistence {
  constructor(
    private readonly root: (config: EnrichmentPreferences, create: boolean) => Promise<string>,
  ) {}

  private async directory(config: EnrichmentPreferences, create: boolean): Promise<string> {
    const root = await realpath(await this.root(config, create))
    const dir = join(root, 'parse-jobs')
    if (create)
      await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    const info = await lstat(dir)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(dir)) !== dir)
      throw new Error('Unsafe parsing receipt directory')
    return dir
  }

  private async read(config: EnrichmentPreferences, key: string): Promise<unknown | undefined> {
    try {
      const path = join(await this.directory(config, false), `${key}.json`)
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 65536) throw new Error('Invalid parsing receipt file')
        const buffer = Buffer.alloc(65537)
        let size = 0
        while (size < buffer.length) {
          const read = await file.read(buffer, size, buffer.length - size, size)
          if (read.bytesRead === 0) break
          size += read.bytesRead
        }
        if (size > 65536) throw new Error('Oversized parsing receipt')
        return JSON.parse(buffer.subarray(0, size).toString('utf8'))
      } finally {
        await file.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async write(config: EnrichmentPreferences, key: string, value: unknown): Promise<void> {
    const dir = await this.directory(config, true)
    const path = join(dir, `${key}.json`)
    const temporary = `${path}.tmp-${randomUUID()}`
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
      if ((await this.directory(config, false)) !== dir)
        throw new Error('Parsing receipt directory changed')
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async get(
    config: EnrichmentPreferences,
    owner: string,
    operationId: string,
  ): Promise<ParseJobRecord | undefined> {
    const value = await this.read(config, parseDigest(JSON.stringify([owner, operationId])))
    if (value === undefined) return undefined
    const record = recordSchema.parse(value)
    if (record.owner !== owner || record.operationId !== operationId)
      throw new Error('Parsing receipt identity mismatch')
    return record
  }

  async put(config: EnrichmentPreferences, record: ParseJobRecord): Promise<void> {
    await this.write(
      config,
      parseDigest(JSON.stringify([record.owner, record.operationId])),
      recordSchema.parse(record),
    )
  }

  async generation(config: EnrichmentPreferences, source: string): Promise<string | undefined> {
    const value = await this.read(config, `source-${source}`)
    return value === undefined
      ? undefined
      : z.object({ generation: z.uuid() }).strict().parse(value).generation
  }

  async putGeneration(
    config: EnrichmentPreferences,
    source: string,
    generation: string,
  ): Promise<void> {
    await this.write(config, `source-${source}`, { generation: z.uuid().parse(generation) })
  }
}

export interface ParseJobExecution {
  readonly input: ParseSourceInput
  readonly config: EnrichmentPreferences
  readonly generation: string
  readonly signal: AbortSignal
  readonly onProgress: (phase: ParseJobPhase) => void
}
export interface EnrichmentParseJobsDeps {
  readonly config: () => EnrichmentPreferences
  readonly resolveAttachment: ParseAttachmentResolver
  /** Must settle after its own resources and shared ParseFlight waiter have been released. */
  readonly execute: (request: ParseJobExecution) => Promise<ParseDocumentResult>
  readonly lookup: (
    input: ParseSourceInput,
    config: EnrichmentPreferences,
    signal: AbortSignal,
  ) => Promise<FulltextLookupResult>
  readonly persistence: ParseJobPersistence
}

interface Operation {
  record: ParseJobRecord
  readonly owner: SessionId
  readonly config: EnrichmentPreferences
  readonly registry: JobRegistry
  readonly cancel: () => void
  readonly done: Promise<JobOutcome>
}
interface SharedGeneration {
  readonly generation: string
  readonly controller: AbortController
  readonly waiters: Map<JobHandle, () => void>
  readonly promise: Promise<{ readonly result: ParseDocumentResult; readonly target: ParseTarget }>
  settled: boolean
}

function parseWire<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    throw new ZoteroError('Invalid document parsing request.', ZOTERO_INVALID_ARGUMENT)
  return parsed.data
}

function snapshotKey(config: EnrichmentPreferences): string {
  return parseDigest(JSON.stringify([config.mode, config.mineruTokenRef, config.outputDir]))
}
function cancelled(): DOMException {
  return new DOMException(PARSE_CANCELLED_MESSAGE, 'AbortError')
}

/** No tools are dispatched. Jobs are admitted against a live session and the real registry. */
export class EnrichmentParseJobs {
  private closed = false
  private disposal: Promise<void> | undefined
  private readonly operations = new Map<string, Operation>()
  private readonly owned = new Set<Operation>()
  private readonly admissions = new Map<
    string,
    {
      readonly binding: string
      readonly action: ZoteroStartDocumentParseRequestView['action']
      readonly task: Promise<Operation>
    }
  >()
  private readonly shared = new Map<string, SharedGeneration>()
  private readonly tails = new Map<string, Promise<void>>()
  private readonly generations = new Map<string, string>()

  constructor(
    private readonly ctx: Context,
    private readonly deps: EnrichmentParseJobsDeps,
  ) {}

  private open(): void {
    if (this.closed)
      throw new ZoteroError('Document parsing component is closed.', ZOTERO_PROVIDER_UNAVAILABLE)
  }

  private authorize(sessionId: SessionId, method: string, currentCtx: Context = this.ctx): void {
    if (currentCtx.get('remoteAccess')?.allows({ kind: 'session', id: sessionId }) === true) return
    throw new RemoteError(
      'remote-access/denied',
      'Document parsing is not authorized for this session.',
      {
        action: `zotero/${method}`,
        reason: 'no-allow',
      },
    )
  }

  private config(): EnrichmentPreferences {
    return Object.freeze({ ...resolveEnrichmentConfig(this.deps.config()) })
  }

  private async owner(
    sessionId: SessionId,
    method: string,
    signal: AbortSignal,
    currentCtx: Context,
  ): Promise<JobRegistry> {
    this.open()
    this.authorize(sessionId, method, currentCtx)
    const registry = currentCtx.get('jobs')
    const controller = currentCtx.get('sessionController')
    if (registry === undefined || controller === undefined) {
      throw new ZoteroError(
        'Document parsing requires jobs and a session controller.',
        ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
      )
    }
    const resolved = await controller.resolveAgent(sessionId)
    signal.throwIfAborted()
    this.open()
    this.authorize(sessionId, method, currentCtx)
    if (
      'error' in resolved ||
      resolved.agent.id !== sessionId ||
      resolved.agent.session.id !== sessionId ||
      currentCtx.get('agents')?.get(sessionId) !== resolved.agent
    ) {
      throw new ZoteroError(
        'Document parsing requires a live session Agent.',
        ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
      )
    }
    return registry
  }

  async startDocumentParse(
    input: ZoteroStartDocumentParseRequestView,
    signal: AbortSignal,
    currentCtx: Context = this.ctx,
  ): Promise<ZoteroStartDocumentParseResultView> {
    signal.throwIfAborted()
    this.open()
    const config = this.config()
    if (!config.allowDocumentUpload)
      throw new ZoteroError('Document upload is disabled.', ZOTERO_ENRICHMENT_UPLOAD_DISABLED)
    const request = parseWire(zoteroStartDocumentParseRequestSchema, input)
    const target = parseTargetOf(request.target)
    const sessionId = SessionId(request.sessionId)
    const registry = await this.owner(sessionId, 'startDocumentParse', signal, currentCtx)
    const key = parseDigest(JSON.stringify([sessionId, request.operationId]))
    const binding = parseDigest(JSON.stringify([target.target, snapshotKey(config)]))
    const existing = this.operations.get(key)
    const admission = this.admissions.get(key)
    if (
      (existing !== undefined &&
        (existing.record.binding !== binding ||
          (request.action !== 'retry' && existing.record.action !== request.action))) ||
      (admission !== undefined &&
        (admission.binding !== binding ||
          (request.action !== 'retry' && admission.action !== request.action)))
    ) {
      throw new ZoteroError(
        'The operation id is already bound to another parsing request.',
        ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
      )
    }
    const retry =
      request.action === 'retry' &&
      existing !== undefined &&
      (existing.record.state.kind === 'failed' || existing.record.state.kind === 'cancelled')
    const replay = !retry && (existing !== undefined || admission !== undefined)
    let operation: Operation
    if (existing !== undefined && !retry) operation = existing
    else if (admission !== undefined) operation = await raceWithSignal(admission.task, signal)
    else {
      const task = this.admit(
        request,
        target,
        config,
        binding,
        registry,
        signal,
        currentCtx,
        retry ? existing : undefined,
      )
      this.admissions.set(key, { binding, action: request.action, task })
      try {
        operation = await task
        this.operations.set(key, operation)
        this.trimTerminal()
      } finally {
        this.admissions.delete(key)
      }
    }
    this.open()
    this.authorize(sessionId, 'startDocumentParse', currentCtx)
    const completed =
      operation.record.state.kind === 'completed' ? operation.record.state.receipt : undefined
    return {
      operationId: request.operationId,
      generation: operation.record.generation,
      jobId: operation.record.jobId,
      status: completed !== undefined ? 'completed' : replay ? 'joined' : 'started',
      ...(completed !== undefined ? { receipt: completed } : {}),
    }
  }

  private async admit(
    request: ZoteroStartDocumentParseRequestView,
    target: ParseTarget,
    config: EnrichmentPreferences,
    binding: string,
    registry: JobRegistry,
    signal: AbortSignal,
    currentCtx: Context,
    retry?: Operation,
  ): Promise<Operation> {
    const owner = parseDigest(request.sessionId)
    const saved =
      retry?.record ?? (await this.deps.persistence.get(config, owner, request.operationId))
    signal.throwIfAborted()
    this.open()
    this.authorize(SessionId(request.sessionId), 'startDocumentParse', currentCtx)
    if (saved !== undefined) {
      if (
        saved.binding !== binding ||
        (request.action !== 'retry' && request.action !== saved.action)
      ) {
        throw new ZoteroError(
          'The operation id is already bound to another parsing request.',
          ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
        )
      }
    } else if (request.action === 'retry') {
      throw new ZoteroError(
        'Retry requires a previous parsing operation in this session.',
        ZOTERO_NOT_FOUND,
      )
    }
    if (saved !== undefined && (request.action !== 'retry' || saved.state.kind === 'completed')) {
      // A process restart never resumes a task as a side effect of RPC replay.
      const state: ReceiptState =
        saved.state.kind === 'pending'
          ? {
              kind: 'cancelled',
              code: ZOTERO_ENRICHMENT_TASK_FAILED,
              message: PARSE_CANCELLED_MESSAGE,
            }
          : saved.state
      return {
        record: { ...saved, state },
        owner: SessionId(request.sessionId),
        config,
        registry,
        cancel() {},
        done: Promise.resolve({ status: state.kind === 'completed' ? 'completed' : 'killed' }),
      }
    }
    const source = parseDigest(JSON.stringify([target.sourceId, config.mode, snapshotKey(config)]))
    const previous =
      saved?.generation ??
      this.generations.get(source) ??
      (await this.deps.persistence.generation(config, source))
    signal.throwIfAborted()
    this.open()
    this.authorize(SessionId(request.sessionId), 'startDocumentParse', currentCtx)
    const generation = request.action === 'reparse' ? randomUUID() : (previous ?? randomUUID())
    let operation!: Operation
    try {
      registry.start({
        kind: PARSE_JOB_KIND,
        label: PARSE_JOB_LABEL,
        owner: SessionId(request.sessionId),
        outputLimitBytes: 16384,
        run: (job): JobHooks => {
          const controller = new AbortController()
          const cancel = (): void => {
            if (!controller.signal.aborted) controller.abort(cancelled())
          }
          const record: ParseJobRecord = {
            version: 1,
            owner,
            operationId: request.operationId,
            binding,
            generation,
            action: saved?.action ?? (request.action === 'reparse' ? 'reparse' : 'parse'),
            jobId: job.id,
            state: { kind: 'pending', jobId: job.id, generation },
          }
          const ready = Promise.resolve().then(
            async () => await this.deps.persistence.put(config, record),
          )
          const shared = this.reserve(source, target, config, generation, request.action, ready)
          const effective = {
            ...record,
            generation: shared.generation,
            state: { kind: 'pending' as const, jobId: job.id, generation: shared.generation },
          }
          // Install the waiter before the first asynchronous receipt write, so
          // cancellation during admission revokes it synchronously as well.
          const check = (): void => {
            try {
              this.open()
              this.authorize(SessionId(request.sessionId), 'startDocumentParse', currentCtx)
              if (currentCtx.get('agents')?.get(SessionId(request.sessionId)) === undefined)
                throw cancelled()
            } catch (error) {
              controller.abort(error)
            }
          }
          const waiting = this.wait(shared, job, controller.signal, check).then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          )
          const done = Promise.resolve()
            .then(async (): Promise<JobOutcome> => {
              try {
                await ready
                if (shared.generation !== record.generation)
                  await this.deps.persistence.put(config, effective)
                const outcome = await waiting
                if ('error' in outcome) throw outcome.error
                const value = outcome.value
                const receipt = this.receipt(
                  request.operationId,
                  shared.generation,
                  config,
                  value.target,
                  value.result,
                )
                const completed: ReceiptState = { kind: 'completed', receipt }
                await this.deps.persistence.put(config, { ...effective, state: completed })
                operation.record = { ...effective, state: completed }
                return { status: 'completed', result: JSON.stringify(receipt) }
              } catch (error) {
                // Publication can reject after cancellation. Its actual failure
                // remains a failure; an already-aborted signal cannot replace it.
                const wasCancelled = error instanceof Error && error.name === 'AbortError'
                controller.abort(error)
                await waiting
                const state: ReceiptState = {
                  kind: wasCancelled ? 'cancelled' : 'failed',
                  code: error instanceof ZoteroError ? error.code : ZOTERO_ENRICHMENT_TASK_FAILED,
                  message: wasCancelled ? PARSE_CANCELLED_MESSAGE : PARSE_FAILED_MESSAGE,
                }
                operation.record = { ...effective, state }
                try {
                  await this.deps.persistence.put(config, operation.record)
                } catch {
                  /* The job still has a definite failure if storage failed. */
                }
                await waiting
                return { status: wasCancelled ? 'killed' : 'failed', detail: state.message }
              }
            })
            .finally(() => {
              this.owned.delete(operation)
              this.trimTerminal()
            })
          operation = {
            record: effective,
            owner: SessionId(request.sessionId),
            config,
            registry,
            cancel,
            done,
          }
          this.owned.add(operation)
          return { cancel, done }
        },
      })
    } catch (error) {
      throw new ZoteroError(
        'Document parsing jobs are unavailable for this session.',
        ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
        { cause: error },
      )
    }
    return operation
  }

  private reserve(
    source: string,
    target: ParseTarget,
    config: EnrichmentPreferences,
    proposed: string,
    action: ZoteroStartDocumentParseRequestView['action'],
    ready: Promise<void>,
  ): SharedGeneration {
    const current = this.shared.get(source)
    if (
      action !== 'reparse' &&
      current !== undefined &&
      !current.controller.signal.aborted &&
      (action !== 'retry' || current.generation === proposed)
    )
      return current
    const generation = proposed
    const controller = new AbortController()
    const waiters = new Map<JobHandle, () => void>()
    const lane = parseDigest(JSON.stringify([target.sourceId, config.outputDir]))
    const predecessor = this.tails.get(lane) ?? Promise.resolve()
    let entry!: SharedGeneration
    const promise = Promise.resolve()
      .then(async () => {
        await ready
        await predecessor
        controller.signal.throwIfAborted()
        this.open()
        this.generations.set(source, generation)
        await this.deps.persistence.putGeneration(config, source, generation)
        controller.signal.throwIfAborted()
        for (const check of [...waiters.values()]) check()
        controller.signal.throwIfAborted()
        const resolved = await resolveParseTarget(
          target,
          this.deps.resolveAttachment,
          controller.signal,
        )
        for (const check of [...waiters.values()]) check()
        controller.signal.throwIfAborted()
        const onProgress = (phase: ParseJobPhase): void => {
          const text = PARSE_JOB_PHASES[phase]
          if (text !== undefined) for (const job of waiters.keys()) job.updateProgress(text)
        }
        onProgress('acquiring')
        const result = await this.deps.execute({
          input: resolved.input,
          config,
          generation,
          signal: controller.signal,
          onProgress,
        })
        return { result, target: resolved }
      })
      .then(
        (value) => {
          entry.settled = true
          return value
        },
        (error: unknown) => {
          entry.settled = true
          throw error
        },
      )
    const tail = promise
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        entry.settled = true
        if (this.shared.get(source) === entry) this.shared.delete(source)
        if (this.tails.get(lane) === tail) this.tails.delete(lane)
      })
    entry = { generation, controller, waiters, promise, settled: false }
    this.generations.set(source, generation)
    while (this.generations.size > 256)
      this.generations.delete(this.generations.keys().next().value!)
    this.shared.set(source, entry)
    this.tails.set(lane, tail)
    return entry
  }

  /** An independent waiter leaves synchronously; the last one awaits real shared cleanup. */
  private async wait(
    shared: SharedGeneration,
    job: JobHandle,
    signal: AbortSignal,
    check: () => void,
  ): Promise<Awaited<SharedGeneration['promise']>> {
    shared.waiters.set(job, check)
    const leave = (): boolean => {
      shared.waiters.delete(job)
      if (shared.waiters.size !== 0) return false
      if (!shared.settled && !shared.controller.signal.aborted) shared.controller.abort(cancelled())
      return true
    }
    let cancelledLast = false
    const abort = (): void => {
      cancelledLast = leave()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (signal.aborted) abort()
      signal.throwIfAborted()
      return await raceWithSignal(shared.promise, signal)
    } catch (error) {
      // The last cancellation waits through publication: a successfully
      // committed artifact is reported honestly even if abort raced its rename.
      if (signal.aborted && cancelledLast) return await shared.promise
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
      if (leave())
        await shared.promise.then(
          () => {},
          () => {},
        )
    }
  }

  private receipt(
    operationId: string,
    generation: string,
    config: EnrichmentPreferences,
    target: ParseTarget,
    result: ParseDocumentResult,
  ): ZoteroParseReceiptView {
    if (
      result.provenance.generation !== generation ||
      result.artifact.meta.generation !== generation ||
      result.provenance.sourceId !== result.artifact.meta.sourceId
    ) {
      throw new ZoteroError(
        'The parsed artifact does not match the admitted generation.',
        ZOTERO_ENRICHMENT_TASK_FAILED,
      )
    }
    const pageCount = result.artifact.meta.pageCount
    return {
      operationId,
      generation,
      sourceId: result.provenance.sourceId,
      targetLabel: target.targetLabel,
      mode: config.mode,
      cached: result.cached,
      artifactId: result.cacheKey,
      fingerprint: result.artifact.meta.contentFingerprint,
      format: 'markdown',
      characterCount: result.artifact.markdown.length,
      preview: safeParseText(result.artifact.markdown, 4096),
      ...(pageCount !== undefined && Number.isSafeInteger(pageCount) && pageCount > 0
        ? { pageCount }
        : {}),
    }
  }

  async documentArtifact(
    input: ZoteroDocumentArtifactRequestView,
    signal: AbortSignal,
    currentCtx: Context = this.ctx,
  ): Promise<ZoteroDocumentArtifactResultView> {
    signal.throwIfAborted()
    this.open()
    const request = parseWire(zoteroDocumentArtifactRequestSchema, input)
    const sessionId = SessionId(request.sessionId)
    await this.owner(sessionId, 'documentArtifact', signal, currentCtx)
    const config = this.config()
    const target = await resolveParseTarget(
      parseTargetOf(request.target),
      this.deps.resolveAttachment,
      signal,
    )
    signal.throwIfAborted()
    this.open()
    this.authorize(sessionId, 'documentArtifact', currentCtx)
    const result = await this.deps.lookup(target.input, config, signal)
    signal.throwIfAborted()
    this.open()
    this.authorize(sessionId, 'documentArtifact', currentCtx)
    if (result.kind === 'fault') throw result.error
    if (result.kind === 'miss') return { kind: result.reason === 'expired' ? 'expired' : 'missing' }
    return {
      kind: 'ready',
      sourceId: result.provenance.sourceId,
      targetLabel: target.targetLabel,
      mode: result.provenance.mode,
      artifactId: result.provenance.artifactId,
      fingerprint: result.provenance.fingerprint,
      characterCount: result.text.length,
      ...(result.pageCount !== undefined ? { pageCount: result.pageCount } : {}),
    }
  }

  async documentParseReceipt(
    input: ZoteroDocumentParseReceiptRequestView,
    signal: AbortSignal,
    currentCtx: Context = this.ctx,
  ): Promise<ZoteroDocumentParseReceiptResultView> {
    signal.throwIfAborted()
    this.open()
    const request = parseWire(zoteroDocumentParseReceiptRequestSchema, input)
    const sessionId = SessionId(request.sessionId)
    this.authorize(sessionId, 'documentParseReceipt', currentCtx)
    const key = parseDigest(JSON.stringify([sessionId, request.operationId]))
    const active = this.operations.get(key)
    const record =
      active?.record ??
      (await this.deps.persistence.get(this.config(), parseDigest(sessionId), request.operationId))
    signal.throwIfAborted()
    this.open()
    this.authorize(sessionId, 'documentParseReceipt', currentCtx)
    if (record === undefined)
      throw new ZoteroError('No parsing operation belongs to this session.', ZOTERO_NOT_FOUND)
    if (record.state.kind === 'pending' && active === undefined) {
      return {
        kind: 'cancelled',
        code: ZOTERO_ENRICHMENT_TASK_FAILED,
        message: PARSE_CANCELLED_MESSAGE,
      }
    }
    return record.state
  }

  private trimTerminal(): void {
    if (this.operations.size <= 256) return
    for (const [key, operation] of this.operations) {
      if (!this.owned.has(operation) && operation.record.state.kind !== 'pending')
        this.operations.delete(key)
      if (this.operations.size <= 256) break
    }
  }

  /** Stop admission synchronously, abort owned waiters, and wait for their actual cleanup. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closed = true
    for (const operation of this.owned) {
      if (operation.record.state.kind !== 'pending') continue
      operation.cancel()
      try {
        operation.registry.kill(
          JobId(operation.record.jobId),
          operation.owner,
          'enrichment disposed',
        )
      } catch {
        /* Local cancellation above remains authoritative. */
      }
    }
    for (const entry of this.shared.values())
      if (!entry.controller.signal.aborted) entry.controller.abort(cancelled())
    this.disposal = (async () => {
      await Promise.allSettled([...this.admissions.values()].map(({ task }) => task))
      await Promise.allSettled([...this.owned].map(({ done }) => done))
      await Promise.allSettled(this.tails.values())
    })()
    return this.disposal
  }
}
