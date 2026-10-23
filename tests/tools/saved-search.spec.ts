/**
 * The saved-search write tools: the tool-layer refusals that must happen
 * before any plan card is shown, and the replayable projections the cards
 * read. Execution through the approval seam is covered by the shared write
 * lanes; these cases pin the fail-fast contract the domain would otherwise
 * only reach after the user had already approved a plan.
 * @module tests/tools/saved-search
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import {
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../helpers/approval-stub.js'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import type { Options } from '../../src/config.js'
import { ZOTERO_INVALID_ARGUMENT, writeNonBlankMessage } from '../../src/errors.js'

const openLanes: HostLane[] = []

async function bootLane(config: Options): Promise<HostLane> {
  const lane = await setupHostLane(config, {
    compose: async (ctx) => {
      await ctx.plugin(StubApproval)
      await ctx.plugin(ApprovingQuestions)
    },
  })
  openLanes.push(lane)
  return lane
}

beforeEach(() => {
  resetApprovalStub()
})

afterEach(async () => {
  for (const lane of openLanes.splice(0)) await lane.teardown()
})

describe('saved-search write tools refuse blank names before the plan card', () => {
  it('refuses a blank create name before any approval is requested', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const result = await lane.runTool('zotero_create_saved_search', {
      name: '   ',
      conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(result.error.message).toBe(writeNonBlankMessage('name'))
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    expect(questions.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('refuses a blank update name before any approval is requested', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const result = await lane.runTool('zotero_update_saved_search', {
      search: 'zotero://user/0/search/SEARCH01',
      name: '\t',
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(result.error.message).toBe(writeNonBlankMessage('name'))
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    expect(questions.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})

const SERVER_ID = 'srv-saved-search-01'
const SEARCH_KEY = 'SEARCH01'
const SEARCH_REF = `zotero://user/0/search/${SEARCH_KEY}`
const SERVED_SEARCH_REF = `${SEARCH_REF}?server=${SERVER_ID}`

/** Identity ping plus the authorization grant the write key comes from. */
function serveIdentityAndGrant(lane: HostLane): void {
  lane.mock.route('GET', '/api/', (_req, _res, h) => h.json({}, { 'Zotero-Server-ID': SERVER_ID }))
  lane.mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
    h.json({ key: 'K'.repeat(32), remember: true }, { 'Zotero-Server-ID': SERVER_ID }),
  )
}

