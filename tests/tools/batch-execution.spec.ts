/**
 * `zotero_batch_items` execution through the approval seam: the host-lane half
 * of the unified batch engine — identity grant, plan review, declined writes,
 * the uncertain-create receipt, and the recoverable Trash policy prompt. The
 * unit-level argument refusals, plan markdown, receipts, and delete previews
 * live in `./batch-items.spec.ts`.
 * @module tests/tools/batch-execution
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type HostLane, setupHostLane, expectValue } from '../helpers/lanes/host-lane.js'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../helpers/approval-stub.js'
import { itemJson } from '../helpers/write-domain-fixtures.js'

const SERVER_ID = 'srv-batch-tool-0001'

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
})

afterEach(async () => {
  await lane.teardown()
})

describe('batch execution through the approval seam', () => {
  function serveIdentityAndGrant(): void {
    lane.mock.route('GET', '/api/', (_req, _res, h) =>
      h.json({}, { 'Zotero-Server-ID': SERVER_ID }),
    )
    lane.mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
      h.json({ key: 'K'.repeat(32), remember: true }, { 'Zotero-Server-ID': SERVER_ID }),
    )
  }

  it('reviews every creation and returns refs through the native output contract', async () => {
    serveIdentityAndGrant()
    const create = Array.from({ length: 11 }, (_, index) => ({
      itemType: 'book',
      title: `Batch book ${index}`,
      tags: ['approved'],
    }))
    lane.mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      h.json(
        {
          successful: Object.fromEntries(
            create.map((input, index) => [
              index,
              itemJson(`BATCH${String(index).padStart(3, '0')}`, 42, input),
            ]),
          ),
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '42' },
      )
    })
    const result = expectValue(
      await lane.runTool('zotero_batch_items', { create }),
      'zotero_batch_items',
    )
    expect(result.value).toMatchObject({ total: 11, unverified: [], failed: [] })
    const text = result.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
    expect(text).toContain(`zotero://user/0/item/BATCH010?server=${SERVER_ID}`)
    expect(result.meta).toMatchObject({
      createdCount: 11,
      created: expect.arrayContaining([expect.objectContaining({ index: 10, key: 'BATCH010' })]),
    })
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    expect(questions.asks).toHaveLength(1)
    expect(questions.asks[0].questions[0].detail).toContain('Batch book 10')
    const post = lane.mock.requests.find((request) => request.pathname === '/api/users/0/items')
    expect(JSON.parse(post?.body ?? 'null')).toEqual(
      create.map((input) => ({ ...input, tags: [{ tag: 'approved' }] })),
    )
  })

  it('reports an uncertain native create without converting it into an ordinary failure', async () => {
    serveIdentityAndGrant()
    lane.mock.route('POST', '/api/users/0/items', (_req, res) => {
      res.destroy()
    })
    const result = expectValue(
      await lane.runTool('zotero_batch_items', {
        create: [{ itemType: 'book', title: 'Uncertain' }],
      }),
      'zotero_batch_items',
    )
    expect(result.value).toMatchObject({
      created: [],
      failed: [],
      unverified: [{ index: 0, retryable: false }],
    })
    expect(result.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('do not retry') }),
    ])
  })

  it('writes nothing when approval policy rejects the complete plan', async () => {
    setApprovalOutcome('rejected')
    const result = expectValue(
      await lane.runTool('zotero_batch_items', {
        create: [{ itemType: 'book', title: 'Declined' }],
      }),
      'zotero_batch_items',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests).toEqual([])
  })

  it('names the recoverable Trash outcome in the policy prompt', async () => {
    const key = 'TRASHME1'
    lane.mock.route('GET', `/api/users/0/items/${key}`, (_req, _res, h) =>
      h.json(itemJson(key, 7, { itemType: 'book', title: 'Old draft' }), {
        'Zotero-Server-ID': SERVER_ID,
      }),
    )
    lane.mock.route('GET', `/api/users/0/items/${key}/children`, (_req, _res, h) =>
      h.json([], { 'Zotero-Server-ID': SERVER_ID, 'Total-Results': '0' }),
    )
    setApprovalOutcome('rejected')
    const result = expectValue(
      await lane.runTool('zotero_batch_items', { delete: [`zotero://user/0/item/${key}`] }),
      'zotero_batch_items',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(approvalAsks).toHaveLength(1)
    expect(approvalAsks[0]?.displayReason?.zh).toContain('回收站')
    expect(approvalAsks[0]?.displayReason?.en).toContain('Trash')
    expect(lane.mock.requests.some((request) => request.method !== 'GET')).toBe(false)
  })
})
