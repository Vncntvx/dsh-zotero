/**
 * `zotero_restore_items`: the recoverable Trash restore — per-item versioned
 * PATCHes with a per-ref failure list, the declined arm, and the replayable
 * counts the card reads.
 * @module tests/tools/write/restore-items
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../../helpers/approval-stub.js'
import { expectValue, setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import { itemJson } from '../../helpers/write-domain-fixtures.js'
import { ZOTERO_NOT_FOUND } from '../../../src/errors.js'
import type { ZoteroRestoreItemsResult } from '../../../src/types.js'
import { renderRestoreItems } from '../../../src/tools/restore-items.js'

const SERVER_ID = 'srv-restore-items-01'
const KEY_1 = 'RESTORE1'
const KEY_2 = 'RESTORE2'
const REF_1 = `zotero://user/0/item/${KEY_1}`
const REF_2 = `zotero://user/0/item/${KEY_2}`
const SERVED_REF_1 = `${REF_1}?server=${SERVER_ID}`

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

function definition(name: string): ToolDefinition {
  const tool = lane.tool(name)
  if (tool === undefined) throw new Error(`tool ${name} not registered`)
  return tool
}

function ok(meta: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'x' }],
    isError: false,
    meta: meta as ToolResult['meta'],
  }
}

function serveIdentityAndGrant(): void {
  lane.mock.route('GET', '/api/', (_req, _res, h) => h.json({}, { 'Zotero-Server-ID': SERVER_ID }))
  lane.mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
    h.json({ key: 'K'.repeat(32), remember: true }, { 'Zotero-Server-ID': SERVER_ID }),
  )
}

/** One trashed item's versioned read and the restore PATCH that follows it. */
function serveTrashedItem(key: string, version: number, restoredVersion: number): void {
  lane.mock.route('GET', `/api/users/0/items/${key}`, (_req, _res, h) =>
    h.json(
      itemJson(key, version, {
        itemType: 'book',
        title: 'Old draft',
        deleted: 1,
        tags: [],
        collections: [],
      }),
      { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': String(version) },
    ),
  )
  lane.mock.route('PATCH', `/api/users/0/items/${key}`, (_req, _res, h) =>
    h.raw(
      204,
      { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': String(restoredVersion) },
      '',
    ),
  )
}

describe('zotero_restore_items', () => {
  it('renders all 50 outcomes and reports conflict reasons and partial progress', () => {
    const restored = Array.from({ length: 48 }, (_, index) => ({
      ref: `zotero://user/0/item/R${String(index).padStart(7, '0')}`,
      restored: true as const,
      version: index + 1,
      libraryVersion: index + 1,
    }))
    const failed = [
      {
        op: 'update' as const,
        ref: REF_1,
        code: 'ZOTERO_WRITE_CONFLICT',
        message: 'Version changed',
        completedRefs: ['zotero://user/0/item/DONE0001'],
      },
      {
        op: 'update' as const,
        ref: REF_2,
        code: ZOTERO_NOT_FOUND,
        message: 'Object no longer exists',
      },
      {
        op: 'update' as const,
        index: 3,
        code: 'ZOTERO_UNEXPECTED',
        message: 'Pre-flight parse error',
      },
    ]
    const content = renderRestoreItems({ refs: [] }, { kind: 'restored', restored, failed })
    const text = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
    for (const entry of restored) expect(text).toContain(entry.ref)
    expect(text).toContain(REF_1)
    expect(text).toContain(REF_2)
    expect(text).toContain('index 3')
    for (const failure of failed) {
      expect(text).toContain(failure.code)
      expect(text).toContain(failure.message)
    }
    expect(text).toContain(failed[0].completedRefs![0])
    expect(
      renderRestoreItems({ refs: [] }, { kind: 'restored', restored: [], failed }),
    ).toContainEqual({
      type: 'text',
      text: expect.stringContaining('Restored 0 item(s); 3 failed.'),
    })
  })

  it('restores every trashed item under its own version precondition', async () => {
    serveIdentityAndGrant()
    serveTrashedItem(KEY_1, 10, 11)
    serveTrashedItem(KEY_2, 12, 13)

    const result = expectValue(
      await lane.runTool('zotero_restore_items', { refs: [REF_1, REF_2] }),
      'zotero_restore_items',
    )
    expect(result.value).toEqual({
      kind: 'restored',
      restored: [
        {
          ref: SERVED_REF_1,
          restored: true,
          version: 11,
          libraryVersion: 11,
          serverId: SERVER_ID,
        },
        {
          ref: `${REF_2}?server=${SERVER_ID}`,
          restored: true,
          version: 13,
          libraryVersion: 13,
          serverId: SERVER_ID,
        },
      ],
      failed: [],
      serverId: SERVER_ID,
    })
    const patches = lane.mock.requests.filter((request) => request.method === 'PATCH')
    expect(patches).toHaveLength(2)
    for (const patch of patches) expect(JSON.parse(patch.body ?? 'null')).toEqual({ deleted: 0 })
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    expect(questions.asks).toHaveLength(1)
    expect(questions.asks[0].questions[0].detail).toContain(`- Items: ${REF_1}, ${REF_2}`)
    expect(result.meta).toEqual({
      kind: 'restored',
      restoredCount: 2,
      failedCount: 0,
      serverId: SERVER_ID,
    })
  })

  it('reports one gone item as a per-ref failure and keeps the rest', async () => {
    serveIdentityAndGrant()
    serveTrashedItem(KEY_1, 10, 11)
    lane.mock.route('GET', `/api/users/0/items/${KEY_2}`, (_req, res, h) =>
      h.raw(404, { 'Content-Type': 'text/plain', 'Zotero-Server-ID': SERVER_ID }, 'Not found'),
    )

    const result = expectValue(
      await lane.runTool('zotero_restore_items', { refs: [REF_1, REF_2] }),
      'zotero_restore_items',
    )
    expect(result.value).toMatchObject({
      kind: 'restored',
      restored: [{ ref: SERVED_REF_1, restored: true }],
      failed: [{ op: 'update', ref: REF_2, code: ZOTERO_NOT_FOUND }],
      serverId: SERVER_ID,
    })
    expect(lane.mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1)
    const text = result.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
    expect(text).toContain(SERVED_REF_1)
    expect(text).toContain(REF_2)
    expect(text).toContain(ZOTERO_NOT_FOUND)
    expect(text).toContain((result.value as unknown as ZoteroRestoreItemsResult).failed[0].message)
  })

  it('writes nothing when the plan is rejected', async () => {
    serveIdentityAndGrant()
    setApprovalOutcome('rejected')
    const result = expectValue(
      await lane.runTool('zotero_restore_items', { refs: [REF_1] }),
      'zotero_restore_items',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(approvalAsks).toHaveLength(1)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('names the card for every settle state', () => {
    const tool = definition('zotero_restore_items')
    const args = { refs: [REF_1] }
    const present = tool.presentResult!
    expect(present(args, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero restore: declined, nothing written',
    })
    expect(present(args, ok({ kind: 'restored', restoredCount: 2, failedCount: 1 }))).toEqual({
      card: 'generic',
      title: 'Zotero restore: 2 restored, 1 failed',
    })
    expect(present(args, ok({ kind: 'restored', restoredCount: 1, failedCount: 0 }))).toEqual({
      card: 'generic',
      title: 'Zotero restore: 1 restored, 0 failed',
    })
    expect(present(args, ok({ kind: 'restored', restoredCount: 0, failedCount: 1 }))).toEqual({
      card: 'generic',
      title: 'Zotero restore: 0 restored, 1 failed',
    })
    expect(present(args, ok({ kind: 'restored' }))).toBeUndefined()
    expect(present(args, ok('loose meta'))).toBeUndefined()
    expect(tool.presentCall!(args)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Restore Zotero Trash items',
      rawInput: '1 items',
    })
    expect(
      tool.output.presentationMeta!(args, { kind: 'restored', restored: [], failed: [] }),
    ).toEqual({ kind: 'restored', restoredCount: 0, failedCount: 0 })
  })
})
