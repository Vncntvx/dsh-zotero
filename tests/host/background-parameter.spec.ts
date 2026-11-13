/**
 * `zotero_export` and `zotero_changes` advertise `run_in_background` exactly
 * while a job registry is mounted and the deployment switch is on. The same
 * `registerBackgroundAware` helper serves the scholarly component; its live
 * switch flip is covered in `tests/scholarly/service-background-parameter`.
 * @module tests/host/background-parameter
 */

import { afterEach, expect, it } from 'vitest'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { composeRealJobs } from '../helpers/real-jobs.ts'

let lane: HostLane | undefined
let disposeJobs: (() => Promise<void>) | undefined

afterEach(async () => {
  await disposeJobs?.()
  disposeJobs = undefined
  await lane?.teardown()
  lane = undefined
})

const TOOLS = ['zotero_export', 'zotero_changes'] as const

function declared(lane: HostLane): boolean[] {
  const schemas = lane.ctx.tools.schemas()
  return TOOLS.map((name) =>
    JSON.stringify(schemas.find((schema) => schema.name === name) ?? {}).includes(
      'run_in_background',
    ),
  )
}

it('follows the mounted job registry and returns the foreground arm on unload', async () => {
  lane = await setupHostLane()
  expect(declared(lane)).toEqual([false, false])

  const jobs = await composeRealJobs(lane.ctx)
  expect(declared(lane)).toEqual([true, true])

  // The registry unloading must degrade, not remove the tools.
  await jobs.fiber?.dispose()
  expect(declared(lane)).toEqual([false, false])
  expect(lane.ctx.tools.schemas().map((schema) => schema.name)).toEqual(
    expect.arrayContaining([...TOOLS]),
  )
})

it('never declares the parameter while the deployment switch is off', async () => {
  lane = await setupHostLane({ enableRunInBackground: false })
  const jobs = await composeRealJobs(lane.ctx)
  disposeJobs = jobs.dispose
  expect(declared(lane)).toEqual([false, false])
})
