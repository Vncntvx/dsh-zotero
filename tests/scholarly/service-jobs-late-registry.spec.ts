/**
 * `ScholarlyService` follows a jobs registry that mounts after it.
 *
 * The runner must resolve `ctx.jobs` lazily (the same contract the core
 * service pinned at `tests/unit/job-runner-registry.spec.ts`): a plugin-loaded
 * registry may arrive after this row, and an eagerly captured `undefined`
 * would permanently refuse explicit background runs and silently skip
 * promotion. These are composition-level versions of that invariant — the
 * real service, its real tool registration, and a registry mounted between
 * two calls.
 * @module tests/scholarly/service-jobs-late-registry
 */

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it, vi } from 'vitest'
import { ScholarlyService } from '../../src/scholarly/service.js'
import { composeRealJobs } from '../helpers/real-jobs.ts'
import { bootScholarlyContext } from './fixtures.js'

const { fetchStub, fetchGate } = vi.hoisted(() => {
  let release: (() => void) | undefined
  let gate: Promise<void> | undefined
  return {
    fetchGate: {
      hold(): void {
        gate = new Promise<void>((resolve) => {
          release = resolve
        })
      },
      release(): void {
        release?.()
        release = undefined
        gate = undefined
      },
    },
    fetchStub: vi.fn(async () => {
      if (gate !== undefined) await gate
      return new Response('{}')
    }),
  }
})

// The production composition fetches through the plugin's own undici copy, not
// the runtime's global `fetch`: stub the seam, not the global.
vi.mock('../../src/transport/connections.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/transport/connections.js')>()),
  publicFetch: fetchStub,
}))

function backgroundSearchCall() {
  return {
    calls: [
      {
        type: 'tool-call' as const,
        id: ToolCallId('late-registry-search'),
        name: 'scholarly_search',
        arguments: JSON.stringify({ query: 'attention', run_in_background: true }),
      },
    ],
    signal: new AbortController().signal,
    agent: {} as never,
  }
}

describe('ScholarlyService follows a late-mounted jobs registry', () => {
  it('refuses an explicit background search before the registry exists, then follows one mounted later', async () => {
    const ctx = await bootScholarlyContext()
    new ScholarlyService(ctx, {
      email: createVolatile('late-registry@example.edu'),
      enableRunInBackground: createVolatile(true),
    })

    // Before the registry mounts on this context the runner sees no jobs
    // service and must refuse the explicit background arm.
    const refused = await ctx.tools.execute(backgroundSearchCall())
    const refusedResult = refused.results[0]?.result
    expect(refusedResult?.isError).toBe(true)
    if (!refusedResult?.isError) throw new Error('background request unexpectedly succeeded')
    expect(refusedResult.error.message).toContain('Background execution is unavailable')

    // The same call after the real registry mounted as `ctx.jobs` reaches
    // it: the runner resolved the service per call.
    const jobs = await composeRealJobs(ctx)
    const served = await ctx.tools.execute(backgroundSearchCall())
    const servedResult = served.results[0]?.result
    expect(servedResult?.isError ?? false).toBe(false)
    expect(servedResult?.content.at(-1)).toMatchObject({
      type: 'text',
      text: expect.stringContaining('started background job'),
    })
    // An unowned job is visible to every caller.
    expect(jobs.registry.list()).toHaveLength(1)
    await jobs.dispose()
  })

  it('promotes a slow search to a background job through the late registry', async () => {
    fetchGate.hold()
    try {
      const ctx = await bootScholarlyContext()
      new ScholarlyService(ctx, {
        email: createVolatile('late-promote@example.edu'),
        enableRunInBackground: createVolatile(false),
        promoteOnTimeout: createVolatile(true),
        foregroundWaitMs: createVolatile(20),
      })
      const jobs = await composeRealJobs(ctx)

      const batch = await ctx.tools.execute({
        calls: [
          {
            type: 'tool-call',
            id: ToolCallId('late-registry-promote'),
            name: 'scholarly_search',
            arguments: JSON.stringify({ query: 'attention' }),
          },
        ],
        signal: new AbortController().signal,
        agent: {} as never,
      })
      const result = batch.results[0]?.result
      expect(result?.isError ?? false).toBe(false)
      expect(result?.content.at(-1)).toMatchObject({
        type: 'text',
        text: expect.stringContaining('operation timed out after 20ms'),
      })

      fetchGate.release()
      const [view] = jobs.registry.list()
      expect(view).toBeDefined()
      expect((await jobs.settled(view!.id)).status).toBe('completed')
      await jobs.dispose()
    } finally {
      fetchGate.release()
    }
  })
})
