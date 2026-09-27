/**
 * Test stub for `ctx.jobs`: provides an in-memory `TestJobRegistry`
 * that implements the minimal `JobRegistry` surface needed for testing
 * background and promoted jobs without depending on external daemons.
 * @module tests/helpers/fake-jobs
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JobHandle, JobHooks, JobId, JobSpec, JobStatus, JobView } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface JobRecord {
  spec: JobSpec
  hooks: JobHooks
  handle: JobHandle
  status: JobStatus
  detail?: string
  progress?: string
  result?: string
  appends: { text: string; channel?: string }[]
  progressEvents: string[]
}

export function projectJobView(id: JobId, record: JobRecord): JobView {
  return {
    id,
    kind: record.spec.kind,
    label: record.spec.label,
    owner: record.spec.owner,
    outputLimitBytes: record.spec.outputLimitBytes,
    status: record.status,
    progress: record.progress,
    detail: record.detail,
    startedAt: Date.now(),
    output: { total: 0, earliest: 0 },
  }
}

export class TestJobRegistry extends Service {
  private idCounter = 0
  readonly jobs = new Map<JobId, JobRecord>()

  constructor(ctx: Context = new Context()) {
    super(ctx, 'jobs')
  }

  start(spec: JobSpec): JobId {
    const id = `zotero-${++this.idCounter}` as JobId
    const record: JobRecord = {
      spec,
      hooks: undefined as never,
      handle: undefined as never,
      status: 'running',
      appends: [],
      progressEvents: [],
    }

    const handle: JobHandle = {
      id,
      updateProgress: (msg) => {
        record.progress = msg
        record.progressEvents.push(msg)
      },
      append: (chunk, opts) => {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
        record.appends.push({ text, channel: opts?.channel })
      },
    }
    record.handle = handle
    record.hooks = spec.run(handle)
    void record.hooks.done.then((outcome) => {
      record.status = outcome.status
      record.detail = outcome.detail
      record.result = outcome.result
    })
    this.jobs.set(id, record)
    return id
  }

  async wait(
    id: JobId,
    timeoutMs?: number,
    _caller?: SessionId,
    signal?: AbortSignal,
  ): Promise<JobView> {
    const job = this.jobs.get(id)
    if (!job) throw new Error(`unknown job ${id}`)
    if (signal?.aborted) throw new Error('aborted')

    if (timeoutMs === undefined || timeoutMs <= 0) {
      const outcome = await job.hooks.done
      job.status = outcome.status
      job.detail = outcome.detail
      job.result = outcome.result
      return projectJobView(id, job)
    }

    return await new Promise<JobView>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      const onAbort = () => {
        if (timer) clearTimeout(timer)
        reject(new Error('signal aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      void job.hooks.done.then((outcome) => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        job.status = outcome.status
        job.detail = outcome.detail
        job.result = outcome.result
        resolve(projectJobView(id, job))
      })

      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve(projectJobView(id, job))
      }, timeoutMs)
    })
  }

  kill(id: JobId, _caller?: SessionId, reason?: string): JobView {
    const job = this.jobs.get(id)
    if (!job) throw new Error(`unknown job ${id}`)
    job.hooks.cancel?.(reason)
    job.status = 'killed'
    job.detail = reason
    return projectJobView(id, job)
  }

  remove(id: JobId, _caller?: SessionId): void {
    this.jobs.delete(id)
  }
}
