/** A result is addressable by a recorded event, never a client-supplied file ID. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { readResult } from '../../src/result-route.ts'
import {
  ResultDelivery,
  jsonBytes,
  renderDelivered,
  resultReceiptKey,
} from '../../src/result-delivery.ts'
import { resolveConfig } from '../../src/config.ts'
import { resultStorage } from '../helpers/result-storage.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})
async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  const storage = resultStorage(ctx)
  const file = await ctx.attachments.saveFileStream({
    name: 'result.json',
    data: jsonBytes({
      version: 1,
      tool: 'zotero_export',
      data: { format: 'csv', text: '\ufeff"标题","a,b"\n"多行\n末尾",尾\n' },
    }),
  })
  const receipt = {
    delivery: 'file' as const,
    version: 1 as const,
    tool: 'zotero_export',
    sessionId: 'original',
    callId: 'call',
    summary: 'Stored',
    file,
  }
  const content = renderDelivered(receipt, () => [])
  const readEvent = vi.fn(async () => ({
    target: { type: 'tool/result', data: { message: { content, toolCallId: 'call' } } },
  }))
  ctx.provide('sessionQuery', { readEvent } as never)
  const delivery = new ResultDelivery(ctx, () => resolveConfig({}))
  const request = (query = 'sessionId=fork&seq=2&index=0') =>
    new Request(`http://localhost/api/zotero/result?${query}`)
  return { ctx, storage, file, readEvent, delivery, request }
}
it('reads a replayed or forked event without requesting Zotero or a running job', async () => {
  const { ctx, delivery, request, readEvent } = await setup()
  const response = await readResult(ctx, delivery, request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    data: { text: '\ufeff"标题","a,b"\n"多行\n末尾",尾\n' },
  })
  expect(response.status).toBe(200)
  expect(readEvent).toHaveBeenCalledWith(
    { sessionId: 'fork', seq: 2, before: 0, after: 0 },
    expect.any(AbortSignal),
  )
})
it.each([
  'sessionId=s&seq=&index=0',
  'sessionId=s&seq=-1&index=0',
  'sessionId=s&seq=2&index=1.5',
  'sessionId=s&seq=2',
  'seq=2&index=0',
])('rejects malformed coordinates %s before reading', async (query) => {
  const { ctx, delivery, request, readEvent } = await setup()
  expect((await readResult(ctx, delivery, request(query))).status).toBe(400)
  expect(readEvent).not.toHaveBeenCalled()
})
it('does not accept arbitrary references or unrelated recorded files', async () => {
  const { ctx, delivery, request, readEvent, file } = await setup()
  readEvent.mockResolvedValue({
    target: {
      type: 'tool/result',
      data: { message: { content: [{ type: 'file', attachment: file }], toolCallId: 'call' } },
    },
  } as never)
  expect((await readResult(ctx, delivery, request())).status).toBe(404)
})
it.each(['digest', 'length'])('fails the body read on %s corruption', async (failure) => {
  const { ctx, storage, file, delivery, request } = await setup()
  const bytes = storage.files.get(file.attachmentId)!
  storage.files.set(
    file.attachmentId,
    failure === 'length' ? bytes.slice(1) : new Uint8Array(bytes.length),
  )
  const response = await readResult(ctx, delivery, request())
  await expect(response.json()).rejects.toThrow('Corrupt result file')
})
it('reads the persisted receipt of an original background acknowledgement', async () => {
  const { ctx, storage, file, readEvent, delivery, request } = await setup()
  storage.receipts.set(await resultReceiptKey('original', 'call'), {
    delivery: 'file',
    version: 1,
    tool: 'zotero_export',
    sessionId: 'original',
    callId: 'call',
    jobId: 'job',
    summary: 'Stored',
    file,
  })
  readEvent.mockResolvedValue({
    target: {
      type: 'tool/result',
      data: {
        message: { toolCallId: 'call', content: [] },
        meta: { kind: 'background', jobId: 'job', resultSessionId: 'original' },
      },
    },
  } as never)
  expect(await (await readResult(ctx, delivery, request())).json()).toMatchObject({
    data: { format: 'csv' },
  })
})
it('reports missing events as unavailable and propagates cancellation', async () => {
  const { ctx, readEvent, delivery, request } = await setup()
  readEvent.mockRejectedValue(new Error('not found'))
  expect((await readResult(ctx, delivery, request())).status).toBe(404)
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(
    readResult(ctx, delivery, new Request(request(), { signal: controller.signal })),
  ).rejects.toThrow('cancelled')
})

it('mounts the exact route through the official owner-only Connection registry', async () => {
  const { HostConnectionService, Peer } = await import('@deepseek-ai/dsh-client-connection')
  const { registerResultRoute } = await import('../../src/result-route.ts')
  const { ctx, delivery, request, readEvent } = await setup()
  // Authentication itself belongs to Connection; this test starts with admitted peers.
  const connection = new HostConnectionService(ctx, [], {} as never)
  const owner = ctx.plugin({
    name: 'result-endpoint-test',
    apply(child) {
      registerResultRoute(child, delivery)
    },
  })
  await owner
  const handler = connection.createSharedFetchHandler('/api')
  const response = await handler.fetch(request(), connection.browserPeer)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: { format: 'csv' } })
  const guest = new Peer(ctx, { principal: { kind: 'extension', id: 'guest' } as never })
  expect((await handler.fetch(request(), guest)).status).toBe(403)
  expect(readEvent).toHaveBeenCalledTimes(1)
  await owner.dispose()
  expect((await handler.fetch(request(), connection.browserPeer)).status).toBe(404)
})
it('cancels the attachment stream when the response consumer stops', async () => {
  const { ctx, delivery, request } = await setup()
  const ended = vi.fn()
  ctx.attachments.readFileStream = async function* () {
    try {
      yield new Uint8Array([123])
      yield new Uint8Array([125])
    } finally {
      ended()
    }
  }
  const response = await readResult(ctx, delivery, request())
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
  expect(ended).toHaveBeenCalledTimes(1)
})
