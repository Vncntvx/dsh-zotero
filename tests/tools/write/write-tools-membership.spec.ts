import {
  WRITE_SERVER_ID as SERVER_ID,
  WRITE_ITEM_KEY as ITEM_KEY,
} from '../../helpers/server/keys.js'
import { describe, expect, it } from 'vitest'

import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'

import { expectValue } from '../../helpers/lanes/host-lane.js'

import {
  COLLECTION_KEY,
  ScriptedQuestions,
  bootLane,
  serveWrites,
  serveItem,
} from './support/write-tools.js'

describe('zotero_update_item_tags and zotero_update_item_collections', () => {
  it('merges tags into an item after approval, preserving existing tag types', async () => {
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
      await lane.runTool('zotero_update_item_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: [' new '],
      }),
      'zotero_update_item_tags',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      version: 12,
      tags: ['existing', 'new'],
      added: ['new'],
      removed: [],
      unchanged: false,
    })
    expect(patchBody).toEqual({ tags: [{ tag: 'existing', type: 1 }, { tag: 'new' }] })
  })

  it('removes tags and reports unchanged when nothing moves', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [{ tag: 'existing', type: 1 }] })
    lane.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }, ''),
    )
    const removing = expectValue(
      await lane.runTool('zotero_update_item_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        remove: ['existing'],
      }),
      'zotero_update_item_tags',
    )
    expect(removing.value).toMatchObject({ kind: 'applied', removed: ['existing'], tags: [] })
    const noop = expectValue(
      await lane.runTool('zotero_update_item_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: ['existing'],
      }),
      'zotero_update_item_tags',
    )
    expect(noop.value).toMatchObject({ kind: 'applied', unchanged: true, version: 10 })
    expect(lane.mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(1)
  })

  it('adds an item to a collection by name after approval', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [], collections: [] })
    lane.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '12' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_update_item_collections', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: ['方法论'],
      }),
      'zotero_update_item_collections',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      version: 12,
      unchanged: false,
      added: [`zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`],
    })
  })

  it('returns declined for the membership tools without writing', async () => {
    const lane = await bootLane({ writeEnabled: true })
    ScriptedQuestions.script.push(['Cancel', 'Cancel'])
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [] })
    const tagsResult = expectValue(
      await lane.runTool('zotero_update_item_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: [' new '],
      }),
      'zotero_update_item_tags',
    )
    expect(tagsResult.value).toEqual({ kind: 'declined' })
    const collectionResult = expectValue(
      await lane.runTool('zotero_update_item_collections', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: ['方法论'],
      }),
      'zotero_update_item_collections',
    )
    expect(collectionResult.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('returns declined for the membership tools when the user dismisses the plan review (ASK_CANCELLED)', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    serveItem(lane.mock, { tags: [] })
    ScriptedQuestions.rejection = new UserQuestionError(
      'the user cancelled ask_user_question',
      'ASK_CANCELLED',
    )
    const tagsResult = expectValue(
      await lane.runTool('zotero_update_item_tags', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: [' new '],
      }),
      'zotero_update_item_tags',
    )
    expect(tagsResult.value).toEqual({ kind: 'declined' })

    ScriptedQuestions.rejection = new UserQuestionError(
      'the user cancelled ask_user_question',
      'ASK_CANCELLED',
    )
    const collectionResult = expectValue(
      await lane.runTool('zotero_update_item_collections', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        add: ['方法论'],
      }),
      'zotero_update_item_collections',
    )
    expect(collectionResult.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
})
