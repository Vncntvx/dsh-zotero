/** Capture real host output once and pin the JSON replayed by browser-only tests. */
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { scholarlySaveReceipt } from '../helpers/scholarly-save-runtime.js'
import { SCHOLARLY_SAVE_STATES, scholarlySaveOutcome } from '../helpers/scholarly-save-outcomes.js'

it('keeps the browser replay identical to all four real pipeline outcomes', async () => {
  const results: Record<string, unknown> = {}
  for (const state of SCHOLARLY_SAVE_STATES) {
    const { result, writes, view } = await scholarlySaveReceipt(scholarlySaveOutcome(state))
    expect(writes).toBe(1)
    expect(view).toBeDefined()
    results[state] = { content: result.content, meta: result.meta }
  }
  const snapshot = JSON.parse(JSON.stringify(results))
  const path = new URL('../fixtures/scholarly-save-receipts.json', import.meta.url)
  if (process.env.DSH_CAPTURE_SCHOLARLY_RECEIPTS === '1')
    writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n')
  expect(snapshot).toEqual(JSON.parse(readFileSync(path, 'utf8')))
})
