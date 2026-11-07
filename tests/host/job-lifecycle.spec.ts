/** Core-owned export and changes jobs stop when the Zotero service unloads. */

import { afterEach, expect, it } from 'vitest'
import { deferred } from '../helpers/sync.ts'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { TestJobRegistry } from '../helpers/fake-jobs.ts'

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

it('kills a pending export job when the core service is disposed', async () => {
  let jobs!: TestJobRegistry
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        jobs = new TestJobRegistry(ctx)
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

  const job = jobs.jobs.get('zotero-1' as never)
  expect(job).toBeDefined()
  await lane.zoteroFiber.dispose()
  expect((await job!.hooks.done).status).toBe('killed')
  expect(job!.detail).toBe('zotero service disposed')
  release.resolve()
})

it('kills a pending changes job when the core service is disposed', async () => {
  let jobs!: TestJobRegistry
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        jobs = new TestJobRegistry(ctx)
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

  const job = jobs.jobs.get('zotero-1' as never)
  expect(job).toBeDefined()
  await lane.zoteroFiber.dispose()
  expect((await job!.hooks.done).status).toBe('killed')
  expect(job!.detail).toBe('zotero service disposed')
  release.resolve()
})
