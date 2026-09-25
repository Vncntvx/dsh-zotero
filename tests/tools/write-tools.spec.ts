import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import type { Options } from '../../src/config.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
} from '../../src/errors.js'
import { WRITE_PLAN_QUESTION_ID } from '../../src/tools/write-approval.js'

const SERVER_ID = 'srv-write-tools-001'
const NEW_KEY = 'NEWNOTE1'
const COLLECTION_KEY = 'COLL1234'
const ITEM_KEY = 'ITEMABC1'

/**
 * The smallest real user-questions seam: answers from a scripted queue, one
 * answer per question, recording every ask so specs can assert the plan the
 * user was shown.
 */
class ScriptedQuestions extends Service {
  /** The selected labels per ask, consumed in order; empty means "Apply". */
  static readonly script: string[][] = []
  /** When set, the next ask rejects with this error (one-shot). */
  static rejection: { code: string; message: string } | undefined
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
      const error = new Error(rejection.message) as Error & { code: string; name: string }
      error.name = 'UserQuestionError'
      error.code = rejection.code
      throw error
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

async function bootLane(config: Options, withQuestions = true): Promise<HostLane> {
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      if (withQuestions) await ctx.plugin(ScriptedQuestions)
    },
  })
  openLanes.push(lane)
  return lane
}

