/**
 * The long scholarly tools' background-job surface: the static
 * `run_in_background` parameter, the background and promoted arms, progress
 * reporting, kill, the job result text, and the teardown that stops a
 * component's own jobs.
 * @module tests/scholarly/jobs
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ZoteroJobRunner, jobPromotedMessage } from '../../src/job-runner.js'
import { createScholarlyReadTool } from '../../src/scholarly/tools/read.js'
import { createScholarlySearchTool } from '../../src/scholarly/tools/search.js'
import { createScholarlyVerifyTool } from '../../src/scholarly/tools/verify.js'
import { SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES } from '../../src/scholarly/tools/jobs.js'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { TestJobRegistry } from '../helpers/fake-jobs.js'
import { deferred } from '../helpers/sync.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from './fixtures.js'

/** A host whose job policy and runner the spec controls. */
function hostWith(
  policy: {
    enableRunInBackground: boolean
    promoteOnTimeout: boolean
    foregroundWaitMs: number
  },
  registry?: TestJobRegistry,
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const host = createMockHost(createMockHttp(handler ?? (() => new Response('{}'))))
  const runner = new ZoteroJobRunner(registry as unknown as JobRegistry)
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
    ).rejects.toThrow('run_in_background is disabled for this deployment')
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
    ).rejects.toThrow('background jobs unavailable')
  })

  it('starts a background search job and returns the job arm', async () => {
    const ctx = new Context()
    const registry = new TestJobRegistry(ctx)
    const { host } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      registry,
      () => new Response('{}'),
    )
    const tool = createScholarlySearchTool(host)

    const result = (await tool.execute(
      { query: 'attention', run_in_background: true },
      EXEC_CONTEXT as never,
    )) as { kind: string; jobId: string }

    expect(result.kind).toBe('background')
    expect(result.jobId).toBeDefined()
    const job = registry.jobs.get(result.jobId as never)!
    expect(job.spec.kind).toBe('scholarly')
    expect(job.spec.outputLimitBytes).toBe(SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES)
    const outcome = await job.hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.result).toContain('attention')
  })

  it('records progress for every source a search queries', async () => {
    const ctx = new Context()
    const registry = new TestJobRegistry(ctx)
    const { host } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      registry,
      () => new Response('{}'),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'attention', run_in_background: true, sources: ['arxiv'] },
      EXEC_CONTEXT as never,
    )) as { jobId: string }
    const job = registry.jobs.get(result.jobId as never)!
    await job.hooks.done
    expect(job.progressEvents.length).toBeGreaterThan(0)
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
    const ctx = new Context()
    const registry = new TestJobRegistry(ctx)
    const release = deferred<void>()
    const { host } = hostWith(
      { enableRunInBackground: false, promoteOnTimeout: true, foregroundWaitMs: 20 },
      registry,
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
    const job = registry.jobs.get(result.jobId as never)!
    await job.hooks.done
  })

  it('returns the foreground result when the call settles inside the wait window', async () => {
    const ctx = new Context()
    const registry = new TestJobRegistry(ctx)
    const { host } = hostWith(
      { enableRunInBackground: false, promoteOnTimeout: true, foregroundWaitMs: 5_000 },
      registry,
      () => new Response('{}'),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute({ query: 'attention' }, EXEC_CONTEXT as never)) as {
      text: string
    }
    expect(result.text).toContain('attention')
  })

  it('aborts a background job when it is killed', async () => {
    const ctx = new Context()
    const registry = new TestJobRegistry(ctx)
    const { host } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      registry,
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
    const job = registry.jobs.get(result.jobId as never)!
    registry.kill(result.jobId as never, undefined, 'stopped by user')
    const outcome = await job.hooks.done
    expect(outcome.status).toBe('killed')
  })

  it('kills the component-owned jobs when the runner is torn down', async () => {
    const ctx = new Context()
    const registry = new TestJobRegistry(ctx)
    const { host, runner } = hostWith(
      { enableRunInBackground: true, promoteOnTimeout: true, foregroundWaitMs: 1_000 },
      registry,
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
    const job = registry.jobs.get(result.jobId as never)!
    runner.killAll('scholarly service disposed')
    const outcome = await job.hooks.done
    expect(outcome.status).toBe('killed')
  })
})
