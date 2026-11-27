import { Service, type Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ZoteroReaderCreateAnnotationsRequest } from '../../../src/contract.js'
import ReaderService from '../../../src/reader/service.js'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../../helpers/approval-stub.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import {
  batchHeaders,
  grantAuthorize,
  ITEM_KEY,
  serveItemRead,
  SERVER_ID,
} from '../../helpers/write-domain-fixtures.js'

const allows = vi.fn()
class ReaderAccess extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remoteAccess')
  }
  allows = allows
}

class ReaderSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionController')
  }
  async resolveAgent() {
    return { agent: { status: 'running' } }
  }
}

let lane: HostLane | undefined
const input = {
  sessionId: 'reader-session',
  ref: `zotero://user/0/attachment/${ITEM_KEY}`,
  type: 'underline',
  color: '#ffd400',
  comment: 'Read with results',
  pages: [0, 1].map((pageIndex) => ({
    pageIndex,
    text: `Selected text ${pageIndex + 1}`,
    pageLabel: pageIndex === 0 ? 'iv' : '1',
    textOffset: 0,
    top: 30,
    rects: [{ x: 20, y: 40, width: 75, height: 12 }],
  })),
} satisfies ZoteroReaderCreateAnnotationsRequest

beforeEach(() => {
  resetApprovalStub()
  allows.mockReset().mockReturnValue(true)
})
afterEach(async () => {
  await lane?.teardown()
  lane = undefined
})

async function boot() {
  lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(ReaderSessions)
        await ctx.plugin(ReaderAccess)
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  await lane.ctx.plugin(ReaderService, {})
  return lane
}

it('reviews the page texts and comment through both approvals before issuing one native batch', async () => {
  const host = await boot()
  const questions = host.ctx.userQuestions as unknown as ApprovingQuestions
  const order: string[] = []
  const approve = questions.ask.bind(questions)
  questions.ask = async (request) => {
    expect(approvalAsks).toHaveLength(1)
    order.push('plan review')
    return await approve(request)
  }
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': SERVER_ID }),
  )
  serveItemRead(host.mock, { data: { itemType: 'attachment', contentType: 'application/pdf' } })
  host.mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
    order.push('Zotero POST')
    const submitted = JSON.parse(host.mock.requests.at(-1)?.body ?? '[]')
    const key = 'ANNO0001'
    helpers.json(
      {
        successful: { '0': { key, version: 21, data: { ...submitted[0], key, version: 21 } } },
        success: { '0': key },
        failed: {},
        unchanged: {},
      },
      batchHeaders(21),
    )
  })

  const result = await host.ctx.reader.readerCreateAnnotations(input, new AbortController().signal)

  expect(order).toEqual(['plan review', 'Zotero POST'])
  expect(approvalAsks).toHaveLength(1)
  expect(approvalAsks[0]).not.toHaveProperty('callId')
  expect(questions.asks).toHaveLength(1)
  const plan = JSON.stringify(questions.asks[0])
  for (const excerpt of [
    'Read with results',
    'Selected text 1',
    'Selected text 2',
    'Physical page 1',
  ])
    expect(plan).toContain(excerpt)
  expect(result).toEqual({
    kind: 'settled',
    pages: [
      {
        pageIndex: 0,
        status: 'applied',
        ref: `zotero://user/0/annotation/ANNO0001?server=${SERVER_ID}`,
      },
      { pageIndex: 1, status: 'committed-unverified' },
    ],
  })
})

it('refuses a session without write access before approval or Zotero requests', async () => {
  const host = await boot()
  allows.mockReturnValue(false)

  await expect(
    host.ctx.reader.readerCreateAnnotations(input, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'remote-access/denied' })

  expect(approvalAsks).toHaveLength(0)
  expect(host.mock.requests).toHaveLength(0)
})

