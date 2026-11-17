/** Invalid current state is refused before either approval ask; accepted writes recheck it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  StubApproval,
} from '../../helpers/approval-stub.js'
import { collectionRow } from '../../helpers/server/objects.js'
import { itemJson } from '../../helpers/write-domain-fixtures.js'

const SERVER = 'srv-preflight-01'
const headers = { 'Zotero-Server-ID': SERVER, 'Last-Modified-Version': '8' }
let lane: HostLane
beforeEach(async () => {
  resetApprovalStub()
  lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  lane.mock.route('GET', '/api/', (_req, _res, h) => h.json({}, headers))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await lane.teardown()
})

function expectNoApprovalOrMutation(): void {
  expect(approvalAsks).toHaveLength(0)
  expect((lane.ctx.get('userQuestions') as unknown as ApprovingQuestions).asks).toHaveLength(0)
  expect(lane.mock.requests.every((request) => request.method === 'GET')).toBe(true)
}

describe('read-only write preflight', () => {
  it('checks every sibling page before asking to create a top-level collection', async () => {
    lane.mock.route('GET', '/api/users/0/collections/top', (req, _res, h) => {
      const offset = Number(
        new URL(req.url ?? '', lane.mock.baseUrl).searchParams.get('start') ?? 0,
      )
      const rows =
        offset === 0
          ? Array.from({ length: 100 }, (_, i) =>
              collectionRow({
                key: `COLL${String(i).padStart(4, '0')}`,
                data: { name: `Collection ${i}` },
              }),
            )
          : [collectionRow({ key: 'EXIST001', data: { name: 'Existing' } })]
      h.json(rows, { ...headers, 'Total-Results': '101' })
    })
    const result = await lane.runTool('zotero_create_collection', { name: 'Existing' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('Expected duplicate refusal')
    expect(result.error.info?.code).toBe('ZOTERO_INVALID_ARGUMENT')
    expect(lane.mock.requests.filter((r) => r.pathname.endsWith('/collections/top'))).toHaveLength(
      2,
    )
    expectNoApprovalOrMutation()
  })

  it('resolves the named parent and refuses its duplicate child before approval', async () => {
    lane.mock.route('GET', '/api/users/0/collections', (_req, _res, h) =>
      h.json([collectionRow({ key: 'PARENT01', data: { name: 'Parent' } })], {
        ...headers,
        'Total-Results': '1',
      }),
    )
    lane.mock.route('GET', '/api/users/0/collections/PARENT01/collections', (_req, _res, h) =>
      h.json(
        [
          collectionRow({
            key: 'EXIST001',
            data: { name: 'Existing', parentCollection: 'PARENT01' },
          }),
        ],
        { ...headers, 'Total-Results': '1' },
      ),
    )
    const result = await lane.runTool('zotero_create_collection', {
      name: 'Existing',
      parent: 'Parent',
    })
    expect(result.isError).toBe(true)
    expectNoApprovalOrMutation()
  })

  it.each([
    [
      'zotero_update_note',
      { ref: 'zotero://user/0/item/TARGET01', markdown: 'New note' },
      { itemType: 'book' },
    ],
    [
      'zotero_update_item_collections',
      { ref: 'zotero://user/0/item/TARGET01', add: ['zotero://user/0/collection/READING1'] },
      { itemType: 'note', parentItem: 'PARENT01' },
    ],
  ])('refuses an ineligible target for %s before approval', async (name, args, data) => {
    lane.mock.route('GET', '/api/users/0/items/TARGET01', (_req, _res, h) =>
      h.json(itemJson('TARGET01', 8, data), headers),
    )
    const result = await lane.runTool(name, args)
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('Expected target refusal')
    expect(result.error.info?.code).toBe('ZOTERO_INVALID_ARGUMENT')
    expectNoApprovalOrMutation()
  })

  it('rechecks siblings after approval instead of trusting the earlier snapshot', async () => {
    let duplicate = false
    lane.mock.route('GET', '/api/users/0/collections/top', (_req, _res, h) =>
      h.json(duplicate ? [collectionRow({ data: { name: 'New collection' } })] : [], {
        ...headers,
        'Total-Results': duplicate ? '1' : '0',
      }),
    )
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    const ask = questions.ask.bind(questions)
    vi.spyOn(questions, 'ask').mockImplementation(async (request) => {
      duplicate = true
      return await ask(request)
    })
    const result = await lane.runTool('zotero_create_collection', { name: 'New collection' })
    expect(result.isError).toBe(true)
    expect(approvalAsks).toHaveLength(1)
    expect(questions.asks).toHaveLength(1)
    expect(lane.mock.requests.filter((r) => r.pathname.endsWith('/collections/top'))).toHaveLength(
      2,
    )
    expect(lane.mock.requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('rejects an unreadable sibling listing before asking for approval', async () => {
    lane.mock.route('GET', '/api/users/0/collections/top', (_req, _res, h) => h.json([], headers))
    const result = await lane.runTool('zotero_create_collection', { name: 'New collection' })
    expect(result.isError).toBe(true)
    expectNoApprovalOrMutation()
  })
})
