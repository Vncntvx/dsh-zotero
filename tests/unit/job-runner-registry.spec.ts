/** Registry ownership for a core-owned job runner, against the real registry. */

import { afterEach, expect, it, vi } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { ZOTERO_TIMEOUT, ZoteroError } from '../../src/errors.js'
import { ZoteroJobRunner } from '../../src/job-runner.js'
import { mountRealJobs, type RealJobs } from '../helpers/real-jobs.js'

let mounted: RealJobs | undefined

afterEach(async () => {
  await mounted?.dispose()
  mounted = undefined
})

it('follows a jobs registry that becomes available after construction', async () => {
  let registry: JobRegistry | undefined
  const runner = new ZoteroJobRunner(() => registry)
  expect(runner.isAvailable).toBe(false)

  mounted = await mountRealJobs()
  registry = mounted.registry
  expect(runner.isAvailable).toBe(true)
  const { id } = runner.start({
    label: 'late registry job',
    exec: {
      callId: 'late-registry' as never,
      rootCallId: 'late-registry' as never,
      token: 'late-registry' as never,
      name: 'test_tool',
      arguments: {},
      signal: new AbortController().signal,
    },
    // The producer observes its signal, as every real one does; a cancel then
    // settles instead of leaving the registry waiting.
    run: async (signal) =>
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
  })
  runner.killAll('late registry disposed')
  expect((await registry.wait(id, 5_000)).detail).toContain('late registry disposed')
})

it('hands the registry a JobOutcome without the plugin-private error arm', async () => {
  mounted = await mountRealJobs()
  const registry = mounted.registry
  // Intercept the registry seam the runner talks to, and keep the exact
  // `done` outcome the harness receives: the plugin's own error object rides
  // a separate promise, so a harness-side projection of the outcome cannot
  // silently drop it.
  let settledOutcome: Record<string, unknown> | undefined
  const realStart = registry.start.bind(registry)
  const guarded = registry as unknown as { start: JobRegistry['start'] }
  guarded.start = ((spec: Parameters<JobRegistry['start']>[0]) => {
    const run = spec.run
    return realStart({
      ...spec,
      run: (handle: unknown) => {
        const hooks = (run as (h: unknown) => { done: Promise<unknown> })(handle)
        void (hooks.done as Promise<Record<string, unknown>>).then((outcome) => {
          settledOutcome = outcome
        })
        return hooks
      },
    } as never)
  }) as typeof registry.start

  const runner = new ZoteroJobRunner(() => guarded as JobRegistry)
  runner.start({
    label: 'boundary outcome job',
    exec: {
      callId: 'boundary-outcome' as never,
      rootCallId: 'boundary-outcome' as never,
      token: 'boundary-outcome' as never,
      name: 'test_tool',
      arguments: {},
      signal: new AbortController().signal,
    },
    run: async () => {
      throw new ZoteroError('Zotero did not answer in time', ZOTERO_TIMEOUT)
    },
  })
  await vi.waitUntil(() => settledOutcome !== undefined)
  expect(settledOutcome).toMatchObject({ status: 'failed' })
  expect('error' in (settledOutcome as Record<string, unknown>)).toBe(false)
})
