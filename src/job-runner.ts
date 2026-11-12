/**
 * Generic-job adaptation for long-running Zotero operations:
 * connects heavy domain operations (export, changes) to `ctx.jobs`,
 * providing progress updates to the Web session header, non-intrusive logging,
 * user cancellation (kill), and promote-on-timeout foreground execution.
 *
 * @module dsh-zotero/job-runner
 */

import type { ResultDelivery } from './result-delivery.js'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  JobHandle,
  JobHooks,
  JobId,
  JobOutcome,
  JobRegistry,
  JobSpec,
  JobView,
} from '@deepseek-ai/dsh-jobs'
import { JobError } from '@deepseek-ai/dsh-jobs'
import { ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import { TOOL_ABORTED_MESSAGE } from './abort.js'
import { errorMessageOf, ZoteroError } from './errors.js'
import type { DiagnosticSink } from './diagnostics.js'
import type { ZoteroProgressEvent } from './types.js'

/** Structured abort thrown when a tool call or job wait is cancelled by the caller. */
function toolAborted(): HarnessError {
  const error = new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}

/**
 * Shown when the host serves no job registry. The model cannot change the
 * deployment, so the sentence names the one thing it can do — run the call in
 * the foreground — instead of the packages the host would have to compose.
 */
export const JOBS_UNAVAILABLE_MESSAGE =
  'Background execution is unavailable in this session; run the call in the foreground.'

export const RUN_IN_BACKGROUND_DISABLED_MESSAGE =
  'run_in_background is disabled in this deployment; run the call in the foreground.'

export function jobStartedMessage(jobId: string): string {
  return `started background job ${jobId}`
}

/**
 * Register a tool whose `run_in_background` parameter exists only when this
 * composition can serve it: the deployment enabled the flag and a job registry
 * is mounted. The foreground-only schema registers first, and the jobs
 * injection swaps in the background-capable one, so a host that cannot start a
 * job never advertises the key. Execute still refuses an undeclared background
 * request, because the registry admits argument keys the schema omits.
 * @param ctx - the plugin context.
 * @param backgroundEnabled - the live deployment switch.
 * @param register - registers one arm and returns its disposer.
 * @returns the disposer for the registration the composition chose.
 */
export function registerBackgroundAware(
  ctx: Context,
  backgroundEnabled: boolean,
  register: (background: boolean) => () => void,
): () => void {
  if (!backgroundEnabled) return register(false)
  if (ctx.get('jobs') !== undefined) return register(true)
  const foregroundOnly = register(false)
  let background: (() => void) | undefined
  ctx.inject(['jobs'], () => {
    foregroundOnly()
    background = register(true)
    return () => {
      background?.()
      background = undefined
    }
  })
  return () => {
    foregroundOnly()
    background?.()
  }
}

/** Grace period for a cancelled job to settle before removing from the registry (ms). */
const JOB_CANCELLATION_SETTLE_MS = 1000

/**
 * The plugin's own view of a settled job: the harness `JobOutcome` plus the
 * object a failed producer actually threw.
 *
 * The harness boundary is string-only (`JobOutcome.detail`, `JobView.detail`,
 * `JobOutcome.result`), so `ZoteroError` identity cannot cross it. A foreground
 * wait that settles inside the promotion window is the one case the plugin can
 * still answer with the original error, because it holds this promise itself.
 * Every other arm (background, promoted, cancellation) reports the harness's
 * text and keeps the plugin's error out of reach. That is deliberate: nothing
 * at those boundaries can carry an error object.
 */
interface ZoteroJobOutcome extends JobOutcome {
  /** The thrown producer error, present only on the `failed` arm. */
  readonly error?: unknown
}

export function jobPromotedMessage(jobId: string, timeoutMs: number): string {
  return `operation timed out after ${timeoutMs}ms and was promoted to background job ${jobId}`
}

/** Honest promotion copy when the foreground wait itself failed, not a timeout. */
export function jobWaitFailedMessage(jobId: string, error: unknown): string {
  const reason = errorMessageOf(error)
  return `foreground wait failed (${reason}); the work continues as background job ${jobId}`
}

/**
 * Whether a tool result is one of the two job arms rather than a domain payload.
 * Structural (not `JobArmResult`) so it narrows schema-inferred unions whose
 * `jobId` is a plain string.
 */
export function isJobArm(
  value: unknown,
): value is { readonly kind: 'background' | 'promoted'; readonly jobId: string } {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'background' || kind === 'promoted'
}

/** Render the started/promoted text a model reads for a job arm. */
export function renderJobArm(value: {
  readonly kind: 'background' | 'promoted'
  readonly jobId: string
  readonly message?: string
}): ContentBlock[] {
  const text =
    value.kind === 'background'
      ? jobStartedMessage(value.jobId)
      : (value.message ?? jobStartedMessage(value.jobId))
  return [{ type: 'text', text }]
}

/** Generic card title for a job arm, with the tool noun supplied by the caller. */
export function presentJobArm(
  noun: string,
  record: Record<string, unknown>,
): ToolResultView | undefined {
  if (!isJobArm(record)) return undefined
  const jobId = String(record.jobId)
  const title =
    record.kind === 'background'
      ? `${noun}: background job ${jobId}`
      : `${noun}: promoted to job ${jobId}`
  return { card: 'generic', title }
}

/**
 * Output-schema arms for the two job returns every heavy tool shares. Kept
 * here so a third tool cannot spell them a third way.
 */
export const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  jobId: { type: 'string', required: true },
  resultSessionId: { type: 'string' },
} as const

