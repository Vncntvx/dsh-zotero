import { serveExportText } from '../helpers/server/export.ts'
/** Durable receipt retention keeps call/job aliases together in publication order. */
import { afterEach, expect, it } from 'vitest'
import { ResultDelivery, resultReceiptKey } from '../../src/result-delivery.js'
import { resolveConfig } from '../../src/config.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { resultStorage } from '../helpers/result-storage.js'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.teardown()
})

it('evicts the oldest delivery on the 129th publication and preserves the complete file', async () => {
  let storage: ReturnType<typeof resultStorage> | undefined
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        storage = resultStorage(ctx)
      },
    },
  )
  serveExportText(lane.mock, 'x'.repeat(20_000))
  for (let index = 0; index < 129; index++) {
    const result = await lane.runTool('zotero_export', {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'ris',
    })
    expect(result.isError).toBe(false)
  }
  expect(storage!.receipts.size).toBe(128)
  expect(storage!.receipts.has(await resultReceiptKey('test-session', 'tool-1'))).toBe(false)
  expect(storage!.receipts.has(await resultReceiptKey('test-session', 'tool-129'))).toBe(true)
  expect(
    [...storage!.files.values()].every(
      (file) => JSON.parse(Buffer.from(file).toString()).data.text.length === 20_000,
    ),
  ).toBe(true)
})

it('orders reopened records by their timestamp and removes both aliases at the global bound', async () => {
  lane = await setupHostLane()
  const storage = resultStorage(lane.ctx)
  const delivery = new ResultDelivery(lane.ctx, () => resolveConfig({}))
  const file = { attachmentId: 'immutable', name: 'result.json', bytes: 20_000 }
  // Hash-key order on disk differs from publication order. Seed newest first.
  for (let index = 1024; index >= 0; index--) {
    const receipt = {
      delivery: 'file',
      version: 1,
      tool: 'zotero_export',
      sessionId: `session-${index}`,
      callId: `call-${index}`,
      jobId: `job-${index}`,
      summary: 'Full result persisted.',
      createdAt: index,
      file,
    }
    storage.receipts.set(`call-${index}`, receipt)
    storage.receipts.set(`job-${index}`, receipt)
  }
  expect(await delivery.pruneReceipts('unrelated-session')).toBe(2)
  expect(storage.receipts.size).toBe(2048)
  expect(storage.receipts.has('call-0')).toBe(false)
  expect(storage.receipts.has('job-0')).toBe(false)
  expect(storage.receipts.has('call-1024')).toBe(true)
})
