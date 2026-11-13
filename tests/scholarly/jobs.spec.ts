/**
 * The long scholarly tools' background-job surface: the static
 * `run_in_background` parameter, the background and promoted arms, progress
 * reporting, kill, the job result text, and the teardown that stops a
 * component's own jobs.
 * @module tests/scholarly/jobs
 */

import { Context } from '@deepseek-ai/cordis'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoteroJobRunner, jobPromotedMessage } from '../../src/job-runner.js'
import { createScholarlyReadTool } from '../../src/scholarly/tools/read.js'
import { createScholarlySearchTool } from '../../src/scholarly/tools/search.js'
import { createScholarlyVerifyTool } from '../../src/scholarly/tools/verify.js'
import {
  SCHOLARLY_JOB_OUTPUT_DESCRIPTOR,
  SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES,
} from '../../src/scholarly/tools/jobs.js'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { composeRealJobs, type RealJobs } from '../helpers/real-jobs.ts'
import { deferred } from '../helpers/sync.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from './fixtures.js'

/** The registries this spec composed; teardown stops their live jobs. */
const registries: RealJobs[] = []
/** The contexts the cases create; each owns a registry fiber and must unload. */
const contexts: Context[] = []
afterEach(async () => {
  for (const jobs of registries.splice(0)) await jobs.dispose()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** A fresh context tracked by the spec's teardown. */
function contextOf(): Context {
  const ctx = new Context()
  contexts.push(ctx)
  return ctx
}

/** The real registry on a context of its own, disposed with the case. */
async function registryOn(ctx: Context): Promise<RealJobs> {
  const jobs = await composeRealJobs(ctx)
  registries.push(jobs)
  return jobs
}

/** A host whose job policy and runner the spec controls. */
function hostWith(
  policy: {
    enableRunInBackground: boolean
    promoteOnTimeout: boolean
    foregroundWaitMs: number
  },
  registry?: JobRegistry,
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const host = createMockHost(createMockHttp(handler ?? (() => new Response('{}'))))
  const runner = new ZoteroJobRunner(registry)
  return {
    host: {
      ...host,
      jobPolicy: () => policy,
      jobRunner: () => runner,
    },
    runner,
  }
}

describe('scholarly background jobs', () => {
  it('declares run_in_background statically on the three long tools', () => {
    const { host } = hostWith({
      enableRunInBackground: true,
      promoteOnTimeout: true,
      foregroundWaitMs: 1_000,
    })
    for (const tool of [
      createScholarlyReadTool(host),
      createScholarlySearchTool(host),
      createScholarlyVerifyTool(host),
    ]) {
      const props = (tool.parameters as { properties?: Record<string, unknown> }).properties
      expect(props?.run_in_background, tool.name).toBeDefined()
    }
  })

  it('refuses run_in_background when the policy disables it', async () => {
    const { host } = hostWith({
      enableRunInBackground: false,
      promoteOnTimeout: true,
      foregroundWaitMs: 1_000,
    })
    const tool = createScholarlySearchTool(host)
    await expect(
      tool.execute({ query: 'attention', run_in_background: true }, EXEC_CONTEXT as never),
    ).rejects.toThrow('run_in_background is disabled in this deployment')
  })

  it('refuses run_in_background when no jobs registry is composed', async () => {
    const { host } = hostWith({
      enableRunInBackground: true,
      promoteOnTimeout: true,
      foregroundWaitMs: 1_000,
    })
    const tool = createScholarlySearchTool(host)
    await expect(
      tool.execute({ query: 'attention', run_in_background: true }, EXEC_CONTEXT as never),
    ).rejects.toThrow('Background execution is unavailable')
  })

  it('starts a background search job and returns the job arm', async () => {
    const ctx = contextOf()
    const jobs = await registryOn(ctx)
    const { host } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      jobs.registry,
      () => new Response('{}'),
    )
    const tool = createScholarlySearchTool(host)

    const result = (await tool.execute(
      { query: 'attention', run_in_background: true },
      EXEC_CONTEXT as never,
    )) as { kind: string; jobId: string }

    expect(result.kind).toBe('background')
    expect(result.jobId).toBeDefined()
    const view = jobs.registry.get(JobId(result.jobId))
    expect(view.kind).toBe('scholarly')
    expect(view.outputLimitBytes).toBe(SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES)
    const settled = await jobs.settled(JobId(result.jobId))
    expect(settled.status).toBe('completed')
    expect(jobs.registry.read(JobId(result.jobId)).result).toContain('attention')
  })

  it('records progress for every source a search queries', async () => {
    const ctx = contextOf()
    const jobs = await registryOn(ctx)
    const { host } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      jobs.registry,
      () => new Response('{}'),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'attention', run_in_background: true, sources: ['arxiv'] },
      EXEC_CONTEXT as never,
    )) as { jobId: string }
    await jobs.settled(JobId(result.jobId))
    // The job settled; its progress slot is cleared at settlement and every
    // progress line remains in the log channel.
    expect(jobs.registry.get(JobId(result.jobId)).status).toBe('completed')
    const progressed = jobs.registry
      .read(JobId(result.jobId))
      .chunks.filter((chunk) => chunk.text.startsWith('[progress] '))
    expect(progressed.length).toBeGreaterThan(0)
  })

  it('projects the job arm as card metadata and the body as an empty card', () => {
    const tool = createScholarlySearchTool(createMockHost(createMockHttp(() => new Response('{}'))))
    const meta = tool.output.presentationMeta as (
      args: unknown,
      value: unknown,
    ) => Record<string, unknown>
    expect(meta({ query: 'attention' }, { kind: 'background', jobId: 'job-1' })).toEqual({
      kind: 'background',
      jobId: 'job-1',
    })
    expect(
      meta(
        { query: 'attention' },
        { kind: 'promoted', jobId: 'job-2', timeoutMs: 20, message: 'm' },
      ),
    ).toEqual({
      kind: 'promoted',
      jobId: 'job-2',
      timeoutMs: 20,
      message: 'm',
    })
    expect(meta({ query: 'attention' }, { text: 'body' })).toEqual({})
  })

  it('promotes a slow search to a background job and reports the promotion', async () => {
    const ctx = contextOf()
    const jobs = await registryOn(ctx)
    const release = deferred<void>()
    const { host } = hostWith(
      { enableRunInBackground: false, promoteOnTimeout: true, foregroundWaitMs: 20 },
      jobs.registry,
      async () => {
        await release.promise
        return new Response('{}')
      },
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute({ query: 'attention' }, EXEC_CONTEXT as never)) as {
      kind: string
      jobId: string
      timeoutMs: number
      message: string
    }
    release.resolve()
    expect(result.kind).toBe('promoted')
    expect(result.timeoutMs).toBe(20)
    expect(result.message).toBe(jobPromotedMessage(result.jobId, 20))
    // The rendered arm carries the shared promotion reason, not a bare id.
    const rendered = tool.output.render(
      { query: 'attention' },
      { kind: 'promoted', jobId: result.jobId, timeoutMs: 20, message: result.message },
    )
    expect((rendered[0] as { text: string }).text).toContain('operation timed out after 20ms')
    await jobs.settled(JobId(result.jobId))
  })

  it('returns the foreground result when the call settles inside the wait window', async () => {
    const ctx = contextOf()
    const jobs = await registryOn(ctx)
    const { host } = hostWith(
      { enableRunInBackground: false, promoteOnTimeout: true, foregroundWaitMs: 5_000 },
      jobs.registry,
      () => new Response('{}'),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute({ query: 'attention' }, EXEC_CONTEXT as never)) as {
      text: string
    }
    expect(result.text).toContain('attention')
  })

  it('aborts a background job when it is killed', async () => {
    const ctx = contextOf()
    const jobs = await registryOn(ctx)
    const { host } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      jobs.registry,
      async (_url, init) => {
        await new Promise((resolve) =>
          init?.signal?.addEventListener('abort', resolve, { once: true }),
        )
        throw new Error('aborted')
      },
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'attention', run_in_background: true },
      EXEC_CONTEXT as never,
    )) as { jobId: string }
    expect(jobs.registry.kill(JobId(result.jobId), undefined, 'stopped by user')).toBe('requested')
    expect((await jobs.settled(JobId(result.jobId))).status).toBe('killed')
  })

  it('kills the component-owned jobs when the runner is torn down', async () => {
    const ctx = contextOf()
    const jobs = await registryOn(ctx)
    const { host, runner } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      jobs.registry,
      async (_url, init) => {
        await new Promise((resolve) =>
          init?.signal?.addEventListener('abort', resolve, { once: true }),
        )
        throw new Error('aborted')
      },
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'attention', run_in_background: true },
      EXEC_CONTEXT as never,
    )) as { jobId: string }
    runner.killAll('scholarly service disposed')
    expect((await jobs.settled(JobId(result.jobId))).status).toBe('killed')
  })

  it('renders and projects both job arms and plain text', () => {
    const output = SCHOLARLY_JOB_OUTPUT_DESCRIPTOR
    const background = { kind: 'background', jobId: 'job-1' } as const
    expect(output.render({}, background)).toEqual([
      { type: 'text', text: 'started background job job-1' },
    ])
    expect(output.presentationMeta?.({}, background)).toEqual(background)
    expect(output.render({}, { text: 'body' } as const)).toEqual([{ type: 'text', text: 'body' }])
    expect(output.presentationMeta?.({}, { text: 'body' } as const)).toEqual({})
  })

  it("projects job arms through the tools' own presentResult", () => {
    const { host } = hostWith({
      enableRunInBackground: true,
      promoteOnTimeout: true,
      foregroundWaitMs: 1_000,
    })
    const arm = { kind: 'background', jobId: 'job-present' }
    const result = { meta: arm, content: [], isError: false }
    // `defineTool` validates the arguments before the projection runs, so each
    // call needs its tool's own minimal valid input.
    const minimalArgs = new Map([
      [createScholarlyReadTool(host), { id: '2301.07041' }],
      [createScholarlySearchTool(host), { query: 'attention' }],
    ])
    for (const [tool, args] of minimalArgs) {
      expect(tool.presentResult?.(args as never, result as never)).toEqual({
        card: 'generic',
        title: expect.stringContaining('background job job-present'),
      })
    }
  })
})
