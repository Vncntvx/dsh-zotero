/**
 * The full write path for a caller cancellation that lands after dispatch.
 *
 * The write may have committed (Zotero consumes single-use keys and commits
 * batches per object regardless of whether the client reads the response),
 * so the model must not see a plain "tool call aborted": the commit-unknown
 * state has to survive as a recorded error result. This spec drives the real
 * tool, approval gate, plan card, domain, and write transport — the same
 * stack the deadline-driven commit-unknown case in `write-tools.spec.ts`
 * exercises, differing only in how the cancellation arrives.
 * @module tests/tools/write/write-abort-commit-unknown
 */

import { afterEach, describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { deferred } from '../../helpers/sync.js'
import { StubApproval } from '../../helpers/approval-stub.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import type { Options } from '../../../src/config.js'
import { WRITE_ABORTED_AFTER_DISPATCH_MESSAGE } from '../../../src/errors.js'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'

const SERVER_ID = 'srv-write-abort-001'

/**
 * The smallest real user-questions seam, identical in shape to the one the
 * sibling write-tool specs carry: answers "Apply" unless scripted otherwise.
 */
class ScriptedQuestions extends Service {
  readonly asks: AskUserQuestionRequest[] = []

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    this.asks.push(request)
    return {
      answers: request.questions.map((question: AskUserQuestionItem) => ({
        id: question.id,
        selected: ['Apply'],
      })),
    }
  }
}

/** The lanes booted in the current test; the module-level afterEach closes them. */
const openLanes: HostLane[] = []

async function bootLane(config: Options): Promise<HostLane> {
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      await ctx.plugin(StubApproval)
      await ctx.plugin(ScriptedQuestions)
    },
  })
  openLanes.push(lane)
  return lane
}

/** The caller literal the lane's own runTool uses; the write gate routes by it. */
const agent = { id: 'test-session', session: { header: { id: 'test-session' } } } as never

describe('a caller cancellation that lands after dispatch', () => {
  afterEach(async () => {
    for (const lane of openLanes.splice(0)) await lane.teardown()
  })

  it('reaches the model as a commit-unknown error result, not a clean cancellation', async () => {
    const lane = await bootLane({ writeEnabled: true })
    lane.mock.route('GET', '/api/', (_req, res, helpers) =>
      helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
    )
    lane.mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID },
        JSON.stringify({ key: 'R'.repeat(32), remember: false }),
      ),
    )
    const dispatched = deferred<void>()
    lane.mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      dispatched.resolve()
      helpers.delayJson({}, 2000)
    })

    const controller = new AbortController()
    const pending = lane.ctx.tools.execute({
      calls: [
        {
          type: 'tool-call' as const,
          id: ToolCallId('abort-after-dispatch'),
          name: 'zotero_create_note',
          arguments: JSON.stringify({ markdown: 'x' }),
        },
      ],
      signal: controller.signal,
      agent,
    })
    await dispatched.promise
    controller.abort()
    const batch = await pending

    const result = batch.results[0]?.result
    expect(result?.isError).toBe(true)
    if (!result?.isError) throw new Error('the aborted create unexpectedly succeeded')
    expect(result.error.info?.name).toBe('ZoteroWriteCommitUnknownError')
    expect(result.error.info?.code).toBe(TOOL_ABORTED)
    expect(result.content.at(-1)).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Do not retry'),
    })
    expect(result.content.at(-1)).toMatchObject({
      type: 'text',
      text: expect.stringContaining(WRITE_ABORTED_AFTER_DISPATCH_MESSAGE.slice(0, 40)),
    })
  })
})
