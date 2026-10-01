/**
 * `zotero_delete_collection`: the irreversible one. Refusals before any
 * DELETE (blank or group target), the best-effort preview whose failed reads
 * leave counts unknown instead of blocking, the receipt arms, and the card
 * titles.
 * @module tests/tools/delete-collection
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  writeLibraryUnsupportedMessage,
} from '../../src/errors.js'
import { deleteCollectionPlan } from '../../src/tools/delete-collection.js'
import { writeNonBlankMessage } from '../../src/errors.js'

const COLLECTION_REF = 'zotero://user/0/collection/ABCD1234'
const SERVER_ID = 'srv-delete-collection-1'

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
  const result = await lane.runTool('zotero_delete_collection', args)
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

const deletes = (requests: readonly { method: string }[]): readonly { method: string }[] =>
  requests.filter((r) => r.method === 'DELETE')

describe('zotero_delete_collection argument refusals', () => {
  it('refuses a blank target and a group-library ref', async () => {
    expect(await refusal({ collection: '  ' })).toContain(writeNonBlankMessage('collection'))
    expect(await refusal({ collection: 'zotero://group/7/collection/ABCD1234' })).toContain(
      writeLibraryUnsupportedMessage({ type: 'group', id: 7 }),
    )
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })
})

describe('zotero_delete_collection preview', () => {
  it('leaves both counts unknown when the preview reads fail, then stops at the plan gate', async () => {
    // No preview routes are registered: the item search and the child listing
    // both fail, and the plan the card would show carries `unknown` for both
    // counts rather than a refusal.
    const result = await lane.runTool('zotero_delete_collection', {
      collection: COLLECTION_REF,
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
    )
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })

  it('states both counts when the preview reads succeed, and unknown when they do not', () => {
    expect(deleteCollectionPlan({ collection: 'Field notes' })).toContain(
      '- Items in this collection: unknown (they stay in the library, membership only)',
    )
    expect(deleteCollectionPlan({ collection: 'Field notes' })).toContain(
      '- Child collections: unknown (they are deleted with the parent)',
    )
    expect(
      deleteCollectionPlan({ collection: 'Field notes' }, { itemTotal: 3, childTotal: 2 }),
    ).toContain('- Items in this collection: 3 (they stay in the library, membership only)')
    expect(
      deleteCollectionPlan({ collection: 'Field notes' }, { itemTotal: 3, childTotal: 2 }),
    ).toContain('- Child collections: 2 (they are deleted with the parent)')
  })
})

describe('zotero_delete_collection presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_delete_collection')
  const ARGS = { collection: 'Field notes' }

  it('renders the receipt with and without a served-by line', () => {
    const render = tool().output.render
    expect(render(ARGS, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })
    const served = render(ARGS, {
      kind: 'deleted',
      ref: COLLECTION_REF,
      key: 'ABCD1234',
      deleted: true,
      libraryVersion: 88,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(served.text).toContain(`Deleted collection ${COLLECTION_REF}.`)
    expect(served.text).toContain(`Library version: 88 (served by ${SERVER_ID})`)
    const unserved = render(ARGS, {
      kind: 'deleted',
      ref: COLLECTION_REF,
      key: 'ABCD1234',
      deleted: true,
      libraryVersion: 4,
    })[0] as { text: string }
    expect(unserved.text).toContain('Library version: 4')
    expect(unserved.text).not.toContain('served by')
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    expect(present(ARGS, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection delete: declined, nothing written',
    })
    expect(present(ARGS, ok({ kind: 'deleted', ref: COLLECTION_REF }))).toEqual({
      card: 'generic',
      title: `Zotero collection deleted: ${COLLECTION_REF}`,
    })
    expect(present(ARGS, ok({ kind: 'deleted' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection deleted',
    })
    expect(
      present(ARGS, { content: [{ type: 'text', text: 'Error' }], isError: true }),
    ).toBeUndefined()
    expect(present(ARGS, ok('loose meta'))).toBeUndefined()
  })

  it('offers the pending card and projects the meta the card reads', () => {
    expect(tool().presentCall!(ARGS)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Delete Zotero collection',
      rawInput: 'Field notes',
    })
    const meta = tool().output.presentationMeta!
    expect(meta(ARGS, { kind: 'deleted', ref: COLLECTION_REF, key: 'ABCD1234' })).toEqual({
      kind: 'deleted',
      ref: COLLECTION_REF,
      key: 'ABCD1234',
    })
    expect(meta(ARGS, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })
})
