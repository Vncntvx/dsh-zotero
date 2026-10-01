/**
 * `zotero_delete_library_tags`, the other irreversible one: refusals before
 * any DELETE (empty list, over limit, blank names), the best-effort preview
 * whose rows may carry no count and whose listing may miss a requested name,
 * and the receipt and card arms.
 * @module tests/tools/delete-library-tags
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { serveJson } from '../helpers/server/serve.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  writeListEmptyMessage,
  writeListTooLongMessage,
} from '../../src/errors.js'
import { nonBlankArgumentMessage } from '../../src/tools/validate.js'

const SERVER_ID = 'srv-delete-tags-1'

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
  const result = await lane.runTool('zotero_delete_library_tags', args)
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

describe('zotero_delete_library_tags argument refusals', () => {
  it('refuses an empty selection and an over-limit one', async () => {
    expect(await refusal({ tags: [] })).toContain(writeListEmptyMessage('tags'))
    expect(await refusal({ tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`) })).toContain(
      writeListTooLongMessage('tags', 50),
    )
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })

  it('refuses blank tag names', async () => {
    expect(await refusal({ tags: ['   '] })).toContain(nonBlankArgumentMessage('tags'))
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })
})

describe('zotero_delete_library_tags preview', () => {
  it('counts what the listing carries, treats a countless row as zero, and names what it never saw', async () => {
    // The preview listing: one row without a count, one with, and the request
    // also names a tag the listing does not carry — the plan has to say so
    // before the irreversible delete, and a failed gate must still send no
    // DELETE.
    serveJson(
      lane.mock,
      '/api/users/0/items/top/tags',
      [{ tag: 'methods' }, { tag: 'legacy', numItems: 3 }],
      { 'Total-Results': '2', 'Zotero-Server-ID': SERVER_ID },
    )
    const result = await lane.runTool('zotero_delete_library_tags', {
      tags: ['methods', 'ghost'],
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
    )
    const preview = lane.mock.requests.find((r) => r.pathname === '/api/users/0/items/top/tags')
    expect(preview).toBeDefined()
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })
})

describe('zotero_delete_library_tags presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_delete_library_tags')
  const ARGS = { tags: ['methods'] }

  it('renders the receipt with and without a served-by line', () => {
    const render = tool().output.render
    expect(render(ARGS, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })
    const served = render(ARGS, {
      kind: 'deleted',
      deletedTags: ['legacy', 'methods'],
      libraryVersion: 89,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(served.text).toContain('Deleted 2 tags library-wide: legacy, methods.')
    expect(served.text).toContain(`Library version: 89 (served by ${SERVER_ID})`)
    const unserved = render(ARGS, {
      kind: 'deleted',
      deletedTags: ['methods'],
      libraryVersion: 5,
    })[0] as { text: string }
    expect(unserved.text).toContain('Library version: 5')
    expect(unserved.text).not.toContain('served by')
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    expect(present(ARGS, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero tags delete: declined, nothing written',
    })
    expect(present(ARGS, ok({ kind: 'deleted', deletedTags: ['methods'] }))).toEqual({
      card: 'generic',
      title: 'Zotero library tags deleted',
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
      title: 'Delete Zotero library tags',
      rawInput: 'methods',
    })
    const meta = tool().output.presentationMeta!
    expect(meta(ARGS, { kind: 'deleted', deletedTags: ['a', 'b'] })).toEqual({
      kind: 'deleted',
      deletedCount: 2,
    })
    expect(meta(ARGS, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })
})
