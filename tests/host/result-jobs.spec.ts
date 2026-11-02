import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { resultReceiptKey } from '../../src/result-delivery.ts'
/** Owned job_output retains its canonical value and repeats only a bounded file reference. */
import { afterEach, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { TestJobRegistry } from '../helpers/fake-jobs.ts'
import { resultStorage } from '../helpers/result-storage.ts'
let lane: HostLane | undefined
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
})
it('reuses one body across repeated owned job_output calls', async () => {
  let storage: ReturnType<typeof resultStorage> | undefined
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        storage = resultStorage(ctx)
      },
    },
  )
  const jobs = new TestJobRegistry(lane.ctx)
  lane.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
    helpers.text('x'.repeat(20_000)),
  )
  const start = await lane.runTool('zotero_export', {
    refs: ['zotero://user/0/item/ABCD1234'],
    format: 'ris',
    run_in_background: true,
  })
  expect(start.isError).toBe(false)
  const job = [...jobs.jobs.values()][0]!
  expect((await job.hooks.done).status).toBe('completed')
  expect(job.result).not.toContain('x'.repeat(100))
  lane.ctx.tools.register(
    defineTool({
      name: 'job_output',
      description: 'External job consumer',
      parameters: { job_id: { type: 'string', required: true } },
      output: {
        schema: {
          type: 'object',
          properties: { status: { type: 'string', required: true } },
          additionalProperties: false,
        },
        render: () => [{ type: 'text', text: 'completed' }],
      },
      execute: async () => ({ status: 'completed' }),
    }),
  )
  for (let index = 0; index < 2; index++) {
    const pipeline = new ToolExecutionPipeline(lane.ctx)
    const parent = await pipeline.prepare({
      name: 'job_output',
      callId: ToolCallId('parent'),
      arguments: { job_id: 'zotero-1' },
      signal: new AbortController().signal,
    })
    const prepared = await pipeline.prepare({
      name: 'job_output',
      callId: ToolCallId(`output-${index}`),
      arguments: { job_id: 'zotero-1' },
      signal: new AbortController().signal,
      agent: { id: 'test-session', session: { header: { id: 'test-session' } } } as never,
      ...(index === 1 ? { parent: parent.exec.token } : {}),
    })
    if (prepared.kind !== 'dispatch') throw new Error('prepare failed')
    const result = await pipeline.complete(prepared.exec, await pipeline.dispatch(prepared.exec))
    if (index === 1) expect(result.additionalContexts?.[0]?.source).toEqual({ kind: 'ptc-mode' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('job output failed')
    expect(result.value).toEqual({ status: 'completed' })
    expect(result.content.filter((block) => block.type === 'file')).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100))
  }
  expect(storage!.save).toHaveBeenCalledOnce()
  expect([...storage!.receipts.keys()]).toContain(
    await resultReceiptKey('job', 'test-session', 'zotero-1'),
  )
})
it('does not rewrite another plugin’s job output', async () => {
  lane = await setupHostLane()
  const jobs = new TestJobRegistry(lane.ctx)
  const id = jobs.start({
    kind: 'bash',
    owner: 'test-session' as never,
    label: 'other',
    run: () => ({ done: Promise.resolve({ status: 'completed' }), cancel: () => {} }),
  })
  await jobs.jobs.get(id)!.hooks.done
  lane.ctx.tools.register(
    defineTool({
      name: 'job_output',
      description: 'External job consumer',
      parameters: { job_id: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'other' }] },
      execute: async () => 'other',
    }),
  )
  const result = await lane.runTool('job_output', { job_id: id })
  expect(result.content).toEqual([{ type: 'text', text: 'other' }])
})
