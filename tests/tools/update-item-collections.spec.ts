/**
 * `zotero_update_item_collections`, the membership tool: every refusal before
 * a PATCH exists (empty selection, over-limit lists, blank entries, group
 * targets), the assembly of add-only / remove-only / both shapes, and the
 * receipt and card arms the model reads back.
 * @module tests/tools/update-item-collections
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { approvalLane } from '../helpers/approval-stub.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  WRITE_LIST_SELECTION_MESSAGE,
  writeLibraryUnsupportedMessage,
  writeListTooLongMessage,
} from '../../src/errors.js'
import { nonBlankArgumentMessage } from '../../src/tools/validate.js'

const ITEM_REF = 'zotero://user/0/item/ITEMABC1'
const ADD_REF = 'zotero://user/0/collection/NEWCOLL1'
const REMOVE_REF = 'zotero://user/0/collection/OLDCOLL1'
const SERVER_ID = 'srv-update-collections-1'

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
  const result = await lane.runTool('zotero_update_item_collections', args)
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

describe('zotero_update_item_collections argument refusals', () => {
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
      await refusal({ ref: ITEM_REF, add: Array.from({ length: 51 }, (_, i) => `x${i}`) }),
    ).toContain(writeListTooLongMessage('add', 50))
    expect(patches(lane.mock.requests)).toHaveLength(0)
  })

  it('refuses blank entries and group-library targets before any write', async () => {
    expect(await refusal({ ref: ITEM_REF, add: ['   '] })).toContain(nonBlankArgumentMessage('add'))
    expect(
      await refusal({ ref: ITEM_REF, add: ['zotero://group/7/collection/OLDCOLL1'] }),
    ).toContain(writeLibraryUnsupportedMessage({ type: 'group', id: 7 }))
    expect(patches(lane.mock.requests)).toHaveLength(0)
  })
})

describe('zotero_update_item_collections assembly', () => {
  // The plan card has no channel in this lane, so every assembled shape
  // settles at the confirmation gate: the request was built, nothing patched.
  const cases: Record<string, Record<string, unknown>> = {
    'add-only': { ref: ITEM_REF, add: [ADD_REF] },
    'remove-only': { ref: ITEM_REF, remove: [REMOVE_REF] },
    'add and remove': { ref: ITEM_REF, add: [ADD_REF], remove: [REMOVE_REF] },
  }
  for (const [shape, args] of Object.entries(cases)) {
    it(`assembles the ${shape} shape and still stops at the plan gate`, async () => {
      const lane2 = await approvalLane({ writeEnabled: true })
      try {
        const result = await lane2.runTool('zotero_update_item_collections', args)
        expect(result.isError).toBe(true)
        expect((result.content[0] as { text: string }).text).toContain(
          WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
        )
        expect(patches(lane2.mock.requests)).toHaveLength(0)
      } finally {
        await lane2.teardown()
      }
    })
  }
})

describe('zotero_update_item_collections presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_update_item_collections')

  it('renders each settle arm, including one-sided changes', () => {
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
            collections: [ADD_REF],
            added: [],
            removed: ['old'],
            unchanged: false,
            libraryVersion: 9,
            serverId: SERVER_ID,
          },
        )[0] as { text: string }
      ).text,
    ).toContain(`Updated collections on ${ITEM_REF} (version 9); added (none); removed old.`)
    expect(
      (
        render(
          { ref: ITEM_REF },
          {
            kind: 'applied',
            ref: ITEM_REF,
            version: 4,
            collections: [],
            added: [ADD_REF],
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
            collections: [],
            added: [],
            removed: [],
            unchanged: true,
            libraryVersion: 4,
          },
        )[0] as { text: string }
      ).text,
    ).toContain(`No change: ${ITEM_REF} already carries the requested membership (version 4).`)
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    const ARGS = { ref: ITEM_REF, add: [ADD_REF] }
    expect(present(ARGS, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero membership: declined, nothing written',
    })
    expect(present(ARGS, ok({ kind: 'applied', ref: ITEM_REF }))).toEqual({
      card: 'generic',
      title: `Zotero membership updated: ${ITEM_REF}`,
    })
    expect(present(ARGS, ok({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero membership updated',
    })
    expect(
      present(ARGS, { content: [{ type: 'text', text: 'Error' }], isError: true }),
    ).toBeUndefined()
    expect(present(ARGS, ok('loose meta'))).toBeUndefined()
  })

  it('offers the pending card from whichever list the caller named', () => {
    expect(tool().presentCall!({ ref: ITEM_REF, remove: ['old'] })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item collections',
      rawInput: 'old',
    })
    expect(tool().presentCall!({ ref: ITEM_REF, add: [ADD_REF] })).toMatchObject({
      rawInput: ADD_REF,
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
          collections: [],
          added: ['a'],
          removed: [],
          unchanged: false,
        },
      ),
    ).toEqual({ kind: 'applied', ref: ITEM_REF, version: 5, addedCount: 1, removedCount: 0 })
    expect(meta({ ref: ITEM_REF }, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })
})
