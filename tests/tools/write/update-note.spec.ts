import { WRITE_SERVER_ID as SERVER_ID } from '../../helpers/server/keys.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../../helpers/approval-stub.js'
import {
  commitLive,
  expectValue,
  setupHostLane,
  type HostLane,
} from '../../helpers/lanes/host-lane.js'
import { itemJson } from '../../helpers/write-domain-fixtures.js'
import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'
import { updateNotePlan } from '../../../src/tools/update-note.js'

const NOTE_KEY = 'NOTE0001'
const NOTE_REF = `zotero://user/0/item/${NOTE_KEY}`
/** The realm-scoped ref the domain answers with, carrying the serving instance. */
const SERVED_NOTE_REF = `${NOTE_REF}?server=${SERVER_ID}`

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

/** Identity ping plus the authorization grant the write key comes from. */
function serveIdentityAndGrant(): void {
  lane.mock.route('GET', '/api/', (_req, _res, h) => h.json({}, { 'Zotero-Server-ID': SERVER_ID }))
  lane.mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
    h.json({ key: 'K'.repeat(32), remember: true }, { 'Zotero-Server-ID': SERVER_ID }),
  )
}

describe('zotero_update_note', () => {
  it('rejects an oversized body before approval or HTTP, using the current limit', async () => {
    await commitLive(lane, { writeNoteMaxChars: 10 })
    for (const markdown of ['12345678901', ' 1234567890 ', '😀'.repeat(6)]) {
      const result = await lane.runTool('zotero_update_note', { ref: NOTE_REF, markdown })
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('expected a validation failure')
      expect(result.error.info?.code).toBe('INVALID_ARGS')
    }
    expect(approvalAsks).toHaveLength(0)
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('accepts the exact bound for both note tools and observes a raised limit', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/items/${NOTE_KEY}`, (_req, _res, h) =>
      h.json(itemJson(NOTE_KEY, 10, { itemType: 'note' }), {
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '10',
      }),
    )
    await commitLive(lane, { writeNoteMaxChars: 10 })
    setApprovalOutcome('rejected')
    for (const name of ['zotero_create_note', 'zotero_update_note']) {
      const target = name === 'zotero_update_note' ? { ref: NOTE_REF } : {}
      const result = expectValue(
        await lane.runTool(name, { ...target, markdown: '1234567890' }),
        name,
      )
      expect(result.value).toEqual({ kind: 'declined' })
      const blank = await lane.runTool(name, { ...target, markdown: ' \n ' })
      expect(blank.isError).toBe(true)
    }
    await commitLive(lane, { writeNoteMaxChars: 11 })
    expect(
      expectValue(
        await lane.runTool('zotero_update_note', { ref: NOTE_REF, markdown: '12345678901' }),
        'zotero_update_note',
      ).value,
    ).toEqual({ kind: 'declined' })
    expect(approvalAsks).toHaveLength(3)
    expect(lane.mock.requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('rewrites a note body under its version precondition', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/items/${NOTE_KEY}`, (_req, _res, h) =>
      h.json(
        itemJson(NOTE_KEY, 10, { itemType: 'note', note: '<p>old</p>', tags: [], collections: [] }),
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
      ),
    )
    lane.mock.route('PATCH', `/api/users/0/items/${NOTE_KEY}`, (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '11' }, ''),
    )

    const result = expectValue(
      await lane.runTool('zotero_update_note', { ref: NOTE_REF, markdown: '# Updated' }),
      'zotero_update_note',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      ref: SERVED_NOTE_REF,
      version: 11,
      libraryVersion: 11,
      serverId: SERVER_ID,
    })
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    expect(questions.asks).toHaveLength(1)
    expect(questions.asks[0].questions[0].detail).toContain(`- Note: ${NOTE_REF}`)
    const patch = lane.mock.requests.find((request) => request.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? 'null')).toEqual({
      note: expect.stringContaining('Updated'),
    })
    expect(patch?.headers['if-unmodified-since-version']).toBe('10')
    expect(result.meta).toEqual({
      kind: 'applied',
      ref: SERVED_NOTE_REF,
      version: 11,
      libraryVersion: 11,
    })
  })

  it('refuses a target that is not a note before any PATCH', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/items/${NOTE_KEY}`, (_req, _res, h) =>
      h.json(itemJson(NOTE_KEY, 10, { itemType: 'journalArticle', tags: [], collections: [] }), {
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '10',
      }),
    )

    const result = await lane.runTool('zotero_update_note', {
      ref: NOTE_REF,
      markdown: '# Updated',
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('writes nothing when the plan is rejected', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/items/${NOTE_KEY}`, (_req, _res, h) =>
      h.json(itemJson(NOTE_KEY, 10, { itemType: 'note' }), {
        'Zotero-Server-ID': SERVER_ID,
        'Last-Modified-Version': '10',
      }),
    )
    setApprovalOutcome('rejected')
    const result = expectValue(
      await lane.runTool('zotero_update_note', { ref: NOTE_REF, markdown: '# Updated' }),
      'zotero_update_note',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(approvalAsks).toHaveLength(1)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('names the card for every settle state', () => {
    const tool = definition('zotero_update_note')
    const args = { ref: NOTE_REF, markdown: '# Updated' }
    const present = tool.presentResult!
    expect(present(args, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero note: declined, nothing written',
    })
    expect(present(args, ok({ kind: 'applied', ref: NOTE_REF }))).toEqual({
      card: 'generic',
      title: `Zotero note updated: ${NOTE_REF}`,
    })
    expect(present(args, ok('loose meta'))).toBeUndefined()
    const served = tool.output.render(args, {
      kind: 'applied',
      ref: SERVED_NOTE_REF,
      version: 11,
      libraryVersion: 11,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(served.text).toContain(`Updated note ${SERVED_NOTE_REF} (version 11).`)
    expect(served.text).toContain(`served by ${SERVER_ID}`)
    const unverified = tool.output.render(args, {
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'receipt-unknown',
      key: NOTE_KEY,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(unverified.text).toContain('Do not retry')
    expect(
      tool.output.presentationMeta!(args, {
        kind: 'committed-unverified',
        committed: true,
        retryable: false,
        reason: 'receipt-unknown',
        key: NOTE_KEY,
        serverId: SERVER_ID,
      }),
    ).toMatchObject({ kind: 'committed-unverified', reason: 'receipt-unknown', key: NOTE_KEY })
    expect(tool.presentCall!(args)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero note',
      rawInput: NOTE_REF,
    })
  })

  it('shows the complete updateNotePlan body beyond 300 characters', () => {
    const longMarkdown = 'a'.repeat(350)
    const plan = updateNotePlan({ ref: NOTE_REF, markdown: longMarkdown })
    expect(plan).toContain(longMarkdown)
    const shortPlan = updateNotePlan({ ref: NOTE_REF, markdown: 'short' })
    expect(shortPlan).not.toContain('…')
  })
})
