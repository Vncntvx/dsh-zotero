import {
  WRITE_SERVER_ID as SERVER_ID,
  WRITE_ITEM_KEY as ITEM_KEY,
} from '../../helpers/server/keys.js'
import { describe, expect, it } from 'vitest'

import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'

import { expectValue } from '../../helpers/lanes/host-lane.js'

import type { Options } from '../../../src/config.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
} from '../../../src/errors.js'

import {
  NEW_KEY,
  COLLECTION_KEY,
  ScriptedQuestions,
  bootLane,
  serveWrites,
} from './support/write-tools.js'

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
    // No `callId`: that names a logged call whose ARGUMENTS hold the reviewed
    // plan, and a write tool's arguments hold the note body. Naming this call
    // made the client's plan panel look for a document that does not exist.
    expect(ask.questions[0]?.intent).toEqual({ kind: 'plan-review', approve: 'Apply' })
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
    ScriptedQuestions.rejection = new UserQuestionError(
      'the user cancelled ask_user_question',
      'ASK_CANCELLED',
    )
    // The stub throws the real UserQuestionError the ask() exit restores.
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('shows the plan card even when a stale entry still carries writeConfirm: false', async () => {
    // The confirmation has no off switch, and a leftover value in a profile
    // patch must not become one: the schema no longer knows the field, so the
    // card is shown and the write needs the user's approval as always.
    const legacy = { writeEnabled: true, writeConfirm: false } as unknown as Options
    const lane = await bootLane(legacy)
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const result = expectValue(
      await lane.runTool('zotero_create_note', { markdown: 'x' }),
      'zotero_create_note',
    )
    expect(result.value).toMatchObject({ kind: 'applied', key: NEW_KEY })
    expect(scripted.asks).toHaveLength(1)
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

  it('declares metadata parameters before markdown and guides argument generation order', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const note = lane.tool('zotero_create_note')!
    const props = (note.parameters as { properties?: Record<string, { description?: string }> })
      .properties
    expect(Object.keys(props ?? {})).toEqual([
      'parentItem',
      'collections',
      'tags',
      'sourceRefs',
      'markdown',
    ])
    expect(props?.parentItem?.description).toContain(
      'Provide metadata fields (parentItem, collections, tags, sourceRefs) before markdown in the arguments.',
    )
    await lane.teardown()
  })
})
