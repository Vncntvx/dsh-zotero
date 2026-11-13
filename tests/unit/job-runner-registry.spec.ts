/** Registry ownership for a core-owned job runner, against the real registry. */

import { afterEach, expect, it } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
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
