import { WRITE_SERVER_ID as SERVER_ID } from '../../helpers/server/keys.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { ApprovingQuestions, resetApprovalStub, StubApproval } from '../../helpers/approval-stub.js'
import { expectValue, setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'

import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'

const COLLECTION_KEY = 'COLL0001'
const PARENT_KEY = 'COLL0002'
const COLLECTION_REF = `zotero://user/0/collection/${COLLECTION_KEY}`
const PARENT_REF = `zotero://user/0/collection/${PARENT_KEY}`
/** The realm-scoped ref the domain answers with, carrying the serving instance. */
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
    expect(
      tool.output.render!(args, {
        kind: 'committed-unverified',
        committed: true,
        retryable: false,
        reason: 'receipt-unknown',
        key: COLLECTION_KEY,
        serverId: SERVER_ID,
      })[0],
    ).toMatchObject({ type: 'text', text: expect.stringContaining('Do not retry') })
    expect(
      tool.output.presentationMeta!(args, {
        kind: 'committed-unverified',
        committed: true,
        retryable: false,
        reason: 'receipt-unknown',
        key: COLLECTION_KEY,
        serverId: SERVER_ID,
      }),
    ).toMatchObject({ kind: 'committed-unverified', reason: 'receipt-unknown' })
  })
})
