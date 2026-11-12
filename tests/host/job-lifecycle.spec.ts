/** Core-owned export and changes jobs stop when the Zotero service unloads. */

import { afterEach, expect, it } from 'vitest'
import { deferred } from '../helpers/sync.ts'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { composeRealJobs, type RealJobs } from '../helpers/real-jobs.ts'

/** The job id a background tool answered with. */
function jobIdOf(result: Awaited<ReturnType<HostLane['runTool']>>): string {
  if (result.isError) throw new Error('the tool refused the background call')
  const value = result.value as { readonly kind?: string; readonly jobId?: string }
  if (value.kind !== 'background' || value.jobId === undefined) {
    throw new Error('the tool did not start a background job')
  }
  return value.jobId
}

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

it('kills a pending export job when the core service is disposed', async () => {
  let jobs!: RealJobs
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        jobs = await composeRealJobs(ctx)
        // The tool call carries the lane's default agent; its session must be
        // live for an owned job to be admitted.
        jobs.agentOf('test-session')
      },
    },
  )
  const started = deferred<void>()
  const release = deferred<void>()
  lane.mock.route('GET', '/api/users/0/items', async (_req, _res, helpers) => {
    started.resolve()
    await release.promise
    return helpers.json([])
  })

  const result = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'citation',
    run_in_background: true,
  })
  expect(result.isError).toBe(false)
  await started.promise

  const jobId = jobIdOf(result)
  await lane.zoteroFiber.dispose()
  const view = await jobs.settled(JobId(jobId), 'test-session')
  expect(view.status).toBe('killed')
  // The registry merges the kill reason it recorded with the producer's own
  // terminal detail; here both name the same cause.
  expect(view.detail).toContain('zotero service disposed')
  release.resolve()
})

it('kills a pending changes job when the core service is disposed', async () => {
  let jobs!: RealJobs
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        jobs = await composeRealJobs(ctx)
        jobs.agentOf('test-session')
      },
    },
  )
  const started = deferred<void>()
  const release = deferred<void>()
  lane.mock.route(
    'GET',
    /^\/api\/users\/0\/items(?:\/top|\/trash)?$/,
    async (_req, _res, helpers) => {
      started.resolve()
      await release.promise
      return helpers.json([], {
        'Last-Modified-Version': '42',
        'Zotero-Server-ID': 'S1',
        'Total-Results': '0',
      })
    },
  )

  const result = await lane.runTool('zotero_changes', { run_in_background: true })
  expect(result.isError).toBe(false)
  await started.promise

  const jobId = jobIdOf(result)
  await lane.zoteroFiber.dispose()
  const view = await jobs.settled(JobId(jobId), 'test-session')
  expect(view.status).toBe('killed')
  // The registry merges the kill reason it recorded with the producer's own
  // terminal detail; here both name the same cause.
  expect(view.detail).toContain('zotero service disposed')
  release.resolve()
})
