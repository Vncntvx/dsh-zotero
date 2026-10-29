/**
 * `zotero_delete_collection`: the irreversible one. Refusals before any
 * DELETE (blank or group target), the best-effort preview whose failed reads
 * leave counts unknown instead of blocking, the receipt arms, and the card
 * titles.
 * @module tests/tools/write/delete-collection
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../../helpers/lanes/host-lane.js'
import { approvalLane, resetApprovalStub, ApprovingQuestions } from '../../helpers/approval-stub.js'
import {
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  writeLibraryUnsupportedMessage,
} from '../../../src/errors.js'
import { deleteCollectionPlan } from '../../../src/tools/delete-collection.js'
import { writeNonBlankMessage } from '../../../src/errors.js'

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
  it('leaves both counts unknown when the target does not exist, then stops at the plan gate', async () => {
    // The item search and the child listing both answer 404, the two misses the
    // preview is allowed to degrade: the plan the card would show carries
    // `unknown` for both counts rather than a refusal.
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234/items/top', (_req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234/collections', (_req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found'),
    )
    const result = await lane.runTool('zotero_delete_collection', {
      collection: COLLECTION_REF,
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
    )
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })

  it('rethrows a non-degradable child-listing failure instead of rendering unknown', async () => {
    // The child-collection read answers 500 — a protocol/server fault, not an
    // inconclusive target — so the preview must not fold it into an "unknown"
    // radius and ask the user to approve the delete anyway.
    const headers = { 'Zotero-Server-ID': SERVER_ID }
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234', (_req, res, helpers) =>
      helpers.json(
        { key: 'ABCD1234', version: 3, data: { key: 'ABCD1234', name: 'Target' } },
        headers,
      ),
    )
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234/collections', (_req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    const result = await lane.runTool('zotero_delete_collection', {
      collection: COLLECTION_REF,
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('ZOTERO_UNEXPECTED')
    expect(JSON.stringify(result)).not.toContain(WRITE_APPROVAL_UNAVAILABLE_MESSAGE)
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })

  it('degrades an ambiguous name to unknown counts instead of refusing the call', async () => {
    // Two collections share the requested name: the scope resolver reports
    // ZOTERO_SCOPE_AMBIGUOUS, the other miss the preview may degrade.
    lane.mock.route('GET', '/api/users/0/collections', (_req, res, helpers) => {
      helpers.json(
        [
          { key: 'COLL1111', data: { name: 'My Target' } },
          { key: 'COLL2222', data: { name: 'My Target' } },
        ],
        { 'Total-Results': '2', 'Zotero-Server-ID': SERVER_ID },
      )
    })
    const result = await lane.runTool('zotero_delete_collection', { collection: 'My Target' })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(
      WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
    )
    expect(deletes(lane.mock.requests)).toHaveLength(0)
  })

  it('rethrows a preview deadline instead of degrading it to an unknown plan', async () => {
    // A deadline is a real fault, not an inconclusive preview: the call must
    // surface ZOTERO_TIMEOUT rather than ask the user to approve a plan whose
    // radius reads "unknown".
    await lane.teardown()
    lane = await setupHostLane({ writeEnabled: true, timeoutMs: 20 })
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234', (_req, _res, helpers) => {
      helpers.delayJson({ key: 'ABCD1234', data: { name: 'Target' } }, 200, {
        'Zotero-Server-ID': SERVER_ID,
      })
    })
    const result = await lane.runTool('zotero_delete_collection', {
      collection: COLLECTION_REF,
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('ZOTERO_TIMEOUT')
    expect(JSON.stringify(result)).not.toContain(WRITE_APPROVAL_UNAVAILABLE_MESSAGE)
  })

  it('reports caller cancellation as the harness abort instead of a plan', async () => {
    // The caller cancelled mid-preview: cancellation outranks the best-effort
    // degradation, so the user is never asked to approve a plan for a call that
    // was already abandoned, and the harness reports its own TOOL_ABORTED.
    const caller = new AbortController()
    const definition = lane.tool('zotero_delete_collection')!
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234', (req, res, helpers) => {
      caller.abort()
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
    })
    const batch = await lane.ctx.tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: 'tool-aborted-preview' as never,
          name: definition.name,
          arguments: JSON.stringify({ collection: COLLECTION_REF }),
        },
      ],
      signal: caller.signal,
      agent: {} as never,
    })
    const result = batch.results[0]!.result
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain(TOOL_ABORTED)
    expect(JSON.stringify(result)).not.toContain(WRITE_APPROVAL_UNAVAILABLE_MESSAGE)
  })

  it('reports the harness abort even when the late failure was a mere miss', async () => {
    // The harder cancellation shape: the caller's signal is already aborted
    // when the preview read fails with something *other* than a miss — here a
    // 500, which the degrade rule would rethrow as a domain error. The abort
    // still wins, because the harness must render its own TOOL_ABORTED for a
    // cancelled call, and the 500 rides along as the error's cause.
    const caller = new AbortController()
    caller.abort()
    const definition = lane.tool('zotero_delete_collection')!
    lane.mock.route('GET', '/api/users/0/collections/ABCD1234', (_req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    const batch = await lane.ctx.tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: 'tool-late-fault-after-abort' as never,
          name: definition.name,
          arguments: JSON.stringify({ collection: COLLECTION_REF }),
        },
      ],
      signal: caller.signal,
      agent: {} as never,
    })
    const result = batch.results[0]!.result
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain(TOOL_ABORTED)
    // A protocol fault must not be laundered into an approval prompt either.
    expect(JSON.stringify(result)).not.toContain(WRITE_APPROVAL_UNAVAILABLE_MESSAGE)
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

  it('resolves childTotal in preview when collection is referenced by name', async () => {
    await lane.teardown()
    lane = await approvalLane({ writeEnabled: true })
    resetApprovalStub()
    await lane.ctx.plugin(ApprovingQuestions)
    const scripted = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions

    lane.mock.route('GET', '/api/users/0/collections', (_req, res, helpers) => {
      helpers.json([{ key: 'COLL9999', data: { name: 'My Target' } }], {
        'Total-Results': '1',
        'Zotero-Server-ID': SERVER_ID,
      })
    })
    lane.mock.route('GET', '/api/users/0/collections/COLL9999/items/top', (_req, res, helpers) => {
      helpers.json(
        [
          {
            key: 'ITEM1111',
            version: 1,
            data: { key: 'ITEM1111', itemType: 'journalArticle', title: 'T' },
          },
        ],
        { 'Total-Results': '5', 'Zotero-Server-ID': SERVER_ID },
      )
    })
    lane.mock.route(
      'GET',
      '/api/users/0/collections/COLL9999/collections',
      (_req, res, helpers) => {
        helpers.json(
          [
            { key: 'SUB11111', data: { name: 'Sub 1' } },
            { key: 'SUB22222', data: { name: 'Sub 2' } },
          ],
          { 'Total-Results': '2', 'Zotero-Server-ID': SERVER_ID },
        )
      },
    )
    lane.mock.route('GET', '/api/users/0/collections/COLL9999', (_req, res, helpers) => {
      helpers.json(
        { key: 'COLL9999', version: 10, data: { name: 'My Target' } },
        {
          'Zotero-Server-ID': SERVER_ID,
        },
      )
    })
    lane.mock.route('DELETE', '/api/users/0/collections/COLL9999', (_req, res, helpers) => {
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '11' }, '')
    })

    await lane.runTool('zotero_delete_collection', { collection: 'My Target' })
    expect(scripted.asks).toHaveLength(1)
    const plan = scripted.asks[0]?.questions[0]?.detail
    expect(plan).toContain('- Items in this collection: 5')
    expect(plan).toContain('- Child collections: 2')
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
