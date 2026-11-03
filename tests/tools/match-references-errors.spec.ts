import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane

beforeEach(async () => {
  lane = await setupHostLane()
})

afterEach(async () => {
  await lane.teardown()
})

describe('zotero_match_references validation', () => {
  it('rejects empty, oversized, duplicate-id, and fingerprint-free input before searching', async () => {
    const cases = [
      { references: [] },
      {
        references: [
          { inputId: 'x', title: 'Paper' },
          { inputId: 'x', title: 'Paper 2' },
        ],
      },
      { references: [{ inputId: 'x' }] },
      {
        references: Array.from({ length: 51 }, (_, index) => ({
          inputId: `r-${index}`,
          doi: `10.1000/${index}`,
        })),
      },
    ]
    for (const args of cases) {
      const result = await lane.runTool('zotero_match_references', args)
      expect(result.isError).toBe(true)
    }
    expect(lane.mock.requests).toEqual([])
  })
})
