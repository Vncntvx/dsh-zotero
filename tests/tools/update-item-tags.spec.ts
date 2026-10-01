/**
 * `zotero_update_item_tags`, the tag tool: every refusal before a PATCH
 * exists (empty selection, over-limit combined lists, blank entries, group
 * targets), the one-read-one-write receipt arms the model reads back, and
 * the card titles for each settle state.
 * @module tests/tools/update-item-tags
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  writeLibraryUnsupportedMessage,
  writeListTooLongMessage,
} from '../../src/errors.js'
import { nonBlankArgumentMessage } from '../../src/tools/validate.js'

const ITEM_REF = 'zotero://user/0/item/ITEMABC1'
const SERVER_ID = 'srv-update-tags-1'

let lane: HostLane

beforeEach(async () => {
  lane = await setupHostLane({ writeEnabled: true })
})

afterEach(async () => {
  await lane.teardown()
})

/** The registered definition, or a loud failure naming the missing tool. */
function definition(name: string): ToolDefinition {
  const tool = lane.tool(name)
  if (tool === undefined) throw new Error(`tool ${name} not registered`)
  return tool
}

/** The model-facing text of a refused call. */
async function refusal(args: Record<string, unknown>): Promise<string> {
  const result = await lane.runTool('zotero_update_item_tags', args)
  if (!result.isError) throw new Error('expected the call to be refused')
  return (result.content[0] as { text: string }).text
}

/** A settled result carrying the given presentation meta. */
function ok(meta: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'x' }],
    isError: false,
    meta: meta as ToolResult['meta'],
  }
}

const patches = (requests: readonly { method: string }[]): readonly { method: string }[] =>
  requests.filter((r) => r.method === 'PATCH')

describe('zotero_update_item_tags argument refusals', () => {
  it('refuses a selection that changes nothing, however it is spelled', async () => {
    expect(await refusal({ ref: ITEM_REF, add: [], remove: [] })).toContain(
      WRITE_LIST_SELECTION_MESSAGE,
    )
    expect(await refusal({ ref: ITEM_REF })).toContain(WRITE_LIST_SELECTION_MESSAGE)
    expect(patches(lane.mock.requests)).toHaveLength(0)
  })

  it('refuses a combined selection over the list limit, naming both lists', async () => {
    const add = Array.from({ length: 30 }, (_, i) => `add-${i}`)
    const remove = Array.from({ length: 21 }, (_, i) => `remove-${i}`)
    expect(await refusal({ ref: ITEM_REF, add, remove })).toContain(
      writeListTooLongMessage('add and remove', 50),
    )
    expect(
      await refusal({ ref: ITEM_REF, remove: Array.from({ length: 51 }, (_, i) => `x${i}`) }),
    ).toContain(writeListTooLongMessage('remove', 50))
    expect(patches(lane.mock.requests)).toHaveLength(0)
  })

  it('refuses blank entries and group-library targets before any write', async () => {
    expect(await refusal({ ref: ITEM_REF, remove: ['  '] })).toContain(
      nonBlankArgumentMessage('remove'),
    )
    expect(await refusal({ ref: 'zotero://group/7/item/ITEMABC1', add: ['a'] })).toContain(
      writeLibraryUnsupportedMessage({ type: 'group', id: 7 }),
    )
    expect(patches(lane.mock.requests)).toHaveLength(0)
  })
})

describe('zotero_update_item_tags presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_update_item_tags')

  it('renders each settle arm, including one-sided and unchanged writes', () => {
    const render = tool().output.render
    expect(render({ ref: ITEM_REF }, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })
    expect(
      (
        render(
          { ref: ITEM_REF },
          {
            kind: 'applied',
            ref: ITEM_REF,
            version: 9,
            tags: ['acceptance'],
            added: [],
            removed: ['to-read'],
            unchanged: false,
            libraryVersion: 9,
            serverId: SERVER_ID,
          },
        )[0] as { text: string }
      ).text,
    ).toContain(`Updated tags on ${ITEM_REF} (version 9); added (none); removed to-read.`)
    expect(
      (
        render(
          { ref: ITEM_REF },
          {
            kind: 'applied',
            ref: ITEM_REF,
            version: 4,
            tags: [],
            added: ['acceptance'],
            removed: [],
            unchanged: false,
            libraryVersion: 4,
          },
        )[0] as { text: string }
      ).text,
    ).toContain('Library version: 4')
    expect(
      (
        render(
          { ref: ITEM_REF },
          {
            kind: 'applied',
            ref: ITEM_REF,
            version: 4,
            tags: ['acceptance'],
            added: [],
            removed: [],
            unchanged: true,
          },
        )[0] as { text: string }
      ).text,
    ).toContain(`No change: ${ITEM_REF} already carries the requested tag set (version 4).`)
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    const ARGS = { ref: ITEM_REF, add: ['acceptance'] }
    expect(present(ARGS, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero tags: declined, nothing written',
    })
    expect(present(ARGS, ok({ kind: 'applied', ref: ITEM_REF }))).toEqual({
      card: 'generic',
      title: `Zotero tags updated: ${ITEM_REF}`,
    })
    expect(present(ARGS, ok({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero tags updated',
    })
    expect(
      present(ARGS, { content: [{ type: 'text', text: 'Error' }], isError: true }),
    ).toBeUndefined()
    expect(present(ARGS, ok('loose meta'))).toBeUndefined()
  })

  it('offers the pending card from whichever list the caller named', () => {
    expect(tool().presentCall!({ ref: ITEM_REF, add: ['acceptance'] })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item tags',
      rawInput: 'acceptance',
    })
    expect(tool().presentCall!({ ref: ITEM_REF, remove: ['to-read'] })).toMatchObject({
      rawInput: 'to-read',
    })
  })

  it('projects the meta the card reads', () => {
    const meta = tool().output.presentationMeta!
    expect(
      meta(
        { ref: ITEM_REF },
        {
          kind: 'applied',
          ref: ITEM_REF,
          version: 5,
          tags: [],
          added: ['a'],
          removed: ['b'],
          unchanged: false,
        },
      ),
    ).toEqual({ kind: 'applied', ref: ITEM_REF, version: 5, addedCount: 1, removedCount: 1 })
    expect(meta({ ref: ITEM_REF }, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })
})
