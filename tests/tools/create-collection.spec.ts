/**
 * `zotero_create_collection`: refusals before any POST (blank name, blank or
 * group parent), the parent shapes it assembles, and the receipt arms:
 * including both `committed-unverified` reasons the no-retry wording hangs
 * on.
 * @module tests/tools/create-collection
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { approvalLane } from '../helpers/approval-stub.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  writeLibraryUnsupportedMessage,
} from '../../src/errors.js'
import { writeNonBlankMessage } from '../../src/errors.js'

const PARENT_REF = 'zotero://user/0/collection/COLL1234'
const SERVER_ID = 'srv-create-collection-1'

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
  const result = await lane.runTool('zotero_create_collection', args)
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

const posts = (requests: readonly { method: string; pathname: string }[]): readonly string[] =>
  requests
    .filter((r) => r.method === 'POST' && r.pathname === '/api/users/0/collections')
    .map((r) => r.pathname)

describe('zotero_create_collection argument refusals', () => {
  it('refuses a blank name and a blank parent', async () => {
    expect(await refusal({ name: '   ' })).toContain(writeNonBlankMessage('name'))
    expect(await refusal({ name: 'Field notes', parent: '  ' })).toContain(
      writeNonBlankMessage('parent'),
    )
    expect(posts(lane.mock.requests)).toHaveLength(0)
  })

  it('refuses a group-library parent before the plan card', async () => {
    expect(
      await refusal({ name: 'Field notes', parent: 'zotero://group/7/collection/COLL1234' }),
    ).toContain(writeLibraryUnsupportedMessage({ type: 'group', id: 7 }))
    expect(posts(lane.mock.requests)).toHaveLength(0)
  })
})

describe('zotero_create_collection assembly', () => {
  const parents: Record<string, string> = {
    'a personal ref': PARENT_REF,
    'an exact name': 'Field notes',
  }
  for (const [shape, parent] of Object.entries(parents)) {
    it(`assembles the request with ${shape} and stops at the plan gate`, async () => {
      const lane2 = await approvalLane({ writeEnabled: true })
      try {
        const result = await lane2.runTool('zotero_create_collection', {
          name: 'Field notes',
          parent,
        })
        expect(result.isError).toBe(true)
        expect((result.content[0] as { text: string }).text).toContain(
          WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
        )
        expect(posts(lane2.mock.requests)).toHaveLength(0)
      } finally {
        await lane2.teardown()
      }
    })
  }
})

describe('zotero_create_collection presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_create_collection')
  const ARGS = { name: 'Field notes' }

  it('renders both unverified reasons, keyed and unkeyed', () => {
    const render = tool().output.render
    expect(render(ARGS, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })
    const keyed = render(ARGS, {
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      key: 'NEWCOLL1',
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(keyed.text).toContain('may have created the collection (key NEWCOLL1)')
    expect(keyed.text).toContain('reconcile the collection by its key/ref')
    const unkeyed = render(ARGS, {
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      ref: PARENT_REF,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(unkeyed.text).toContain(`created the collection (ref ${PARENT_REF})`)
    expect(unkeyed.text).toContain('could not be verified')
    const applied = render(ARGS, {
      kind: 'applied',
      ref: PARENT_REF,
      key: 'COLL1234',
      version: 50,
      name: 'Field notes',
      parentRef: PARENT_REF,
      libraryVersion: 50,
      serverId: SERVER_ID,
    })[0] as { text: string }
    expect(applied.text).toContain(`Created collection ${PARENT_REF} (version 50): Field notes.`)
    expect(applied.text).toContain(`Parent: ${PARENT_REF}`)
    expect(applied.text).toContain(`Library version: 50 (served by ${SERVER_ID})`)
    const plain = render(ARGS, {
      kind: 'applied',
      ref: PARENT_REF,
      key: 'COLL1234',
      version: 2,
      name: 'Field notes',
      libraryVersion: 2,
    })[0] as { text: string }
    expect(plain.text).not.toContain('Parent:')
    expect(plain.text).not.toContain('served by')
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    expect(present(ARGS, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection: declined, nothing written',
    })
    expect(present(ARGS, ok({ kind: 'committed-unverified', reason: 'commit-unknown' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection outcome unknown; do not retry',
    })
    expect(
      present(ARGS, ok({ kind: 'committed-unverified', reason: 'saved-state-unverified' })),
    ).toEqual({
      card: 'generic',
      title: 'Zotero collection created but not verified; do not retry',
    })
    expect(present(ARGS, ok({ kind: 'applied', ref: PARENT_REF }))).toEqual({
      card: 'generic',
      title: `Zotero collection created: ${PARENT_REF}`,
    })
    expect(present(ARGS, ok({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection created',
    })
    expect(
      present(ARGS, { content: [{ type: 'text', text: 'Error' }], isError: true }),
    ).toBeUndefined()
    expect(present(ARGS, ok('loose meta'))).toBeUndefined()
  })

  it('offers the pending card with the name, and projects the meta', () => {
    expect(tool().presentCall!(ARGS)).toEqual({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero collection',
      rawInput: 'Field notes',
    })
    const meta = tool().output.presentationMeta!
    expect(meta(ARGS, { kind: 'applied', ref: PARENT_REF, key: 'COLL1234', version: 5 })).toEqual({
      kind: 'applied',
      ref: PARENT_REF,
      key: 'COLL1234',
      version: 5,
    })
    expect(
      meta(ARGS, { kind: 'committed-unverified', reason: 'commit-unknown', key: 'NEWCOLL1' }),
    ).toEqual({ kind: 'committed-unverified', reason: 'commit-unknown', key: 'NEWCOLL1' })
    expect(meta(ARGS, { kind: 'committed-unverified', reason: 'saved-state-unverified' })).toEqual({
      kind: 'committed-unverified',
      reason: 'saved-state-unverified',
    })
    expect(meta(ARGS, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })
})
