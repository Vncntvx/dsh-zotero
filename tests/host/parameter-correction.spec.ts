/**
 * The parameter-correction hint through the real tool pipeline. A rejected
 * call pairs the argument the model sent with the required parameter it
 * missed; the hint reaches read and write tools alike and never issues a
 * request.
 */
import { afterEach, expect, it } from 'vitest'
import { parameterCorrectionHint } from '../../src/parameter-correction.ts'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { item } from '../helpers/server/objects.ts'
import { serveItemGraph } from '../helpers/server/serve.ts'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
})

it('names the rejected argument and the declared parameter for a read tool', async () => {
  lane = await setupHostLane({})
  const before = lane.mock.requests.length
  const result = await lane.runTool('zotero_export', {
    ref: 'zotero://user/0/item/ABCD1234',
    format: 'citation',
  })

  expect(result.isError).toBe(true)
  if (!result.isError) throw new Error('invalid export arguments unexpectedly succeeded')
  expect(result.error.info?.code).toBe('INVALID_ARGS')
  // The pipeline's own message names the missing property; the hint supplies
  // the argument the model sent instead, which the message cannot know.
  expect(result.content[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('missing required property "refs"'),
  })
  expect(result.content.at(-1)).toEqual({
    type: 'text',
    text: parameterCorrectionHint('zotero_export', { input: 'ref', expected: 'refs' }),
  })
  expect(lane.mock.requests).toHaveLength(before)
})

it('names the rejected argument and the declared parameter for a write tool', async () => {
  lane = await setupHostLane({ writeEnabled: true })
  const before = lane.mock.requests.length
  const result = await lane.runTool('zotero_update_item_tags', {
    reff: 'zotero://user/0/item/ABCD1234',
    add: ['review'],
  })

  expect(result.isError).toBe(true)
  if (!result.isError) throw new Error('invalid write arguments unexpectedly succeeded')
  expect(result.error.info?.code).toBe('INVALID_ARGS')
  expect(result.content.at(-1)).toEqual({
    type: 'text',
    text: parameterCorrectionHint('zotero_update_item_tags', {
      input: 'reff',
      expected: 'ref',
    }),
  })
  expect(lane.mock.requests).toHaveLength(before)
})

it('leaves a successful call unchanged', async () => {
  lane = await setupHostLane({})
  serveItemGraph(lane.mock, { parent: item() })
  const result = await lane.runTool('zotero_get', {
    ref: 'zotero://user/0/item/ABCD1234',
  })

  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).not.toContain('[Zotero parameter correction]')
})
