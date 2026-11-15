/** Official disk backends reopen receipts and files and export standard FileBlocks. */
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { Storage } from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { streamSessionLogZip } from '@deepseek-ai/dsh-session-log-export'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { ResultDelivery, renderDelivered } from '../../src/result-delivery.ts'
import { readResult } from '../../src/result-route.ts'
import { resolveConfig } from '../../src/config.ts'
let root: string | undefined
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.length = 0
  if (root) await rm(root, { recursive: true, force: true })
})
async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root!, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  return {
    ctx,
    delivery: new ResultDelivery(ctx, () => resolveConfig({ maxInlineResultTokens: 1000 })),
  }
}
it('reopens persisted results after a host restart and streams the same file into a session ZIP', async () => {
  root = await mkdtemp(join(tmpdir(), 'zotero-persist-'))
  const first = await boot()
  const text = '字'.repeat(2000000) + 'END'
  const exec = {
    name: 'zotero_export',
    callId: 'call',
    arguments: { format: 'ris' },
    agent: { session: { header: { id: 'origin' } } },
  } as unknown as ToolExecution
  const receipt = await first.delivery.prepare(
    exec,
    { format: 'ris', text },
    () => [{ type: 'text', text }],
    new AbortController().signal,
    'job',
  )
  expect(receipt.delivery).toBe('file')
  if (receipt.delivery !== 'file') throw new Error('not stored')
  const content = renderDelivered(receipt, () => [])
  const event = {
    type: 'tool/result',
    seq: 2,
    time: 1,
    data: { message: { toolCallId: 'call', content } },
  }
  await first.ctx.fiber.dispose()
  const second = await boot()
  expect(await second.delivery.receipt('origin', 'call')).toEqual(receipt)
  // Fork query already resolved the inherited durable event; neither read needs Zotero.
  second.ctx.provide('sessionQuery', { readEvent: async () => ({ target: event }) } as never)
  const response = await readResult(
    second.ctx,
    second.delivery,
    new Request('http://localhost/api/zotero/result?sessionId=fork&seq=2&index=0'),
  )
  expect(await response.json()).toMatchObject({ data: { text } })
  // Read the official mapped host file through Node and verify a long single-line field.
  const mapped = second.ctx.attachments.fileHostPath(receipt.file as never)!
  const parsed = JSON.parse(await readFile(mapped, 'utf8'))
  expect({ length: parsed.data.text.length, end: parsed.data.text.slice(-3) }).toEqual({
    length: 2000003,
    end: 'END',
  })
  const zip = streamSessionLogZip(
    {
      attachments: second.ctx.attachments,
      sessionQuery: second.ctx.sessionQuery,
      sessionPersistence: {} as never,
      sessions: undefined,
    },
    JSON.stringify(event) + '\n',
    SessionId('origin'),
    false,
    6,
    new AbortController().signal,
  )
  const files = unzipSync(new Uint8Array(await new Response(zip).arrayBuffer()))
  const saved = Object.entries(files).find(([path]) => path.startsWith('files/'))
  expect(saved).toBeDefined()
  expect(JSON.parse(new TextDecoder().decode(saved![1])).data.text).toBe(text)
})

it('reports a vanished result file as 404 and a storage failure as 500', async () => {
  root = await mkdtemp(join(tmpdir(), 'zotero-result-route-'))
  const world = await boot()
  const text = 'x'.repeat(20_000)
  const exec = {
    name: 'zotero_export',
    callId: 'call',
    arguments: { format: 'ris' },
    agent: { session: { header: { id: 'origin' } } },
  } as unknown as ToolExecution
  const receipt = await world.delivery.prepare(
    exec,
    { format: 'ris', text },
    () => [{ type: 'text', text }],
    new AbortController().signal,
    'job',
  )
  if (receipt.delivery !== 'file') throw new Error('not stored')
  const event = {
    type: 'tool/result',
    seq: 2,
    time: 1,
    data: { message: { toolCallId: 'call', content: renderDelivered(receipt, () => []) } },
  }
  const request = () =>
    new Request('http://localhost/api/zotero/result?sessionId=fork&seq=2&index=0')
  const failing = (code: string) => ({
    sessionQuery: { readEvent: async () => ({ target: event }) },
    attachments: {
      readFileStream: () => {
        // A synchronous open failure reaches the route's own catch; a lazy
        // read failure would surface on the response body instead.
        throw Object.assign(new Error(code), { code })
      },
    },
    logger: { warn: vi.fn() },
  })

  // A vanished file is a permanent 404: the client should drop the handle.
  const missing = failing('ENOENT')
  await expect(readResult(missing as never, world.delivery, request())).resolves.toMatchObject({
    status: 404,
  })
  // A permission or storage failure is the server's problem: 500 plus a log
  // line, never "the result no longer exists".
  const denied = failing('EACCES')
  const response = await readResult(denied as never, world.delivery, request())
  expect(response.status).toBe(500)
  expect(denied.logger.warn).toHaveBeenCalledOnce()
})
