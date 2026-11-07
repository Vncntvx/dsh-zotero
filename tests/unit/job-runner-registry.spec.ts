/** Registry ownership for a core-owned job runner. */

import { expect, it } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { ZoteroJobRunner } from '../../src/job-runner.js'
import { TestJobRegistry } from '../helpers/fake-jobs.js'

it('follows a jobs registry that becomes available after construction', async () => {
  let registry: TestJobRegistry | undefined
  const runner = new ZoteroJobRunner(() => registry as unknown as JobRegistry | undefined)
  expect(runner.isAvailable).toBe(false)

  registry = new TestJobRegistry()
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
    run: async () => await new Promise<never>(() => {}),
  })
  runner.killAll('late registry disposed')
  expect(registry.jobs.get(id)?.detail).toBe('late registry disposed')
})
