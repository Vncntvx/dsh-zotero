import { expect, it, vi } from 'vitest'
import { resolveConfig } from '../../src/config.ts'
import { ZoteroJobRunner } from '../../src/job-runner.ts'
import { ResultDelivery } from '../../src/result-delivery.ts'
import { fakeExec, OWNER, ownerOf, registryOf } from '../helpers/job-runner-fixtures.js'

it('returns the promoted job ID when publishing its settled result fails', async () => {
  const jobs = await registryOf()
  jobs.agentOf(OWNER)
  vi.spyOn(jobs.registry, 'wait').mockImplementationOnce(async (id) => {
    await jobs.settled(id, OWNER)
    throw new Error('wait failed after the result settled')
  })
  const delivery = new ResultDelivery(jobs.ctx, () => resolveConfig({}))
  const failure = new Error('attachment storage is gone')
  const prepare = vi.spyOn(delivery, 'prepare').mockRejectedValueOnce(failure)
  const warn = vi.fn()
  const runner = new ZoteroJobRunner(
    jobs.registry,
    {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    },
    delivery,
  )

  const result = await runner.waitOrPromote(
    {
      label: 'spec job',
      exec: fakeExec(),
      run: async () => 'done',
    },
    5_000,
  )

  expect(result).toMatchObject({ kind: 'promoted' })
  if (result.kind !== 'promoted') throw new Error('Expected promotion')
  expect(jobs.registry.get(result.jobId, ownerOf(true)).status).toBe('completed')
  expect(prepare).toHaveBeenCalledOnce()
  expect(warn).toHaveBeenCalledWith('job.publish-failed', failure.message, { jobId: result.jobId })
})
