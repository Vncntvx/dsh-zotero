/**
 * The shell-write approval as the harness actually runs it.
 *
 * The unit table proves the rule; this lane proves the wiring and the
 * settlement: the listener is registered on the plugin's own fiber, a detected
 * command raises the harness approval request before the body runs, an
 * `allowed-once` grant runs exactly that one call, a rejection runs nothing, a
 * composition without an approval service fails closed, and a read of the
 * local API is not asked about at all. A stub `bash` stands in for the real
 * executor (the detector keys on the tool name and its command text), and a
 * stub `approval` service answers with a scripted outcome, so the spec owns
 * the decision without mounting the real approval stack.
 * @module tests/host/shell-write-approval
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Options } from '../../src/config.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'

/** The outcome vocabulary the registry routes on. `allowed-once` is the only grant. */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** The request fields this lane inspects; the real seam carries more. */
interface ApprovalAsk {
  readonly toolName?: string
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly zh: string }
}

/** Every command the stub body actually ran. */
const ran: string[] = []
/** Every approval request the seam made, in order. */
const asked: ApprovalAsk[] = []
/** The next outcome the stub approval service answers with. */
let outcome: ApprovalOutcome = 'allowed-once'

/** The three command shapes, built from the lane's own API address. */
const writeOf = (lane: HostLane) =>
  `curl -X POST -d '{"items":[]}' ${lane.mock.baseUrl}/users/0/items`
const readOf = (lane: HostLane) => `curl -s ${lane.mock.baseUrl}/users/0/items?limit=1`
const authorizeOf = (lane: HostLane) =>
  `curl -s -X POST -d '{}' ${lane.mock.baseUrl}/local/authorize`

/** The smallest approval seam the pipeline can find. */
class StubApproval extends Service {
  constructor(ctx: Context) {
    super(ctx, 'approval')
  }

  async request(request: ApprovalAsk): Promise<ApprovalOutcome> {
    asked.push(request)
    return outcome
  }
}

/** The stub shell: records what it ran. */
function stubBash() {
  return defineContentToolFixture({
    name: 'bash',
    description: 'stub shell for the approval lane',
    parameters: { command: { type: 'string', required: true } },
    async execute(args: { command: string }) {
      ran.push(args.command)
      return [{ type: 'text', text: 'ran' }]
    },
  })
}

const openLanes: HostLane[] = []

async function bootLane(config: Options, withApproval = true): Promise<HostLane> {
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      if (withApproval) await ctx.plugin(StubApproval)
      ctx.tools.register(stubBash())
    },
  })
  openLanes.push(lane)
  return lane
}

let callCounter = 0

/**
 * Run one tool call the way an agent loop would: with an agent on the
 * execution. The registry refuses to route an approval ask for a call that has
 * no agent, so the field has to be there; the stub approval never reads it.
 */
function runTool(lane: HostLane, command: string): ReturnType<HostLane['runTool']> {
  return lane.ctx.tools.execute({
    callId: ToolCallId(`shell-approval-${++callCounter}`),
    name: 'bash',
    arguments: { command },
    agent: {} as never,
    signal: new AbortController().signal,
  })
}

beforeEach(() => {
  ran.length = 0
  asked.length = 0
  outcome = 'allowed-once'
})

afterEach(async () => {
  for (const lane of openLanes) await lane.teardown()
  openLanes.length = 0
})

describe('a shell write against the Zotero API', () => {
  it('runs the one call the user confirms', async () => {
    const lane = await bootLane({ writeEnabled: false })
    const result = await runTool(lane, writeOf(lane))

    expect(result.isError).toBe(false)
    expect(ran).toEqual([writeOf(lane)])
    expect(asked).toHaveLength(1)
    // The audit reason names the route; the panel text is the localized one.
    expect(asked[0]?.toolName).toBe('bash')
    expect(asked[0]?.reason).toContain('a write request to the local API address')
    expect(asked[0]?.displayReason?.en).toContain('Allow this command?')
    expect(asked[0]?.displayReason?.zh).toContain('允许这条命令吗')

    // The authorize endpoint is recognized on its path alone, whatever the
    // configured address is: it exists only to hand out a write key.
    await runTool(lane, authorizeOf(lane))
    expect(asked).toHaveLength(2)
    expect(asked[1]?.reason).toContain('authorize endpoint')
  })

  it('does not run when the user rejects the request', async () => {
    const lane = await bootLane({ writeEnabled: false })
    outcome = 'rejected'
    const result = await runTool(lane, writeOf(lane))

    expect(result.isError).toBe(true)
    expect(ran).toEqual([])
    expect(asked).toHaveLength(1)
  })

  it('does not run when the approval is cancelled', async () => {
    const lane = await bootLane({ writeEnabled: false })
    outcome = 'cancelled'
    const result = await runTool(lane, writeOf(lane))

    expect(result.isError).toBe(true)
    expect(ran).toEqual([])
  })

  it('fails closed when no approval channel is composed', async () => {
    const lane = await bootLane({ writeEnabled: false }, false)
    const result = await runTool(lane, writeOf(lane))

    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    // With no channel the registry reports the asker's own reason, which names
    // the reviewed route the model should take instead.
    expect(result.error.message).toContain('change the Zotero library outside the plugin')
    expect(result.error.message).toContain('zotero_create_note')
    expect(ran).toEqual([])
  })

  it('does not ask about a read of the local API, and asks once per write attempt', async () => {
    const lane = await bootLane({ writeEnabled: false })
    const read = await runTool(lane, readOf(lane))
    expect(read.isError).toBe(false)
    expect(ran).toEqual([readOf(lane)])
    expect(asked).toEqual([])

    await runTool(lane, writeOf(lane))
    await runTool(lane, writeOf(lane))
    // Every write attempt is its own decision: one ask per call, never a
    // standing grant.
    expect(asked).toHaveLength(2)
    expect(ran).toHaveLength(3)
  })

  it('stops asking once the plugin fiber is disposed', async () => {
    const lane = await bootLane({ writeEnabled: false })
    await runTool(lane, writeOf(lane))
    expect(asked).toHaveLength(1)

    await lane.zoteroFiber.dispose()
    const after = await runTool(lane, writeOf(lane))

    // The listener is a registration on the plugin's own fiber: unloading the
    // plugin unloads the confirmation with it, and no stale policy is left
    // behind on the tool pipeline.
    expect(asked).toHaveLength(1)
    expect(after.isError).toBe(false)
    expect(ran).toHaveLength(2)
  })

  it('asks the same way while the plugin’s own write tools are enabled', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const result = await runTool(lane, writeOf(lane))

    // The confirmation is not tied to the write capability: a raw library write
    // is confirmed whether or not the plugin's tools are on the surface.
    expect(result.isError).toBe(false)
    expect(asked).toHaveLength(1)
  })
})
