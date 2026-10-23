/**
 * `zotero_update_note` and `zotero_update_collection`, the two PATCH-backed
 * update tools: the versioned read-modify-write through the approval seam, the
 * refusals the domain raises, the declined arm, and the replayable projections
 * the cards read.
 * @module tests/tools/update-note
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../helpers/approval-stub.js'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { itemJson } from '../helpers/write-domain-fixtures.js'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'

const SERVER_ID = 'srv-update-note-0001'
const NOTE_KEY = 'NOTE0001'
const COLLECTION_KEY = 'COLL0001'
const PARENT_KEY = 'COLL0002'
const NOTE_REF = `zotero://user/0/item/${NOTE_KEY}`
const COLLECTION_REF = `zotero://user/0/collection/${COLLECTION_KEY}`
const PARENT_REF = `zotero://user/0/collection/${PARENT_KEY}`
/** The realm-scoped ref the domain answers with, carrying the serving instance. */
const SERVED_NOTE_REF = `${NOTE_REF}?server=${SERVER_ID}`
const SERVED_COLLECTION_REF = `${COLLECTION_REF}?server=${SERVER_ID}`

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
    expect(tool.presentCall!(args)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero note',
      rawInput: NOTE_REF,
    })
  })
})

describe('zotero_update_collection', () => {
  it('renames a collection under its version precondition', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, _res, h) =>
      h.json(
        {
          key: COLLECTION_KEY,
          version: 5,
          data: { key: COLLECTION_KEY, name: 'Reading', parentCollection: false },
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '5' },
      ),
    )
    lane.mock.route('PATCH', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '6' }, ''),
    )

    const result = expectValue(
      await lane.runTool('zotero_update_collection', {
        collection: COLLECTION_REF,
        name: 'Reading 2',
      }),
      'zotero_update_collection',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      ref: SERVED_COLLECTION_REF,
      version: 6,
      name: 'Reading 2',
      libraryVersion: 6,
      serverId: SERVER_ID,
    })
    const patch = lane.mock.requests.find((request) => request.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? 'null')).toEqual({ name: 'Reading 2' })
    expect(result.meta).toEqual({
      kind: 'applied',
      ref: SERVED_COLLECTION_REF,
      version: 6,
    })
  })

  it('refuses before any PATCH when neither name nor parent is provided', async () => {
    serveIdentityAndGrant()
    const result = await lane.runTool('zotero_update_collection', {
      collection: COLLECTION_REF,
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses an invalid version record instead of writing', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, _res, h) =>
      h.json(
        { key: COLLECTION_KEY, data: { key: COLLECTION_KEY, name: 'Reading' } },
        { 'Zotero-Server-ID': SERVER_ID },
      ),
    )
    const result = await lane.runTool('zotero_update_collection', {
      collection: COLLECTION_REF,
      name: 'Reading 2',
    })
    expect(result.isError).toBe(true)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('reparents a collection without renaming it', async () => {
    serveIdentityAndGrant()
    lane.mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, _res, h) =>
      h.json(
        {
          key: COLLECTION_KEY,
          version: 5,
          data: { key: COLLECTION_KEY, name: 'Reading', parentCollection: false },
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '5' },
      ),
    )
    lane.mock.route('PATCH', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '6' }, ''),
    )

    const result = expectValue(
      await lane.runTool('zotero_update_collection', {
        collection: COLLECTION_REF,
        parent: PARENT_REF,
      }),
      'zotero_update_collection',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      ref: SERVED_COLLECTION_REF,
      parentRef: PARENT_REF,
    })
    expect(result.value).not.toHaveProperty('name')
    const patch = lane.mock.requests.find((request) => request.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? 'null')).toEqual({ parentCollection: PARENT_KEY })
    expect(result.meta).toEqual({
      kind: 'applied',
      ref: SERVED_COLLECTION_REF,
      version: 6,
      parentRef: PARENT_REF,
    })
  })

  it('names the card for every settle state', () => {
    const tool = definition('zotero_update_collection')
    const args = { collection: COLLECTION_REF, name: 'Reading 2' }
    expect(tool.presentCall!(args)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero collection',
      rawInput: COLLECTION_REF,
    })
    const present = tool.presentResult!
    expect(present(args, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection: declined, nothing written',
    })
    expect(present(args, ok({ kind: 'applied', ref: COLLECTION_REF }))).toEqual({
      card: 'generic',
      title: `Zotero collection updated: ${COLLECTION_REF}`,
    })
    expect(tool.output.presentationMeta!(args, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(tool.output.render!(args, { kind: 'declined' })).toEqual([
      {
        type: 'text',
        text: 'Declined: the user answered the plan without approving. Nothing was written.',
      },
    ])
  })
})
