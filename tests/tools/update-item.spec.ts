/**
 * `zotero_update_item`, the metadata correction tool: every refusal its
 * argument layer raises before a PATCH exists (empty `set`, unknown field,
 * blank value), the plan it shows, the receipt arms, and the card titles:
 * including the arm that claims nothing when the meta never arrived.
 * @module tests/tools/update-item
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { approvalLane } from '../helpers/approval-stub.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  writeLibraryUnsupportedMessage,
  writeListEmptyMessage,
  writeNonBlankMessage,
} from '../../src/errors.js'
import { updateItemPlan } from '../../src/tools/update-item.js'

const REF = 'zotero://user/0/item/ITEMABC1'
const SERVER_ID = 'srv-update-item-1'

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
  const result = await lane.runTool('zotero_update_item', args)
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

describe('zotero_update_item argument refusals', () => {
  it('refuses an empty field set, named per shape', async () => {
    expect(await refusal({ ref: REF, set: {} })).toContain(writeListEmptyMessage('set'))
    expect(lane.mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
  })

  it('refuses an absent set at the parameter schema, before any tool body', async () => {
    expect(await refusal({ ref: REF })).toContain('missing required property "set"')
    expect(lane.mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
  })

  it('refuses a field outside the closed set at the parameter schema', async () => {
    // The schema's `set` is `additionalProperties: false` over exactly the
    // updatable fields, so an undeclared name never reaches the request body.
    const text = await refusal({ ref: REF, set: { abstractNotes: 'x' } })
    expect(text).toContain('"set.abstractNotes"')
    expect(text).toContain('additionalProperties: false')
    expect(lane.mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
  })

  it('refuses a blank field value', async () => {
    expect(await refusal({ ref: REF, set: { date: '   ' } })).toContain(
      writeNonBlankMessage('set.date'),
    )
    expect(lane.mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
  })

  it('refuses a group-library ref: the write domain is personal-library only', async () => {
    expect(
      await refusal({ ref: 'zotero://group/7/item/ITEMABC1', set: { date: '2026' } }),
    ).toContain(writeLibraryUnsupportedMessage({ type: 'group', id: 7 }))
    expect(lane.mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
  })
})

describe('updateItemPlan', () => {
  it('lists each field it is about to set', () => {
    const plan = updateItemPlan({ ref: REF, set: { title: '  New title  ', date: '2026' } })
    expect(plan).toContain('- Item: zotero://user/0/item/ITEMABC1')
    expect(plan).toContain('- title: New title')
    expect(plan).toContain('- date: 2026')
    expect(plan).toContain('an invalid field refuses the write before any PATCH')
  })

  it('states no fields when the caller sent an empty set', () => {
    const plan = updateItemPlan({ ref: REF, set: {} })
    expect(plan).not.toContain('- title:')
    expect(plan).not.toContain('- date:')
    expect(plan).toContain('- Item: zotero://user/0/item/ITEMABC1')
  })
})

describe('zotero_update_item presentation', () => {
  const ARGS = { ref: REF, set: { date: '2026' } }
  const tool = (): ToolDefinition => definition('zotero_update_item')

  it('renders the receipt with and without a served-by line', () => {
    const served = tool().output.render(ARGS, {
      kind: 'applied',
      ref: REF,
      version: 21,
      changed: ['title', 'date'],
      libraryVersion: 21,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(served.text).toContain(`Updated ${REF} (version 21); changed title, date.`)
    expect(served.text).toContain(`Library version: 21 (served by ${SERVER_ID})`)
    const unserved = tool().output.render(
      { ref: REF },
      {
        kind: 'applied',
        ref: REF,
        version: 4,
        changed: ['date'],
        libraryVersion: 4,
      },
    )[0] as { text: string }
    expect(unserved.text).toContain('Library version: 4')
    expect(unserved.text).not.toContain('served by')
    expect(tool().output.render(ARGS, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    expect(present(ARGS, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero item: declined, nothing written',
    })
    expect(present(ARGS, ok({ kind: 'applied', ref: REF }))).toEqual({
      card: 'generic',
      title: `Zotero item updated: ${REF}`,
    })
    expect(present(ARGS, ok({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero item updated',
    })
    // Error and non-object meta are the only no-claim arms: the generic card
    // takes over rather than repeating a title the meta never earned.
    expect(
      present(ARGS, { content: [{ type: 'text', text: 'Error' }], isError: true }),
    ).toBeUndefined()
    expect(present(ARGS, ok('loose meta'))).toBeUndefined()
  })

  it('projects the meta the card reads', () => {
    expect(
      tool().output.presentationMeta!(ARGS, {
        kind: 'applied',
        ref: REF,
        version: 7,
        changed: ['date'],
        libraryVersion: 7,
      }),
    ).toEqual({ kind: 'applied', ref: REF, version: 7, changedCount: 1 })
    expect(tool().output.presentationMeta!(ARGS, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
  })

  it('offers the pending card with the ref', () => {
    expect(tool().presentCall!({ ref: REF, set: { date: '2026' } })).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item',
      rawInput: REF,
    })
  })
})

describe('zotero_update_item approval boundary', () => {
  it('refuses the assembled write before any PATCH when the plan card has no channel', async () => {
    const lane2 = await approvalLane({ writeEnabled: true })
    try {
      const result = await lane2.runTool('zotero_update_item', {
        ref: REF,
        set: { date: '2026' },
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain(
        WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
      )
      expect(lane2.mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
    } finally {
      await lane2.teardown()
    }
  })
})