export const PROMOTED_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'promoted' },
  jobId: { type: 'string', required: true },
  resultSessionId: { type: 'string' },
  timeoutMs: { type: 'number', required: true },
  message: { type: 'string', required: true },
} as const

/**
 * Parameter schema for the `run_in_background` flag that heavy tools share.
 */
export const RUN_IN_BACKGROUND_PARAMETER = {
  run_in_background: {
    type: 'boolean',
    description:
      'Run in the background and return a job id immediately (collect with job_output, stop with job_kill).',
  },
} as const

/** The job kind a shared task registers under. */
type JobSpecKind = JobSpec['kind']

/** One heavy operation the shared job runner can start or promote. */
export interface ZoteroJobTask<T> {
  readonly label: string
  readonly exec: ToolExecution
  readonly kind?: JobSpecKind
  readonly outputLimitBytes?: number
  readonly run: (
    signal: AbortSignal,
    onProgress: (event: ZoteroProgressEvent) => void,
    log: (text: string) => void,
    jobId?: string,
  ) => Promise<T>
  readonly renderResult?: (value: T) => string
}

type JobRegistrySource = JobRegistry | (() => JobRegistry | undefined)

interface ActiveJob {
  readonly registry: JobRegistry
  readonly owner: SessionId | undefined
}

interface PromotedJobResult {
  readonly kind: 'promoted'
  readonly jobId: JobId
  readonly timeoutMs: number
  readonly message: string
  /** The owning session whose receipts resolve this job's persisted result. */
  readonly resultSessionId?: string
}

interface BackgroundJobResult {
  readonly kind: 'background'
  readonly jobId: JobId
  /** The owning session whose receipts resolve this job's persisted result. */
  readonly resultSessionId?: string
}

export type JobArmResult = BackgroundJobResult | PromotedJobResult

/** Job policy knobs every heavy tool reads from live config. */
export interface JobPolicy {
  readonly enableRunInBackground: boolean
  readonly promoteOnTimeout: boolean
  readonly foregroundWaitMs: number
}

/** Read the three job controls from a live config without repeating the mapping in each tool. */
export function jobPolicyOf(config: JobPolicy): JobPolicy {
  return {
    enableRunInBackground: config.enableRunInBackground,
    promoteOnTimeout: config.promoteOnTimeout,
    foregroundWaitMs: config.foregroundWaitMs,
  }
}

/**
 * Shared execute policy for heavy tools: explicit background start, promote
 * on foreground timeout, or a plain synchronous run. Tools supply the domain
 * call and the text renderer.
 */
