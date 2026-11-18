import { WRITE_SERVER_ID as SERVER_ID } from '../../helpers/server/keys.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { StubApproval, resetApprovalStub } from '../../helpers/approval-stub.js'
import { expectValue, setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'
import { serveJson } from '../../helpers/server/serve.js'

/**
 * The plan-review channel this lane needs: one answer per ask, always
 * "Apply", with every card's markdown recorded for assertion.
 */
class ApprovingQuestions extends Service {
  readonly asks: AskUserQuestionRequest[] = []

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    this.asks.push(request)
    return {
      answers: request.questions.map((question) => ({
        id: question.id,
        selected: ['Apply'],
      })),
    }
  }
}

const openLanes: HostLane[] = []

async function bootLane(): Promise<HostLane> {
  const lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  openLanes.push(lane)
  return lane
}

/** The plan card the last write was shown, or undefined when nothing asked. */
function lastPlan(lane: HostLane): string {
  const scripted = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
  const ask = scripted.asks.at(-1)
  return ask?.questions[0]?.detail ?? ''
}

/** Identity ping, authorize dialog, and the two-collection listing. */
function serveIdentityAndGrant(mock: MockZotero): void {
  serveJson(mock, '/api/', {}, { 'Zotero-Server-ID': SERVER_ID })
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'R'.repeat(32), remember: true }),
    ),
  )
}

beforeEach(() => {
  resetApprovalStub()
})

afterEach(async () => {
  for (const lane of openLanes) await lane.teardown()
  openLanes.length = 0
})

describe('zotero_delete_library_tags', () => {
  it('states each tag’s item count, then deletes under the library version', async () => {
    const lane = await bootLane()
    serveIdentityAndGrant(lane.mock)
    // The preview listing: tags with their item counts.
    serveJson(
      lane.mock,
      '/api/users/0/items/tags',
      [
        { tag: 'methods', numItems: 7 },
        { tag: 'legacy', numItems: 3 },
      ],
      { 'Last-Modified-Version': '1', 'Total-Results': '2', 'Zotero-Server-ID': SERVER_ID },
    )
    // The library-version read the delete's precondition comes from.
    serveJson(lane.mock, '/api/users/0/items/top', [], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
    })
    serveJson(lane.mock, '/api/users/0/tags', [{ tag: 'methods' }, { tag: 'legacy' }], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
      'Total-Results': '2',
    })
    lane.mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_delete_library_tags', { tags: ['methods', 'legacy'] }),
      'zotero_delete_library_tags',
    )
    expect(result.value).toEqual({
      kind: 'deleted',
      deletedTags: ['legacy', 'methods'],
      libraryVersion: 89,
      serverId: SERVER_ID,
    })
    const plan = lastPlan(lane)
    expect(plan).toContain('- "methods": 7 items')
    expect(plan).toContain('- "legacy": 3 items')
    expect(plan).toContain('cannot be undone')
    const deleted = lane.mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.headers['if-unmodified-since-version']).toBe('88')
    expect(deleted?.search.get('tag')).toBe('methods||legacy')
  })

  it('reports an absent tag as a no-op after an inconclusive preview', async () => {
    const lane = await bootLane()
    serveIdentityAndGrant(lane.mock)
    // The preview listing answers 404, the miss the preview may degrade: the
    // plan reads "unknown items" and the write path still reads a version.
    lane.mock.route('GET', '/api/users/0/items/tags', (_req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    serveJson(lane.mock, '/api/users/0/items/top', [], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
    })
    serveJson(lane.mock, '/api/users/0/tags', [], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
      'Total-Results': '0',
    })
    lane.mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_delete_library_tags', { tags: ['absent'] }),
      'zotero_delete_library_tags',
    )
    expect(result.value).toMatchObject({ kind: 'deleted', deletedTags: [], absentTags: ['absent'] })
    expect(lane.mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
    expect(lastPlan(lane)).toContain('- "absent": unknown items')
  })

  it('refuses the call when the preview listing breaks its protocol shape', async () => {
    const lane = await bootLane()
    serveIdentityAndGrant(lane.mock)
    // A listing without its Total-Results header is a protocol fault, not an
    // inconclusive target: degrading it to "unknown items" would hide a broken
    // response behind a plan card the user is asked to approve.
    serveJson(lane.mock, '/api/users/0/items/tags', [], { 'Zotero-Server-ID': SERVER_ID })
    serveJson(lane.mock, '/api/users/0/items/top', [], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
    })
    const result = await lane.runTool('zotero_delete_library_tags', { tags: ['absent'] })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('ZOTERO_UNEXPECTED')
    // Nothing was deleted and no plan was ever shown.
    expect(lane.mock.requests.filter((request) => request.method === 'DELETE')).toHaveLength(0)
    expect(lastPlan(lane)).toBe('')
  })
})
