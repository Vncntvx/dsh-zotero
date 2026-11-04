/** Result delivery through the real pipeline: inline versus persisted-file publication. */
import { afterEach, expect, it } from 'vitest'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { resultStorage } from '../helpers/result-storage.ts'
import { attachment, item, annotationRow } from '../helpers/server/objects.ts'
import { serveItemGraph } from '../helpers/server/serve.ts'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
})

it('keeps a two-million-character annotation field complete in a single standard file', async () => {
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        resultStorage(ctx)
      },
    },
  )
  const text = '字'.repeat(2_000_000) + 'END'
  serveItemGraph(lane.mock, {
    parent: item(),
    children: [attachment()],
    annotations: [annotationRow({ data: { annotationText: text } })],
  })
  const result = await lane.runTool('zotero_get', {
    ref: 'zotero://user/0/item/ABCD1234',
    include: ['annotations'],
  })
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('get failed')
  expect(result.value).toMatchObject({ delivery: 'file' })
  expect(estimateContent(result.content)).toBeLessThanOrEqual(4000)
  expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(65536)
  expect(JSON.stringify(result.meta).length).toBeLessThan(10_000)
  const block = result.content.find((block) => block.type === 'file')!
  if (block.type !== 'file') throw new Error('missing standard file')
  const chunks = []
  for await (const chunk of lane.ctx.attachments.readFileStream(block.attachment))
    chunks.push(chunk)
  const document = JSON.parse(Buffer.concat(chunks).toString())
  expect(document.data.annotations.items[0].text).toBe(text)
  expect(document.data.annotations.completeness).toBe('complete')
})

it.each(['absent', 'disk', 'index'])('fails explicitly when persistence is %s', async (failure) => {
  lane = await setupHostLane(
    { maxInlineResultTokens: 1000 },
    {
      compose: async (ctx) => {
        if (failure === 'absent') return
        const storage = resultStorage(ctx)
        if (failure === 'disk') storage.save.mockRejectedValue(new Error('ENOSPC'))
        else storage.put.mockRejectedValue(new Error('index write failed'))
      },
    },
  )
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.text('x'.repeat(20_000)),
  )
  const result = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'ris',
  })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).not.toContain('x'.repeat(100))
})

it('also applies the token budget to canonical values hidden by a short renderer', async () => {
  lane = await setupHostLane(
    { maxInlineResultTokens: 1000 },
    {
      compose: async (ctx) => {
        resultStorage(ctx)
      },
    },
  )
  serveItemGraph(lane.mock, { parent: item({ data: { extra: 'x'.repeat(20_000) } }) })
  const result = await lane.runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
  expect(result.isError).toBe(false)
  if (!result.isError) expect(result.value).toMatchObject({ delivery: 'file' })
})
