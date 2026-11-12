/** Nested calls and result policy use the standard pipeline, with bounded values. */
import { afterEach, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { ResultDelivery, jsonBytes } from '../../src/result-delivery.ts'
import { resolveConfig } from '../../src/config.ts'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { resultStorage } from '../helpers/result-storage.ts'
import { deferred } from '../helpers/sync.ts'
let lane: HostLane | undefined
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
})
it('forwards a standard file context on nested PTC dispatch without copying the body', async () => {
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        resultStorage(ctx)
      },
    },
  )
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.text('x'.repeat(20000)),
  )
  const pipeline = new ToolExecutionPipeline(lane.ctx)
  const parent = await pipeline.prepare({
    callId: ToolCallId('parent'),
    name: 'zotero_export',
    arguments: { refs: ['zotero://user/0/item/ABCD1234'], format: 'ris' },
    signal: new AbortController().signal,
  })
  const input: ToolExecutionInput = {
    callId: ToolCallId('nested'),
    name: 'zotero_export',
    arguments: { refs: ['zotero://user/0/item/ABCD1234'], format: 'ris' },
    signal: new AbortController().signal,
    parent: parent.exec.token,
    agent: { id: 's', session: { header: { id: 's' } } } as never,
  }
  const prepared = await pipeline.prepare(input)
  if (prepared.kind !== 'dispatch') throw new Error('nested prepare failed')
  const result = await pipeline.complete(prepared.exec, await pipeline.dispatch(prepared.exec))
  expect(result.isError).toBe(false)
  expect(result.additionalContexts?.[0]?.source).toEqual({ kind: 'ptc-mode' })
  expect(result.additionalContexts?.[0]?.content.some((block) => block.type === 'file')).toBe(true)
  expect(JSON.stringify(result)).not.toContain('x'.repeat(100))
})
it('rejects malformed producer values before any file is published', async () => {
  lane = await setupHostLane()
  const delivery = new ResultDelivery(lane.ctx, () => resolveConfig({}))
  const definition = defineTool({
    name: 'result_probe',
    description: 'External producer',
    parameters: {},
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async () => 42 as never,
  })
  lane.ctx.tools.register(delivery.wrap(definition))
  const result = await lane.runTool('result_probe', {})
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('returned invalid output')
})
it('does not publish a file handle that itself exceeds the configured budget', async () => {
  lane = await setupHostLane(
    { maxInlineResultBytes: 1 },
    {
      compose: async (ctx) => {
        resultStorage(ctx)
      },
    },
  )
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) => helpers.text('body'))
  const result = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'ris',
  })
  expect(result.isError).toBe(true)
  expect(result.content.some((block) => block.type === 'file')).toBe(false)
})
it('waits for a pending publication during teardown instead of aborting it', async () => {
  lane = await setupHostLane()
  const storage = resultStorage(lane.ctx)
  const started = deferred<void>(),
    release = deferred<void>()
  const put = storage.put.getMockImplementation()!
  storage.put.mockImplementation(async (...args) => {
    started.resolve()
    await release.promise
    return put(...args)
  })
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.text('x'.repeat(20000)),
  )
  const reading = lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'ris',
  })
  await started.promise
  const disposal = lane.zoteroFiber.dispose()
  release.resolve()
  expect((await reading).isError).toBe(false)
  await disposal
})
it('stream-encodes surrogate pairs, escaped characters, arrays and optional fields without loss', async () => {
  const data = {
    value: 'a'.repeat(4095) + '😀"\n尾',
    array: [null, true, undefined],
    missing: undefined,
  }
  const chunks = []
  for await (const chunk of jsonBytes(data)) chunks.push(chunk)
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({
    value: data.value,
    array: [null, true, null],
  })
})

it('fails on a missing domain service and allows a failed domain open to be retried', async () => {
  lane = await setupHostLane()
  const placeholder = lane.ctx.plugin({
    apply(ctx) {
      ctx.provide('attachments', {} as never)
    },
  })
  await placeholder
  const delivery = new ResultDelivery(lane.ctx, () => resolveConfig({ maxInlineResultBytes: 1000 }))
  const exec = {
    name: 'zotero_get',
    callId: 'call',
    arguments: {},
    agent: { session: { header: { id: 's' } } },
  } as unknown as import('@deepseek-ai/dsh-tools').ToolExecution
  const data = { text: 'x'.repeat(20000) }
  await expect(
    delivery.prepare(exec, data, () => [], new AbortController().signal),
  ).rejects.toThrow('storageDomain')
  await placeholder.dispose()
  const storage = resultStorage(lane.ctx)
  const open = lane.ctx.storageDomain.open
  lane.ctx.storageDomain.open = async () => {
    throw new Error('domain unavailable')
  }
  await expect(
    delivery.prepare(exec, data, () => [], new AbortController().signal),
  ).rejects.toThrow('domain unavailable')
  lane.ctx.storageDomain.open = open
  expect(await delivery.prepare(exec, data, () => [], new AbortController().signal)).toMatchObject({
    delivery: 'file',
  })
  expect(storage.save).toHaveBeenCalledOnce()
})
it('completes the receipt write once the file is stored, even when cancelled after storing', async () => {
  lane = await setupHostLane()
  const storage = resultStorage(lane.ctx),
    controller = new AbortController()
  const save = storage.save.getMockImplementation()!
  storage.save.mockImplementation(async (input) => {
    const file = await save(input)
    controller.abort(new Error('cancelled publication'))
    return file
  })
  const delivery = new ResultDelivery(lane.ctx, () => resolveConfig({}))
  const exec = {
    name: 'zotero_get',
    callId: 'cancel',
    arguments: {},
    agent: { session: { header: { id: 's' } } },
  } as unknown as import('@deepseek-ai/dsh-tools').ToolExecution
  // Once the file is published the attachment store cannot reclaim it, so the
  // receipt — the file's only reference — must land regardless of the abort.
  // The caller still observes its own cancellation through the tool pipeline;
  // the durable record must not depend on that race.
  const receipt = await delivery.prepare(
    exec,
    { text: 'x'.repeat(20000) },
    () => [],
    controller.signal,
  )
  expect(receipt).toMatchObject({ delivery: 'file' })
  expect(storage.put).toHaveBeenCalledTimes(1)
  expect(controller.signal.aborted).toBe(true)
})
