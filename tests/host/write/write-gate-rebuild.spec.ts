/**
 * The write gate outlives a transport rebuild. Serialization is a
 * process-wide invariant of the read-modify-write cycles the write domain
 * performs, so the in-flight gate is owned by the service, not by the write
 * client: a settings commit rebuilds the write client while a write hangs on
 * the wire, and the rebuilt client must wait on the same slot instead of
 * running side by side with the write already in flight.
 *
 * The proof is arrival-order at the mock: the second write's PATCH may reach
 * the wire only after the first one was answered, no matter when the rebuild
 * landed.
 * @module tests/host/write/write-gate-rebuild
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ZoteroWriteCall } from '../../../src/types.js'
import { commitLive, setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import { deferred } from '../../helpers/sync.js'
import { ApprovingQuestions, resetApprovalStub, StubApproval } from '../../helpers/approval-stub.js'
import { SERVER_ID } from '../../helpers/server/keys.js'
import { itemJson } from '../../helpers/write-domain-fixtures.js'

const ITEM_PATH = '/api/users/0/items/ABCD1234'
const ITEM = { library: { type: 'user', id: 0 }, kind: 'item', key: 'ABCD1234' } as const

let lane: HostLane | undefined
let callCounter = 0

beforeEach(() => {
  resetApprovalStub()
})

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

/** One asking write call, built the way a tool would build it. */
function callOf(plan: string): ZoteroWriteCall {
  return {
    exec: {
      signal: new AbortController().signal,
      name: 'zotero_update_item_tags',
      callId: ToolCallId(`write-gate-rebuild-${++callCounter}`),
      agent: {} as never,
    },
    plan,
  }
}

async function boot(): Promise<HostLane> {
  const booted = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  booted.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
  )
  booted.mock.route('POST', '/api/local/authorize', (_req, _res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'C'.repeat(32), remember: true }),
    ),
  )
  booted.mock.route('GET', ITEM_PATH, (_req, _res, helpers) =>
    helpers.json(itemJson('ABCD1234', 4, { tags: ['seed'] }), {
      'Zotero-Server-ID': SERVER_ID,
    }),
  )
  return booted
}

describe('the write gate across a transport rebuild', () => {
  it('serializes writes through one gate while a rebuild swaps the client', async () => {
    lane = await boot()
    const firstPatch = deferred<void>()
    let firstAnswered = false
    /** Whether the mock was serving when each PATCH arrived. */
    const arrivals: boolean[] = []
    lane.mock.route('PATCH', ITEM_PATH, async (_req, _res, helpers) => {
      arrivals.push(firstAnswered)
      if (!firstAnswered) {
        await firstPatch.promise
        firstAnswered = true
      }
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '9' }, '')
    })

    const write1 = lane.ctx.zotero.updateItemTags(
      { item: ITEM, add: ['alpha'] },
      callOf('- add tag alpha'),
    )
    // The first write hangs on the wire with its gate slot held.
    await vi.waitFor(() => expect(arrivals).toHaveLength(1))

    // The rebuild replaces the write client while the first write hangs.
    await commitLive(lane, { timeoutMs: 7000 })

    const write2 = lane.ctx.zotero.updateItemTags(
      { item: ITEM, add: ['beta'] },
      callOf('- add tag beta'),
    )
    firstPatch.resolve()
    const [result1, result2] = await Promise.all([write1, write2])

    // The rebuilt writer's PATCH reached the wire only after the first write
    // was answered: the shared gate serialized them across the rebuild.
    expect(arrivals).toEqual([false, true])
    expect(result1).toMatchObject({ kind: 'applied' })
    expect(result2).toMatchObject({ kind: 'applied' })
    expect(lane.mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(2)
  })
})
