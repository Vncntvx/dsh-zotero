/**
 * The write gate lives at the `ctx.zotero` seam, not in a tool.
 *
 * The three write tools are only one door into the write domain; the service
 * method is the other, and a spec that goes through a tool can never show
 * whether the seam itself gates. These cases call `ctx.zotero.createNote`
 * directly, with no tool in the path, and pin the whole settlement map: the
 * plan the user sees is exactly the caller's, a non-approve answer writes
 * nothing and contacts nothing, a missing channel fails closed, a stale
 * `writeConfirm: false` entry cannot opt out of the ask, and the capability
 * gate answers before the plan so a disabled write never bothers the user.
 * @module tests/host/write-gate
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { Options } from '../../src/config.js'
import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
} from '../../src/errors.js'
import type { ZoteroWriteCall } from '../../src/types.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { zoteroError } from '../helpers/provider-harness.js'

const SERVER_ID = 'srv-write-gate-001'
const NEW_KEY = 'GATENOTE'

/** The selected labels per ask, consumed in order; empty means "Apply". */
const script: string[][] = []
/** Every ask the seam made, in order. */
const asks: AskUserQuestionRequest[] = []

/**
 * The smallest user-questions seam the gate can find: answers from a scripted
 * queue and records every ask, so a spec can assert what the user was shown.
 */
class RecordingQuestions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    asks.push(request)
    return {
      answers: request.questions.map((question: AskUserQuestionItem, index: number) => ({
        id: question.id,
        selected: script[index] ?? ['Apply'],
      })),
    }
  }
}

/** Standard write routes: identity probe, authorize dialog, item batch. */
function serveWrites(mock: MockZotero): void {
  mock.route('GET', '/api/', (_req, res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
  )
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'C'.repeat(32), remember: true }),
    ),
  )
  mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '7' },
      JSON.stringify({
        successful: {
          '0': {
            key: NEW_KEY,
            version: 7,
            data: {
              key: NEW_KEY,
              version: 7,
              itemType: 'note',
              note: '<p>x</p>',
              tags: [],
              collections: [],
              relations: { 'dc:relation': [] },
            },
          },
        },
        success: { '0': NEW_KEY },
        unchanged: {},
        failed: {},
      }),
    ),
  )
}

/** The lanes booted in the current test; the module-level afterEach closes them. */
const openLanes: HostLane[] = []

async function bootLane(config: Options, withQuestions = true): Promise<HostLane> {
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      if (withQuestions) await ctx.plugin(RecordingQuestions)
    },
  })
  openLanes.push(lane)
  return lane
}

/** One asking write call, built the way a tool would build it. */
function callOf(plan: string): ZoteroWriteCall {
  return {
    exec: { signal: new AbortController().signal },
    plan,
  }
}

/** The item-batch write requests the mock actually served. */
function itemWrites(mock: MockZotero): readonly { method: string; pathname: string }[] {
  return mock.requests.filter(
    (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
  )
}

beforeEach(() => {
  script.length = 0
  asks.length = 0
})

afterEach(async () => {
  for (const lane of openLanes) await lane.teardown()
  openLanes.length = 0
})

describe('the write gate at the service seam', () => {
  it('asks the caller’s exact plan and writes only after approval', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    const plan = '**Create note**\n- parent: zotero://user/0/item/ITEMABC1\n'
    const result = await lane.ctx.zotero.createNote({ markdown: 'x' }, callOf(plan))

    expect(result).toMatchObject({ kind: 'applied', key: NEW_KEY, libraryVersion: 7 })
    expect(asks).toHaveLength(1)
    expect(asks[0]?.questions[0]?.detail).toBe(plan)
    // The intent carries no `callId` on purpose: the reviewed text is the
    // question's own detail, not a plan document behind a logged call.
    expect(asks[0]?.questions[0]?.intent).toEqual({ kind: 'plan-review', approve: 'Apply' })
    expect(itemWrites(lane.mock)).toHaveLength(1)
  })

  it('writes nothing and contacts nothing when the plan is not approved', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    script[0] = ['Cancel']

    const result = await lane.ctx.zotero.createNote({ markdown: 'x' }, callOf('- plan'))

    expect(result).toEqual({ kind: 'declined' })
    // Declining is settled by the approval channel alone: no identity probe,
    // no authorize dialog, no write.
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('fails closed when no channel can answer', async () => {
    const lane = await bootLane({ writeEnabled: true }, false)
    serveWrites(lane.mock)

    await zoteroError(
      lane.ctx.zotero.createNote({ markdown: 'x' }, callOf('- plan')),
      ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
    )
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('asks on every write, and a stale writeConfirm: false entry cannot opt out', async () => {
    // The confirmation is not configurable: the schema no longer carries the
    // field, so an entry that still spells it is simply ignored and the user
    // is asked as always.
    const legacy = { writeEnabled: true, writeConfirm: false } as unknown as Options
    const lane = await bootLane(legacy)
    serveWrites(lane.mock)

    const result = await lane.ctx.zotero.createNote({ markdown: 'x' }, callOf('- plan'))

    expect(result).toMatchObject({ kind: 'applied', key: NEW_KEY })
    expect(asks).toHaveLength(1)
    expect(itemWrites(lane.mock)).toHaveLength(1)
  })

  it('answers the capability gate before the plan', async () => {
    const lane = await bootLane({})
    serveWrites(lane.mock)

    await zoteroError(
      lane.ctx.zotero.createNote({ markdown: 'x' }, callOf('- plan')),
      ZOTERO_CAPABILITY_UNAVAILABLE,
    )
    // A write that cannot run must never ask the user to approve it.
    expect(asks).toHaveLength(0)
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('gates every write method, not just note creation', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    script[0] = ['Cancel']
    script[1] = ['Cancel']

    const tags = await lane.ctx.zotero.updateTags(
      { item: { library: { type: 'user', id: 0 }, kind: 'item', key: 'ITEMABC1' }, tags: ['a'] },
      callOf('- tags plan'),
    )
    const collections = await lane.ctx.zotero.addToCollection(
      {
        item: { library: { type: 'user', id: 0 }, kind: 'item', key: 'ITEMABC1' },
        collection: 'zotero://user/0/collection/COLL1234',
      },
      callOf('- collection plan'),
    )

    expect(tags).toEqual({ kind: 'declined' })
    expect(collections).toEqual({ kind: 'declined' })
    expect(asks.map((ask) => ask.questions[0]?.detail)).toEqual([
      '- tags plan',
      '- collection plan',
    ])
    expect(lane.mock.requests).toHaveLength(0)
  })
})