it('returns a failed page and an unverified missing page without retrying', async () => {
  const host = await boot()
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': SERVER_ID }),
  )
  serveItemRead(host.mock, { data: { itemType: 'attachment', contentType: 'application/pdf' } })
  host.mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
    const submitted = JSON.parse(host.mock.requests.at(-1)?.body ?? '[]')
    helpers.json(
      {
        successful: {
          '0': {
            key: 'ANNO0001',
            version: 21,
            data: { ...submitted[0], key: 'ANNO0001', version: 21 },
          },
        },
        success: { '0': 'ANNO0001' },
        failed: { '1': { key: '', code: 400, message: 'Page refused' } },
        unchanged: {},
      },
      batchHeaders(21),
    )
  })
  const result = await host.ctx.reader.readerCreateAnnotations(
    { ...input, pages: [...input.pages, { ...input.pages[1]!, pageIndex: 2 }] },
    new AbortController().signal,
  )
  expect(result).toMatchObject({
    kind: 'settled',
    pages: [
      { pageIndex: 0, status: 'applied' },
      { pageIndex: 1, status: 'failed', message: expect.stringContaining('Page refused') },
      { pageIndex: 2, status: 'committed-unverified' },
    ],
  })
})

it('returns declined for annotation creates and edits when the plan review is denied', async () => {
  const host = await boot()
  setApprovalOutcome('rejected')
  await expect(
    host.ctx.reader.readerCreateAnnotations(input, new AbortController().signal),
  ).resolves.toMatchObject({ kind: 'declined' })
  await expect(
    host.ctx.reader.readerUpdateAnnotation(
      {
        sessionId: input.sessionId,
        ref: `zotero://user/0/annotation/${ITEM_KEY}`,
        expectedVersion: 10,
        set: { annotationColor: '#2ea8e5' },
      },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ kind: 'declined' })
  await expect(
    host.ctx.reader.readerDeleteAnnotation(
      {
        sessionId: input.sessionId,
        ref: `zotero://user/0/annotation/${ITEM_KEY}`,
        expectedVersion: 10,
      },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ kind: 'declined' })
  expect(host.mock.requests).toHaveLength(0)
})

it('reviews annotation tags and uses the same approval as annotation field edits', async () => {
  const host = await boot()
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': SERVER_ID }),
  )
  serveItemRead(host.mock, {
    version: 10,
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      tags: [{ tag: 'Previous' }],
    },
  })
  host.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
    helpers.raw(204, batchHeaders(21), ''),
  )
  const result = await host.ctx.reader.readerUpdateAnnotation(
    {
      sessionId: input.sessionId,
      ref: `zotero://user/0/annotation/${ITEM_KEY}`,
      expectedVersion: 10,
      set: {},
      tagChanges: { add: ['Review'], remove: ['Previous'] },
    },
    new AbortController().signal,
  )

  expect(result, result.message).toMatchObject({ kind: 'applied' })
  expect(approvalAsks).toHaveLength(1)
  const questions = host.ctx.userQuestions as unknown as ApprovingQuestions
  expect(questions.asks).toHaveLength(1)
  expect(JSON.stringify(questions.asks[0])).toContain('Add tag: Review')
  expect(JSON.stringify(questions.asks[0])).toContain('Remove tag: Previous')
  expect(host.mock.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1)
})

it('returns a conflict and sends no DELETE when the version changes before execution', async () => {
  const host = await boot()
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': SERVER_ID }),
  )
  serveItemRead(host.mock, {
    version: 11,
    data: { itemType: 'annotation', annotationType: 'underline' },
  })

  const result = await host.ctx.reader.readerDeleteAnnotation(
    {
      sessionId: input.sessionId,
      ref: `zotero://user/0/annotation/${ITEM_KEY}`,
      expectedVersion: 10,
    },
    new AbortController().signal,
  )

  expect(result).toMatchObject({ kind: 'failed', code: 'ZOTERO_WRITE_CONFLICT' })
  const questions = host.ctx.userQuestions as unknown as ApprovingQuestions
  expect(approvalAsks).toHaveLength(1)
  expect(approvalAsks[0]?.displayReason?.en).toContain('cannot be undone')
  expect(questions.asks).toHaveLength(1)
  expect(JSON.stringify(questions.asks[0])).toContain('Permanently delete')
  expect(host.mock.requests.every(({ method }) => method === 'GET')).toBe(true)
})
