import { WRITE_ITEM_KEY as ITEM_KEY } from '../../helpers/server/keys.js'
import { describe, expect, it } from 'vitest'

import { WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'

import { ScriptedQuestions, bootLane, serveWrites } from './support/write-tools.js'

describe('write tool argument validation', () => {
  it('refuses non-empty collections on a child note before the plan card', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)
    const result = await lane.runTool('zotero_create_note', {
      markdown: 'x',
      parentItem: `zotero://user/0/item/${ITEM_KEY}`,
      collections: ['方法论'],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe('INVALID_ARGS')
    expect(result.error.message).toBe(`invalid arguments: ${WRITE_CHILD_COLLECTIONS_MESSAGE}`)
    expect(scripted.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
  it('refuses over-limit or empty selections before any plan or network', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)
    const overLimit = await lane.runTool('zotero_update_item_tags', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      add: Array.from({ length: 51 }, (_, index) => `tag-${index}`),
    })
    expect(overLimit.isError).toBe(true)
    const empty = await lane.runTool('zotero_update_item_tags', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
    })
    expect(empty.isError).toBe(true)
    if (!empty.isError) throw new Error('unreachable')
    expect(empty.error.info?.code).toBe('INVALID_ARGS')
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses blank markdown, tags, or collections on create_note before the plan card', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    serveWrites(lane.mock)

    const blankMd = await lane.runTool('zotero_create_note', { markdown: '   ' })
    expect(blankMd.isError).toBe(true)
    if (!blankMd.isError) throw new Error('unreachable')
    expect(blankMd.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    const blankTag = await lane.runTool('zotero_create_note', { markdown: 'valid', tags: ['   '] })
    expect(blankTag.isError).toBe(true)
    if (!blankTag.isError) throw new Error('unreachable')
    expect(blankTag.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    const blankColl = await lane.runTool('zotero_create_note', {
      markdown: 'valid',
      collections: ['   '],
    })
    expect(blankColl.isError).toBe(true)
    if (!blankColl.isError) throw new Error('unreachable')
    expect(blankColl.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    expect(scripted.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('refuses blank selections on the membership tools before the plan card', async () => {
    const lane = await bootLane({ writeEnabled: true })
    serveWrites(lane.mock)

    const blankTag = await lane.runTool('zotero_update_item_tags', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      add: ['   '],
    })
    expect(blankTag.isError).toBe(true)
    if (!blankTag.isError) throw new Error('unreachable')
    expect(blankTag.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    const blankColl = await lane.runTool('zotero_update_item_collections', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      remove: ['   '],
    })
    expect(blankColl.isError).toBe(true)
    if (!blankColl.isError) throw new Error('unreachable')
    expect(blankColl.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)

    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })

  it('refuses group-library write refs before showing a plan', async () => {
    const lane = await bootLane({ writeEnabled: true })
    const scripted = lane.ctx.get('userQuestions') as unknown as ScriptedQuestions
    const groupRef = 'zotero://group/55/item/ITEMABC1'
    const cases = [
      ['zotero_create_note', { markdown: 'x', parentItem: groupRef }],
      [
        'zotero_create_note',
        { markdown: 'x', collections: ['zotero://group/55/collection/COLL1234'] },
      ],
      ['zotero_update_item_tags', { ref: groupRef, add: ['review'] }],
      [
        'zotero_update_item_collections',
        { ref: groupRef, add: ['zotero://group/55/collection/COLL1234'] },
      ],
      ['zotero_update_item', { ref: groupRef, set: { title: 'T' } }],
    ] as const
    for (const [name, args] of cases) {
      const result = await lane.runTool(name, args)
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect(result.error.info?.code).toBe(ZOTERO_INVALID_ARGUMENT)
    }
    expect(scripted.asks).toHaveLength(0)
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(lane.mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
})
