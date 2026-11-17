/** Both delivery arms evaluate the producer projection once and publish one copy. */
import { afterEach, expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ResultDelivery } from '../../src/result-delivery.js'
import { resolveConfig } from '../../src/config.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { resultStorage } from '../helpers/result-storage.js'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.teardown()
})

it.each(['inline', 'file'] as const)(
  'projects the %s result exactly once',
  async (deliveryKind) => {
    const config = { maxInlineResultTokens: 1000 }
    lane = await setupHostLane(config, {
      compose: async (ctx) => {
        resultStorage(ctx)
      },
    })
    const delivery = new ResultDelivery(lane.ctx, () => resolveConfig(config))
    const project = vi.fn(() => ({ total: 1 }))
    lane.ctx.tools.register(
      delivery.wrap(
        defineTool({
          name: 'projection_probe',
          description: 'Projection evaluation probe',
          parameters: {},
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
            presentationMeta: project,
          },
          execute: async () => (deliveryKind === 'inline' ? 'short' : 'x'.repeat(20_000)),
        }),
      ),
    )
    const result = await lane.runTool('projection_probe', {})
    expect(result.isError).toBe(false)
    expect(project).toHaveBeenCalledTimes(1)
    expect(result.meta).toMatchObject({ total: 1, delivery: deliveryKind })
    expect(result.meta).not.toHaveProperty('facts')
    expect(result.meta).not.toHaveProperty('sessionId')
    expect(result.meta).not.toHaveProperty('callId')
  },
)
