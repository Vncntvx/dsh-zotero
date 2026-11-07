/** Result delivery through the real pipeline: inline versus persisted-file publication. */
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
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

it('reopens the receipts domain when the storage facility is replaced', async () => {
  // A storageDomain replacement (its own fiber reloading) must be picked up
  // per call: the delivery caches the opened domain against the facility it
  // came from, so a swapped facility gets a fresh domain instead of a handle
  // to one that was closed with its fiber.
  const attachmentsStub = {
    saveFileStream: async (input: { data: AsyncIterable<Uint8Array> }) => {
      const chunks: Uint8Array[] = []
      for await (const chunk of input.data) chunks.push(chunk)
      const bytes = Buffer.concat(chunks)
      const attachmentId = createHash('sha256').update(bytes).digest('hex')
      return { attachmentId, name: 'result.json', bytes: bytes.length } as FileAttachmentRef
    },
    async *readFileStream(ref: FileAttachmentRef) {
      yield new Uint8Array(0)
    },
  }
  const facilities: Array<{ opened: ReturnType<typeof vi.fn>; receipts: Map<string, unknown> }> = []
  const makeFacility = () => {
    const receipts = new Map<string, unknown>()
    const opened = vi.fn(async () => ({
      table: () => ({
        get: (key: string) => receipts.get(key),
        put: async (key: string, value: unknown) => {
          receipts.set(key, value)
        },
        entries: () => receipts.entries(),
      }),
      close: async () => {},
    }))
    return { opened, receipts, facility: { open: opened } }
  }
  let disposeStorage: (() => Promise<void> | void) | undefined
  lane = await setupHostLane(
    { maxInlineResultTokens: 1000 },
    {
      compose: async (ctx) => {
        ctx.provide('attachments', attachmentsStub as never)
        const first = makeFacility()
        facilities.push(first)
        disposeStorage = ctx.provide('storageDomain', first.facility as never)
      },
    },
  )
  serveItemGraph(lane.mock, { parent: item({ data: { extra: 'x'.repeat(20_000) } }) })
  const first = await lane.runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
  expect(first.isError).toBe(false)
  expect(facilities[0]!.opened).toHaveBeenCalledTimes(1)

  // Replace the facility the way its own fiber would: dispose, then provide.
  await disposeStorage?.()
  const second = makeFacility()
  facilities.push(second)
  lane.ctx.provide('storageDomain', second.facility as never)

  const again = await lane.runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' })
  expect(again.isError).toBe(false)
  expect(facilities[0]!.opened).toHaveBeenCalledTimes(1)
  expect(facilities[1]!.opened).toHaveBeenCalledTimes(1)
  expect([...facilities[1]!.receipts.keys()].length).toBeGreaterThan(0)
})
