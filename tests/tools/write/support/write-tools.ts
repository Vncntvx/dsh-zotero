import { WRITE_SERVER_ID as SERVER_ID } from '../../../helpers/server/keys.js'
import { afterEach, beforeEach } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { StubApproval } from '../../../helpers/approval-stub.js'
import { setupHostLane, type HostLane } from '../../../helpers/lanes/host-lane.js'
import { MockZotero } from '../../../helpers/mock-zotero.js'
import { serveItemRead } from '../../../helpers/write-domain-fixtures.js'
import type { Options } from '../../../../src/config.js'

export const NEW_KEY = 'NEWNOTE1'
export const COLLECTION_KEY = 'COLL1234'

/**
 * The smallest real user-questions seam: answers from a scripted queue, one
 * answer per question, recording every ask so specs can assert the plan the
 * user was shown.
 */
export class ScriptedQuestions extends Service {
  /** The selected labels per ask, consumed in order; empty means "Apply". */
  static readonly script: string[][] = []
  /** When set, the next ask rejects with this error (one-shot). */
  static rejection: UserQuestionError | undefined
  /** When set, returns this raw answer response directly. */
  static customAnswers: AskUserQuestionAnswer | undefined
  readonly asks: AskUserQuestionRequest[] = []

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    this.asks.push(request)
    const rejection = ScriptedQuestions.rejection
    if (rejection !== undefined) {
      ScriptedQuestions.rejection = undefined
      throw rejection
    }
    if (ScriptedQuestions.customAnswers !== undefined) {
      const answers = ScriptedQuestions.customAnswers
      ScriptedQuestions.customAnswers = undefined
      return answers
    }
    const answers = ScriptedQuestions.script
    return {
      answers: request.questions.map((question: AskUserQuestionItem, index: number) => ({
        id: question.id,
        selected: answers[index] ?? ['Apply'],
      })),
    }
  }
}

/** The lanes booted in the current test; the module-level afterEach closes them. */
const openLanes: HostLane[] = []

export async function bootLane(config: Options, withQuestions = true): Promise<HostLane> {
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      // The approval gate fails closed without a composed service, so the
      // write-path lanes carry this one-shot approver.
      await ctx.plugin(StubApproval)
      if (withQuestions) await ctx.plugin(ScriptedQuestions)
    },
  })
  openLanes.push(lane)
  return lane
}

/** Standard Local API routes: identity ping, authorize dialog, collections listing, item batch. */
export function serveWrites(mock: MockZotero): void {
  mock.route('GET', '/api/', (_req, res, helpers) =>
    helpers.raw(200, { 'Zotero-Server-ID': SERVER_ID }, JSON.stringify({})),
  )
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'R'.repeat(32), remember: true }),
    ),
  )
  mock.route('GET', '/api/users/0/collections', (_req, res, helpers) =>
    helpers.json(
      [{ key: COLLECTION_KEY, version: 3, data: { key: COLLECTION_KEY, name: '方法论' } }],
      { 'Last-Modified-Version': '7' },
    ),
  )
  mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
    const entry = JSON.parse(mock.requests[mock.requests.length - 1]?.body ?? '[]')[0] as Record<
      string,
      unknown
    >
    return helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '42' },
      JSON.stringify({
        successful: {
          '0': {
            key: NEW_KEY,
            version: 42,
            data: {
              key: NEW_KEY,
              version: 42,
              itemType: 'note',
              note: entry.note,
              ...(entry.parentItem === undefined ? {} : { parentItem: entry.parentItem }),
              tags: entry.tags ?? [],
              collections: entry.collections ?? [],
              relations: entry.relations ?? { 'dc:relation': [] },
            },
          },
        },
        success: { '0': NEW_KEY },
        unchanged: {},
        failed: {},
      }),
    )
  })
}

beforeEach(() => {
  ScriptedQuestions.script.length = 0
  ScriptedQuestions.rejection = undefined
})

afterEach(async () => {
  for (const lane of openLanes) await lane.teardown()
  openLanes.length = 0
})

export function serveItem(mock: MockZotero, data: Record<string, unknown>): void {
  serveItemRead(mock, { data, serverId: SERVER_ID })
}