export async function executeWithJobs<T>(options: {
  readonly runner: ZoteroJobRunner
  readonly exec: ToolExecution
  readonly label: string
  readonly kind?: ZoteroJobTask<T>['kind']
  readonly outputLimitBytes?: number
  readonly run: ZoteroJobTask<T>['run']
  readonly renderResult: ZoteroJobTask<T>['renderResult']
  readonly runInBackground: boolean
  readonly policy: JobPolicy
}): Promise<T | JobArmResult> {
  const { runner, exec, label, run, renderResult, policy } = options
  const task: ZoteroJobTask<T> = {
    label,
    exec,
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.outputLimitBytes === undefined
      ? {}
      : { outputLimitBytes: options.outputLimitBytes }),
    run,
    renderResult,
  }

  if (options.runInBackground) {
    if (!policy.enableRunInBackground) {
      throw new JobError(RUN_IN_BACKGROUND_DISABLED_MESSAGE, 'JOB_BACKGROUND_DISABLED')
    }
    if (!runner.isAvailable) {
      throw new ToolContextUnavailableError(JOBS_UNAVAILABLE_MESSAGE)
    }
    const { id } = runner.start(task)
    return {
      kind: 'background',
      jobId: id,
      ...(exec.agent?.session ? { resultSessionId: exec.agent.session.header.id } : {}),
    }
  }

  if (runner.isAvailable && policy.promoteOnTimeout) {
    const outcome = await runner.waitOrPromote(task, policy.foregroundWaitMs)
    return outcome.kind === 'promoted'
      ? {
          ...outcome,
          ...(exec.agent?.session ? { resultSessionId: exec.agent.session.header.id } : {}),
        }
      : outcome.value
  }

  return await run(
    exec.signal,
    () => {},
    () => {},
  )
}

export class ZoteroJobRunner {
  /** Live jobs this runner started, with the owner the registry fences on. */
  private readonly active = new Map<JobId, ActiveJob>()

  constructor(
    private readonly registrySource?: JobRegistrySource,
    private readonly sink?: DiagnosticSink,
    private readonly delivery?: ResultDelivery,
  ) {}

  private registry(): JobRegistry | undefined {
    return typeof this.registrySource === 'function' ? this.registrySource() : this.registrySource
  }

  get isAvailable(): boolean {
    return this.registry() !== undefined
  }

  /**
   * Stop every job this runner started and has not observed settling. Used by
   * a component teardown so disabling a producer does not leave its jobs
   * pointing at a disposed store or transport.
   * @param reason - registry-visible cancellation reason.
   */
  killAll(reason: string): void {
    for (const [id, { registry, owner }] of this.active) {
      try {
        registry.kill(id, owner, reason)
      } catch {
        // A job that settled between the snapshot and kill is already gone.
      }
    }
  }