/** The saved-search record the update and delete paths read first. */
function serveSearchRead(lane: HostLane, version = 7): void {
  lane.mock.route('GET', `/api/users/0/searches/${SEARCH_KEY}`, (_req, _res, h) =>
    h.json(
      {
        key: SEARCH_KEY,
        version,
        data: {
          key: SEARCH_KEY,
          name: 'Recent',
          conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
        },
      },
      { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': String(version) },
    ),
  )
}

describe('saved-search execution through the approval seam', () => {
  it('creates a saved search and returns the applied identity', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    lane.mock.route('POST', '/api/users/0/searches', (_req, _res, h) =>
      h.json(
        {
          successful: {
            '0': {
              key: SEARCH_KEY,
              version: 8,
              data: {
                key: SEARCH_KEY,
                version: 8,
                name: 'Recent',
                conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
              },
            },
          },
          success: { '0': SEARCH_KEY },
          unchanged: {},
          failed: {},
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '8' },
      ),
    )

    const result = expectValue(
      await lane.runTool('zotero_create_saved_search', {
        name: 'Recent',
        conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
      }),
      'zotero_create_saved_search',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      ref: SERVED_SEARCH_REF,
      key: SEARCH_KEY,
      version: 8,
      name: 'Recent',
      libraryVersion: 8,
      serverId: SERVER_ID,
    })
    expect(result.meta).toEqual({
      kind: 'applied',
      ref: SERVED_SEARCH_REF,
      key: SEARCH_KEY,
      version: 8,
    })
    const questions = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    expect(questions.asks).toHaveLength(1)
    expect(questions.asks[0].questions[0].detail).toContain('- Name: Recent')
  })

  it('reports an unproven create as committed-unverified, not as a failure', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    lane.mock.route('POST', '/api/users/0/searches', (_req, res) => {
      res.destroy()
    })

    const result = expectValue(
      await lane.runTool('zotero_create_saved_search', {
        name: 'Recent',
        conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
      }),
      'zotero_create_saved_search',
    )
    expect(result.value).toMatchObject({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: SERVER_ID,
    })
    expect(result.meta).toMatchObject({ kind: 'committed-unverified', reason: 'commit-unknown' })
  })

  it('writes nothing when the create plan is rejected', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    setApprovalOutcome('rejected')
    const result = expectValue(
      await lane.runTool('zotero_create_saved_search', {
        name: 'Recent',
        conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
      }),
      'zotero_create_saved_search',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(
      lane.mock.requests.some(
        (request) => request.method === 'POST' && request.pathname === '/api/users/0/searches',
      ),
    ).toBe(false)
  })

  it('updates a saved search under its version precondition', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    serveSearchRead(lane, 7)
    lane.mock.route('PATCH', `/api/users/0/searches/${SEARCH_KEY}`, (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '8' }, ''),
    )

    const result = expectValue(
      await lane.runTool('zotero_update_saved_search', { search: SEARCH_REF, name: 'Recent 2' }),
      'zotero_update_saved_search',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      ref: SERVED_SEARCH_REF,
      key: SEARCH_KEY,
      version: 8,
      name: 'Recent 2',
      libraryVersion: 8,
    })
    const patch = lane.mock.requests.find((request) => request.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? 'null')).toEqual({ name: 'Recent 2' })
    expect(patch?.headers['if-unmodified-since-version']).toBe('7')
    expect(result.meta).toMatchObject({ kind: 'applied', ref: SERVED_SEARCH_REF, version: 8 })
  })

  it('deletes a saved search under the read library version', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    serveSearchRead(lane, 9)
    lane.mock.route('DELETE', `/api/users/0/searches/${SEARCH_KEY}`, (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' }, ''),
    )

    const result = expectValue(
      await lane.runTool('zotero_delete_saved_search', { search: SEARCH_REF }),
      'zotero_delete_saved_search',
    )
    expect(result.value).toEqual({
      kind: 'deleted',
      ref: SERVED_SEARCH_REF,
      key: SEARCH_KEY,
      deleted: true,
      libraryVersion: 10,
      serverId: SERVER_ID,
    })
    const remove = lane.mock.requests.find((request) => request.method === 'DELETE')
    expect(remove?.headers['if-unmodified-since-version']).toBe('9')
    expect(result.meta).toEqual({
      kind: 'deleted',
      ref: SERVED_SEARCH_REF,
      key: SEARCH_KEY,
      libraryVersion: 10,
    })
  })

  it('names the create, update, and delete cards for every settle state', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const toolOf = (name: string): ToolDefinition => {
      const tool = lane.tool(name)
      if (tool === undefined) throw new Error(`tool ${name} not registered`)
      return tool
    }
    const create = toolOf('zotero_create_saved_search')
    const createArgs = { name: 'Recent', conditions: [] }
    expect(create.presentResult!(createArgs, okResult({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero saved search: declined, nothing written',
    })
    expect(
      create.presentResult!(
        createArgs,
        okResult({ kind: 'committed-unverified', reason: 'commit-unknown' }),
      ),
    ).toEqual({ card: 'generic', title: 'Zotero saved search outcome unknown; do not retry' })
    expect(
      create.presentResult!(
        createArgs,
        okResult({ kind: 'committed-unverified', reason: 'saved-state-unverified' }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero saved search created but not verified; do not retry',
    })
    expect(
      create.presentResult!(createArgs, okResult({ kind: 'applied', ref: SERVED_SEARCH_REF })),
    ).toEqual({ card: 'generic', title: `Zotero saved search created: ${SERVED_SEARCH_REF}` })
    expect(create.presentResult!(createArgs, okResult('loose meta'))).toBeUndefined()
    expect(create.presentCall!(createArgs)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero saved search',
      rawInput: 'Recent',
    })

    const update = toolOf('zotero_update_saved_search')
    expect(update.presentResult!({ search: SEARCH_REF }, okResult({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero saved search: declined, nothing written',
    })
    expect(update.presentCall!({ search: SEARCH_REF })).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero saved search',
      rawInput: SEARCH_REF,
    })

    const remove = toolOf('zotero_delete_saved_search')
    expect(
      remove.presentResult!(
        { search: SEARCH_REF },
        okResult({ kind: 'deleted', ref: SERVED_SEARCH_REF }),
      ),
    ).toEqual({
      card: 'generic',
      title: `Zotero saved search deleted: ${SERVED_SEARCH_REF}`,
    })
    expect(remove.presentResult!({ search: SEARCH_REF }, okResult({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero saved search delete: declined, nothing written',
    })
    expect(remove.presentCall!({ search: SEARCH_REF })).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Delete Zotero saved search',
      rawInput: SEARCH_REF,
    })
    expect(remove.output.presentationMeta!({ search: SEARCH_REF }, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(update.output.presentationMeta!({ search: SEARCH_REF }, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(
      update.output.presentationMeta!(
        { search: SEARCH_REF },
        {
          kind: 'applied',
          ref: SERVED_SEARCH_REF,
          key: SEARCH_KEY,
          version: 8,
          name: 'Recent',
          conditions: [],
          libraryVersion: 8,
        },
      ),
    ).toEqual({
      kind: 'applied',
      ref: SERVED_SEARCH_REF,
      key: SEARCH_KEY,
      version: 8,
      libraryVersion: 8,
    })
    const rendered = update.output.render(
      { search: SEARCH_REF },
      { kind: 'applied', ref: SERVED_SEARCH_REF, key: SEARCH_KEY, libraryVersion: 8 },
    )[0] as { text: string }
    expect(rendered.text).toContain(
      `Zotero saved-search operation applied for ${SERVED_SEARCH_REF}.`,
    )
    expect(rendered.text).toContain('Library version: 8.')
    const renderedDelete = remove.output.render(
      { search: SEARCH_REF },
      { kind: 'deleted', key: SEARCH_KEY },
    )[0] as { text: string }
    expect(renderedDelete.text).toContain('operation completed for SEARCH01.')

    // A receipt carrying neither ref nor key must still name the subject
    // instead of rendering an empty sentence, and an absent library version
    // must not print a dangling "Library version" line.
    const bare = update.output.render({ search: SEARCH_REF }, { kind: 'applied' })[0] as {
      text: string
    }
    expect(bare.text).toBe('Zotero saved-search operation applied for the requested search.')
    expect(
      update.output.presentationMeta!(
        { search: SEARCH_REF },
        {
          kind: 'applied',
          ref: SERVED_SEARCH_REF,
          key: SEARCH_KEY,
          version: 8,
        },
      ),
    ).toEqual({ kind: 'applied', ref: SERVED_SEARCH_REF, key: SEARCH_KEY, version: 8 })
    expect(
      remove.output.presentationMeta!(
        { search: SEARCH_REF },
        {
          kind: 'deleted',
          ref: SERVED_SEARCH_REF,
          key: SEARCH_KEY,
        },
      ),
    ).toEqual({ kind: 'deleted', ref: SERVED_SEARCH_REF, key: SEARCH_KEY })
  })

  it('updates only the conditions when no name is given', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    serveSearchRead(lane, 7)
    lane.mock.route('PATCH', `/api/users/0/searches/${SEARCH_KEY}`, (_req, _res, h) =>
      h.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '8' }, ''),
    )

    const result = expectValue(
      await lane.runTool('zotero_update_saved_search', {
        search: SEARCH_REF,
        conditions: [{ condition: 'creator', operator: 'contains', value: 'Vaswani' }],
      }),
      'zotero_update_saved_search',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      name: 'Recent',
      conditions: [{ condition: 'creator', operator: 'contains', value: 'Vaswani' }],
    })
    const patch = lane.mock.requests.find((request) => request.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? 'null')).toEqual({
      conditions: [{ condition: 'creator', operator: 'contains', value: 'Vaswani' }],
    })
  })

  it('refuses an update that changes nothing before any PATCH', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    const result = await lane.runTool('zotero_update_saved_search', { search: SEARCH_REF })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses an empty condition list at creation', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    const result = await lane.runTool('zotero_create_saved_search', {
      name: 'Recent',
      conditions: [],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('reports a create whose saved state cannot be proven as committed-unverified', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    lane.mock.route('POST', '/api/users/0/searches', (_req, _res, h) =>
      h.json(
        {
          successful: { '0': { key: SEARCH_KEY, version: 8, data: { key: SEARCH_KEY } } },
          success: { '0': SEARCH_KEY },
          unchanged: {},
          failed: {},
        },
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '8' },
      ),
    )

    const result = expectValue(
      await lane.runTool('zotero_create_saved_search', {
        name: 'Recent',
        conditions: [{ condition: 'title', operator: 'contains', value: 'attention' }],
      }),
      'zotero_create_saved_search',
    )
    expect(result.value).toMatchObject({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
      key: SEARCH_KEY,
    })
  })

  it('refuses a delete whose read carried no version', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveIdentityAndGrant(lane)
    lane.mock.route('GET', `/api/users/0/searches/${SEARCH_KEY}`, (_req, _res, h) =>
      h.json(
        { key: SEARCH_KEY, data: { key: SEARCH_KEY, name: 'Recent', conditions: [] } },
        { 'Zotero-Server-ID': SERVER_ID },
      ),
    )
    const result = await lane.runTool('zotero_delete_saved_search', { search: SEARCH_REF })
    expect(result.isError).toBe(true)
    expect(lane.mock.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })
})

/** A settled result carrying the given presentation meta. */
function okResult(meta: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'x' }],
    isError: false,
    meta: meta as ToolResult['meta'],
  }
}
