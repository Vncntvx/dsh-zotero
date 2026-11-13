/**
 * The literature trail reads an inline export's body from the delivered
 * result, not from a `meta.text` the bounded projector stopped carrying.
 * @module tests/host/source-ledger-export-delivery
 */

import { afterEach, expect, it } from 'vitest'
import { buildSourceWorkspace } from '../../src/sources/ledger.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { citationRow } from '../helpers/server/objects.ts'
import { settledBlock } from './support/source-ledger-arms.js'

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.teardown()
  lane = undefined
})

it('folds the inline delivery shape without a meta.text body', async () => {
  lane = await setupHostLane()
  lane.mock.route('GET', '/api/users/0/items', (_req, res, helpers) =>
    helpers.json([citationRow('ABCD1234', '<span>A, 2023</span>')]),
  )
  const result = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'citation',
  })
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('export failed')
  // The delivery wrapper states the shape and never adds the rendered body.
  expect(result.meta).toMatchObject({ delivery: 'inline' })
  expect(
    typeof result.meta === 'object' &&
      result.meta !== null &&
      Object.prototype.hasOwnProperty.call(result.meta, 'text'),
  ).toBe(false)

  const block = settledBlock(
    'e1',
    'zotero_export',
    {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation',
    },
    result.meta,
    1,
    result.content,
  )
  const workspace = buildSourceWorkspace([block])
  expect(workspace.exports).toHaveLength(1)
  expect(workspace.exports[0]?.text).toBe('zotero://user/0/item/ABCD1234: <span>A, 2023</span>')
  expect(workspace.sources[0]?.exports).toHaveLength(1)
})
