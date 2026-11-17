/** An uncooperative producer cannot block unmount or publish through a closed domain. */
import { afterEach, expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ResultDelivery, RESULT_DELIVERY_DRAIN_MS } from '../../src/result-delivery.js'
import { resolveConfig } from '../../src/config.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { resultStorage } from '../helpers/result-storage.js'
import { deferred } from '../helpers/sync.js'

let lane: HostLane | undefined
afterEach(async () => {
  vi.useRealTimers()
  await lane?.teardown()
})

it('bounds an uncooperative producer and refuses its late publication', async () => {
  lane = await setupHostLane()
  const entered = deferred<void>(),
    release = deferred<void>()
  const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const owner = lane.ctx.plugin({
    inject: ['tools'],
    apply(ctx) {
      const delivery = new ResultDelivery(ctx, () => resolveConfig({}), sink)
      ctx.tools.register(
        delivery.wrap(
          defineTool({
            name: 'late_result',
            description: 'A producer that ignores cancellation.',
            parameters: {},
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            execute: async () => {
              entered.resolve()
              await release.promise
              return 'complete'
            },
          }),
        ),
      )
    },
  })
  await owner
  const reading = lane.runTool('late_result', {})
  await entered.promise
  vi.useFakeTimers()
  const disposal = owner.dispose()
  await vi.advanceTimersByTimeAsync(RESULT_DELIVERY_DRAIN_MS)
  await disposal
  expect(sink.warn).toHaveBeenCalledWith(
    'delivery.drain.timeout',
    expect.any(String),
    expect.objectContaining({ pending: 1 }),
  )
  release.resolve()
  expect((await reading).isError).toBe(true)
})

it('includes a slow domain open in the deadline and closes it only after its accepted publication', async () => {
  lane = await setupHostLane()
  const opening = deferred<void>(),
    release = deferred<void>()
  const storage = resultStorage(lane.ctx, async () => {
    opening.resolve()
    await release.promise
  })
  const owner = lane.ctx.plugin({
    inject: ['tools'],
    apply(ctx) {
      const delivery = new ResultDelivery(ctx, () => resolveConfig({}))
      ctx.tools.register(
        delivery.wrap(
          defineTool({
            name: 'slow_receipt',
            description: 'A result with slow external storage.',
            parameters: {},
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            execute: async () => 'x'.repeat(20_000),
          }),
        ),
      )
    },
  })
  await owner
  const reading = lane.runTool('slow_receipt', {})
  await opening.promise
  vi.useFakeTimers()
  const disposal = owner.dispose()
  await vi.advanceTimersByTimeAsync(RESULT_DELIVERY_DRAIN_MS)
  await disposal
  expect(storage.close).not.toHaveBeenCalled()
  release.resolve()
  expect((await reading).isError).toBe(false)
  await Promise.resolve()
  expect(storage.put).toHaveBeenCalledOnce()
  expect(storage.close).toHaveBeenCalledOnce()
})