/** Standard Local API routes: identity ping, authorize dialog, collections listing, item batch. */
function serveWrites(mock: MockZotero): void {
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
    helpers.json([
      { key: COLLECTION_KEY, version: 3, data: { key: COLLECTION_KEY, name: '方法论' } },
    ]),
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
              note: '<p>x</p>',
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

describe('registration gating', () => {
  it('keeps the write tools off the surface until writeEnabled is set', async () => {
    const off = await bootLane({})
    expect(off.tool('zotero_create_note')).toBeUndefined()
    expect(off.tool('zotero_add_tags')).toBeUndefined()
    expect(off.tool('zotero_add_to_collection')).toBeUndefined()
    await off.teardown()
    const on = await bootLane({ writeEnabled: true })
    expect(on.tool('zotero_create_note')?.name).toBe('zotero_create_note')
    expect(on.tool('zotero_add_tags')?.name).toBe('zotero_add_tags')
    expect(on.tool('zotero_add_to_collection')?.name).toBe('zotero_add_to_collection')
    await on.teardown()
  })
})

describe('zotero_create_note', () => {
  it('shows the plan card, applies on approval, and returns the created note', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: '**方法**笔记' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      key: NEW_KEY,
      version: 42,
      libraryVersion: 42,
    })
    expect(scripted.asks).toHaveLength(1)
    const [ask] = scripted.asks
    expect(ask.questions[0]?.intent).toEqual({
      kind: 'plan-review',
      approve: 'Apply',
      callId: expect.any(String),
    })
    expect(ask.questions[0]?.detail).toContain('**方法**笔记')
    expect(ask.questions[0]?.detail).toContain('zotero://user/0')
    const post = lane.mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
    )
    expect(post).toBeDefined()
    expect(JSON.parse(post?.body ?? '{}')[0]).toMatchObject({
      itemType: 'note',
      note: '<p><strong>方法</strong>笔记</p>',
    })
  })

  it('returns a non-retryable committed-unverified result for a committed note', async () => {
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
    lane.mock.route('POST', '/api/users/0/items', (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '42' },
        JSON.stringify({
          successful: { '0': { key: NEW_KEY, version: 42 } },
          success: { '0': NEW_KEY },
          unchanged: {},
          failed: {},
        }),
      ),
    )
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      key: NEW_KEY,
      version: 42,
    })
  })

  it('returns a non-retryable commit-unknown result when the response drops', async () => {
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
    lane.mock.route('POST', '/api/users/0/items', (_req, res) => {
      res.destroy()
    })
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
    })
    expect(result.value).not.toHaveProperty('libraryVersion')
  })

  it('writes nothing when the user declines the plan', async () => {
    const lane = await bootLane({ writeEnabled: true })
    ScriptedQuestions.script.push(['Cancel'])
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('fails closed when no approval channel can answer', async () => {
    const lane = await bootLane({ writeEnabled: true }, false)
    serveWrites(lane.mock)
    const result = await lane.runTool('zotero_create_note', { markdown: 'x' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_WRITE_APPROVAL_UNAVAILABLE)
    expect(result.error.message).toBe(WRITE_APPROVAL_UNAVAILABLE_MESSAGE)
    // Mid-body throws map to `{ name, code }` only; reason is deny-path only.
    expect(result.error.info?.reason).toBeUndefined()
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('returns declined when the user dismisses the plan review (ASK_CANCELLED)', async () => {
    const lane = await bootLane({ writeEnabled: true })
    ScriptedQuestions.rejection = {
      code: 'ASK_CANCELLED',
      message: 'the user cancelled ask_user_question',
    }
    // Wire restoration surfaces UserQuestionError (a HarnessError) with this code.
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('skips the plan card when writeConfirm is off', async () => {
    const lane = await bootLane({ writeEnabled: true, writeConfirm: false })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({ kind: 'applied', key: NEW_KEY })
    expect(scripted.asks).toHaveLength(0)
  })

  it('refuses non-empty collections on a child note before the plan card', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const result = await lane.runTool('zotero_create_note', {
      markdown: 'x',
      parentItem: `zotero://user/0/item/${ITEM_KEY}`,
      collections: ['方法论'],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(result.error.message).toBe(WRITE_CHILD_COLLECTIONS_MESSAGE)
    expect(scripted.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('treats empty collections on a child note as inherit, not as a write of collections', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', {
        markdown: 'child body',
        parentItem: `zotero://user/0/item/${ITEM_KEY}`,
        collections: [],
      }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({ kind: 'applied', key: NEW_KEY })
    expect(scripted.asks).toHaveLength(1)
    expect(scripted.asks[0]?.questions[0]?.detail).toContain('(inherited from parent item)')
    const post = lane.mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
    )
    expect(post).toBeDefined()
    const entry = JSON.parse(post?.body ?? '{}')[0] as Record<string, unknown>
    expect(entry.parentItem).toBe(ITEM_KEY)
    expect(entry.collections).toBeUndefined()
  })

  it('writes standalone collections after the plan, resolving names to keys', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const standalone = expectValue(
      await lane.runTool('zotero_create_note', {
        markdown: 'standalone',
        collections: ['方法论'],
      }),
      'zotero_create_note',
    )
    expect(standalone.value).toMatchObject({ kind: 'applied', key: NEW_KEY })
    expect(scripted.asks).toHaveLength(1)
    expect(scripted.asks[0]?.questions[0]?.detail).toContain('方法论')
    const post = lane.mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
    )
    const entry = JSON.parse(post?.body ?? '{}')[0] as Record<string, unknown>
    expect(entry.collections).toEqual([COLLECTION_KEY])
  })
})

describe('zotero_add_tags and zotero_add_to_collection', () => {
  function serveItem(mock: MockZotero, data: Record<string, unknown>): void {
    mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify({
          key: ITEM_KEY,
          version: 10,
          data: { key: ITEM_KEY, version: 10, itemType: 'journalArticle', ...data },
        }),
      ),
    )
  }

  it('tags an item after approval, merging with existing tags', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [{ tag: 'existing', type: 1 }] })
    let patchBody: Record<string, unknown> | undefined
    lane.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      patchBody = JSON.parse(
        lane.mock.requests[lane.mock.requests.length - 1]?.body ?? '{}',
      ) as Record<string, unknown>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }, '')
    })
    const result = expectValue(
      await lane.runTool('zotero_add_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        tags: [' new '],
      }),
      'zotero_add_tags',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      version: 12,
      tags: ['existing', 'new'],
      added: ['new'],
      unchanged: false,
    })
    expect(patchBody).toEqual({ tags: [{ tag: 'existing', type: 1 }, { tag: 'new' }] })
  })

  it('adds an item to a collection by name after approval', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [], collections: [] })
    lane.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_add_to_collection', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        collection: '方法论',
      }),
      'zotero_add_to_collection',
    )
    expect(result.value).toMatchObject({ kind: 'applied', added: true, version: 12 })
  })

  it('returns declined for add_tags and add_to_collection without writing', async () => {
    const lane = await bootLane({ writeEnabled: true })
    ScriptedQuestions.script.push(['Cancel', 'Cancel'])
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [] })
    const tagsResult = expectValue(
      await lane.runTool('zotero_add_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        tags: [' new '],
      }),
      'zotero_add_tags',
    )
    expect(tagsResult.value).toEqual({ kind: 'declined' })
    const collectionResult = expectValue(
      await lane.runTool('zotero_add_to_collection', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        collection: '方法论',
      }),
      'zotero_add_to_collection',
    )
    expect(collectionResult.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('returns declined for add_tags and add_to_collection when the user dismisses the plan review (ASK_CANCELLED)', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [] })
    ScriptedQuestions.rejection = {
      code: 'ASK_CANCELLED',
      message: 'the user cancelled ask_user_question',
    }
    const tagsResult = expectValue(
      await lane.runTool('zotero_add_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        tags: [' new '],
      }),
      'zotero_add_tags',
    )
    expect(tagsResult.value).toEqual({ kind: 'declined' })

    ScriptedQuestions.rejection = {
      code: 'ASK_CANCELLED',
      message: 'the user cancelled ask_user_question',
    }
    const collectionResult = expectValue(
      await lane.runTool('zotero_add_to_collection', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        collection: '方法论',
      }),
      'zotero_add_to_collection',
    )
    expect(collectionResult.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses over-limit tags before any plan or network', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    const result = await lane.runTool('zotero_add_tags', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      tags: Array.from({ length: 51 }, (_, index) => `tag-${index}`),
    })
    expect(result.isError).toBe(true)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses blank markdown, tags, or collections on create_note before the plan card', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)

    const blankMd = await lane.runTool('zotero_create_note', { markdown: '   ' })
    expect(blankMd.isError).toBe(true)
    if (!blankMd.isError) throw new Error('unreachable')
    expect(blankMd.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    const blankTag = await lane.runTool('zotero_create_note', { markdown: 'valid', tags: ['   '] })
    expect(blankTag.isError).toBe(true)
    if (!blankTag.isError) throw new Error('unreachable')
    expect(blankTag.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    const blankColl = await lane.runTool('zotero_create_note', {
      markdown: 'valid',
      collections: ['   '],
    })
    expect(blankColl.isError).toBe(true)
    if (!blankColl.isError) throw new Error('unreachable')
    expect(blankColl.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    expect(scripted.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('refuses blank tags on add_tags and blank collection on add_to_collection', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)

    const blankTag = await lane.runTool('zotero_add_tags', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      tags: ['   '],
    })
    expect(blankTag.isError).toBe(true)
    if (!blankTag.isError) throw new Error('unreachable')
    expect(blankTag.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    const blankColl = await lane.runTool('zotero_add_to_collection', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      collection: '   ',
    })
    expect(blankColl.isError).toBe(true)
    if (!blankColl.isError) throw new Error('unreachable')
    expect(blankColl.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses group-library write refs before showing a plan', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    const groupRef = 'zotero://group/55/item/ITEMABC1'
    const cases = [
      ['zotero_create_note', { markdown: 'x', sourceRefs: [groupRef] }],
      [
        'zotero_create_note',
        { markdown: 'x', collections: ['zotero://group/55/collection/COLL1234'] },
      ],
      ['zotero_add_tags', { ref: groupRef, tags: ['review'] }],
      [
        'zotero_add_to_collection',
        { ref: groupRef, collection: 'zotero://group/55/collection/COLL1234' },
      ],
    ] as const
    for (const [name, args] of cases) {
      const result = await lane.runTool(name, args)
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    }
    expect(scripted.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('locates approval by WRITE_PLAN_QUESTION_ID even if other answers precede it', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    ScriptedQuestions.customAnswers = {
      answers: [
        { id: 'preceding_survey_question', selected: ['Reject'] },
        { id: WRITE_PLAN_QUESTION_ID, selected: ['Apply'] },
      ],
    }
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({ kind: 'applied', key: NEW_KEY })
  })

  it('treats approval response with custom text feedback as declined', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    ScriptedQuestions.customAnswers = {
      answers: [
        {
          id: WRITE_PLAN_QUESTION_ID,
          selected: [],
          custom: 'Please change the note content',
        },
      ],
    }
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})