  /**
   * Start an asynchronous background job with `ctx.jobs`.
   * @param task - the job body and its rendered outcome text.
   * @param options - `persistAtCompletion` is read once the body settles; a
   *   foreground wait passes a predicate so only a promoted settle publishes.
   */
  start<T>(
    task: ZoteroJobTask<T>,
    options?: { readonly persistAtCompletion?: () => boolean },
  ): { id: JobId; done: Promise<ZoteroJobOutcome> } {
    const registry = this.registry()
    if (!registry) {
      throw new ToolContextUnavailableError(JOBS_UNAVAILABLE_MESSAGE)
    }

    if (task.exec.signal.aborted) {
      throw toolAborted()
    }

    const abortController = new AbortController()
    let resolveOutcome!: (outcome: ZoteroJobOutcome) => void
    const donePromise = new Promise<ZoteroJobOutcome>((resolve) => {
      resolveOutcome = resolve
    })

    const id = registry.start({
      kind: task.kind ?? 'zotero',
      label: task.label,
      ...(task.outputLimitBytes === undefined ? {} : { outputLimitBytes: task.outputLimitBytes }),
      toolCall: { callId: task.exec.callId, rootCallId: task.exec.rootCallId },
      ...(task.exec.agent ? { owner: task.exec.agent.id } : {}),
      run: (job: JobHandle): JobHooks => {
        void (async () => {
          try {
            const value = await task.run(
              abortController.signal,
              (event) => {
                job.updateProgress(event.message)
                job.append(`[progress] ${event.message}\n`, { channel: 'log' })
              },
              (text) => {
                job.append(text.endsWith('\n') ? text : `${text}\n`, { channel: 'log' })
              },
              job.id,
            )
            const prepared =
              this.delivery && (options?.persistAtCompletion?.() ?? true)
                ? await this.delivery
                    .prepare(
                      task.exec,
                      value as JsonValue,
                      (data) => [{ type: 'text', text: task.renderResult?.(data as T) ?? '' }],
                      abortController.signal,
                      job.id,
                    )
                    .catch((error: unknown) => {
                      // A publish failure after the body has settled must not turn a
                      // completed, already-published job into a failed one.
                      this.sink?.warn(
                        'job.delivery',
                        `${task.label} completed but its result could not be persisted: ${errorMessageOf(error)}`,
                      )
                      return undefined
                    })
                : undefined
            const result =
              prepared?.delivery === 'file' ? prepared.summary : task.renderResult?.(value)
            this.sink?.info('job.outcome', `${task.label} completed`)
            resolveOutcome({
              status: 'completed',
              detail: task.label,
              ...(result !== undefined ? { result } : {}),
            })
          } catch (error) {
            if (abortController.signal.aborted) {
              const reason =
                typeof abortController.signal.reason === 'string'
                  ? abortController.signal.reason
                  : abortController.signal.reason instanceof Error
                    ? abortController.signal.reason.message
                    : 'cancelled'
              this.sink?.info('job.outcome', `${task.label} cancelled: ${reason}`)
              resolveOutcome({
                status: 'killed',
                detail: reason,
              })
            } else {
              const message = errorMessageOf(error)
              const code = error instanceof ZoteroError ? error.code : undefined
              this.sink?.error(
                'job.outcome',
                `${task.label} failed: ${message}`,
                code === undefined ? undefined : { errorCode: code },
              )
              resolveOutcome({
                status: 'failed',
                detail: message,
                error,
              })
            }
          }
        })()

        return {
          cancel: (reason) => {
            abortController.abort(reason ?? 'Job cancelled by user')
          },
          done: donePromise,
        }
      },
    })

    this.delivery?.track(donePromise)
    this.active.set(id, { registry, owner: task.exec.agent?.id })
    void donePromise.then(
      () => this.active.delete(id),
      () => this.active.delete(id),
    )
    return { id, done: donePromise }
  }

