/**
 * Zotero export and changes retain a single registration throughout job
 * registry and settings changes. Background calls check live availability.
 * @module tests/host/background-parameter
 */

import { afterEach, expect, it } from 'vitest'
import { commitLive, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { composeRealJobs } from '../helpers/real-jobs.ts'

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.teardown()
  lane = undefined
})

const TOOLS = ['zotero_export', 'zotero_changes'] as const

it('retains both definitions through jobs mount, setting edits, and jobs unmount', async () => {
  lane = await setupHostLane()
  const definitions = () => TOOLS.map((name) => lane!.tool(name))
  const initial = definitions()
  const schemas = lane.ctx.tools
    .schemas()
    .filter((schema) => TOOLS.some((name) => name === schema.name))
  expect(schemas).toHaveLength(2)
  for (const schema of schemas)
    expect(schema.parameters.properties).toHaveProperty('run_in_background')
  const changed: ReturnType<typeof definitions>[] = []
  const off = lane.ctx.on('tools/change', () => changed.push(definitions()))

  try {
    const jobs = await composeRealJobs(lane.ctx)
    await commitLive(lane, { enableRunInBackground: false })
    await commitLive(lane, { enableRunInBackground: true })
    await jobs.dispose()
    for (const snapshot of [...changed, definitions()]) {
      expect(snapshot[0]).toBe(initial[0])
      expect(snapshot[1]).toBe(initial[1])
    }
  } finally {
    off()
  }
})