  /**
   * Wait for a job in the foreground up to `waitTimeoutMs`.
   * If it completes in time, the job record is removed from the registry (clean foreground experience)
   * and the result is returned.
   * If it times out, the job is promoted to run in the background.
   */
  async waitOrPromote<T>(
    task: ZoteroJobTask<T>,
    waitTimeoutMs: number,
  ): Promise<{ kind: 'foreground'; value: T } | PromotedJobResult> {
    const registry = this.registry()
    if (!registry) {
      const value = await task.run(
        task.exec.signal,
        () => {},
        () => {},
      )
      return { kind: 'foreground', value }
    }

    if (task.exec.signal.aborted) {
      throw toolAborted()
    }

    let resultValue: T | undefined
    /** A promoted job publishes its result; a foreground settle leaves that to `wrap`. */
    let promoted = false
    // Outcome text is always materialized when the job settles. Skipping it for
    // a foreground settle is racy: the job can finish and render just as the
    // wait times out, leaving a promoted `JobOutcome.result` empty for
    // `job_output`. A discarded foreground string is cheaper than a wrong one.
    const wrappedTask: ZoteroJobTask<T> = {
      ...task,
      run: async (signal, onProgress, log) => {
        const val = await task.run(signal, onProgress, log)
        resultValue = val
        return val
      },
    }

    // A registry that refuses admission (no controller for the owner, job
    // limit) must not fail a healthy foreground call: run under the caller's
    // own deadline instead, exactly as a composition without a registry does.
    // Mirrors tool-bash's startJob catch → foreground fallback.
    let started: { id: JobId; done: Promise<ZoteroJobOutcome> } | undefined
    try {
      started = this.start(wrappedTask, { persistAtCompletion: () => promoted })
    } catch (error) {
      this.sink?.warn(
        'job.refused',
        `job registration refused, running in the foreground: ${errorMessageOf(error)}`,
      )
      const value = await task.run(
        task.exec.signal,
        () => {},
        () => {},
      )
      return { kind: 'foreground', value }
    }
    const { id, done } = started
    const owner = task.exec.agent?.id
    /**
     * Publish a body the run already produced. The job body itself publishes
     * too (same owning call, deduplicated in `ResultDelivery`), so a promotion
     * that races the settle still has one receipt before the caller sees it.
     */
    const publishSettled = async (value: T | undefined): Promise<void> => {
      if (value === undefined || this.delivery === undefined) return
      try {
        await this.delivery.prepare(
          task.exec,
          value as JsonValue,
          (data) => [{ type: 'text', text: task.renderResult?.(data as T) ?? '' }],
          task.exec.signal,
          id,
        )
      } catch (error) {
        this.sink?.warn(
          'job.delivery',
          `${task.label} was promoted but its result could not be persisted: ${errorMessageOf(error)}`,
        )
      }
    }

    let view: JobView
    try {
      view = await registry.wait(id, waitTimeoutMs, owner, task.exec.signal)
    } catch (error) {
      // Only a caller abort cancels the job. A registry failure (unknown id,
      // owner fence, internal error) must not destroy a healthy in-flight
      // operation or be reported as cancellation.
      if (task.exec.signal.aborted) {
        try {
          registry.kill(id, owner, TOOL_ABORTED_MESSAGE)
        } catch {
          // The owner may have been disposed, or the registry may have
          // observed terminal settlement between wait rejection and here.
        }
        // `kill` moves a live job to `stopping`; remove is legal only after the
        // registry observes terminal settlement. Wait for the producer first,
        // then let the registry publish its terminal view before removing the
        // private foreground record. Cancellation itself must stay immediate.
        void this.removeAfterCancellation(registry, id, owner, done)
        throw toolAborted()
      }
      // The job is still live and the id is the only handle. Hand it back as a
      // promotion so the model can collect or kill it, rather than rethrowing
      // and leaving unowned work in the registry.
      this.sink?.warn(
        'job.promoted',
        `${task.label} handed to the background after a wait failure`,
        {
          jobId: id,
        },
      )
      promoted = true
      await publishSettled(resultValue)
      return {
        kind: 'promoted',
        jobId: id,
        timeoutMs: waitTimeoutMs,
        message: jobWaitFailedMessage(id, error),
      }
    }

    if (view.status === 'running' || view.status === 'stopping') {
      // Timed out: job is promoted to background.
      this.sink?.info('job.promoted', `${task.label} promoted to the background`, {
        jobId: id,
        waitMs: waitTimeoutMs,
      })
      promoted = true
      await publishSettled(resultValue)
      return {
        kind: 'promoted',
        jobId: id,
        timeoutMs: waitTimeoutMs,
        message: jobPromotedMessage(id, waitTimeoutMs),
      }
    }

    // Settled within foreground wait
    registry.remove(id, owner)

    if (view.status === 'failed') {
      // Prefer the producer's own error: the registry's `detail` is a string,
      // and a `ZoteroError`'s code is what the model routes on. `done` is
      // already settled here, because the registry publishes its terminal view
      // only after the producer promise resolves, so this await cannot block.
      const settled = await done
      if (settled.error instanceof Error) throw settled.error
      throw new Error(view.detail ?? 'Zotero operation failed')
    }
    if (view.status === 'killed') {
      throw new Error(`Zotero operation cancelled: ${view.detail ?? 'cancelled'}`)
    }

    return { kind: 'foreground', value: resultValue! }
  }

  /** Remove a cancelled foreground record after the registry has settled it. */
  private async removeAfterCancellation(
    registry: JobRegistry,
    id: JobId,
    owner: SessionId | undefined,
    done: Promise<ZoteroJobOutcome>,
  ): Promise<void> {
    try {
      await done
      // LocalJobRegistry settles from the producer promise in a following
      // microtask; wait through its public view rather than racing remove.
      const view = await registry.wait(id, JOB_CANCELLATION_SETTLE_MS, owner)
      if (view.status === 'completed' || view.status === 'failed' || view.status === 'killed') {
        registry.remove(id, owner)
      }
    } catch {
      // A cancelled foreground call has no model-visible job id. If the
      // producer refuses to settle, the registry retains it for normal owner
      // disposal rather than turning cancellation into a second error.
    }
  }
}
