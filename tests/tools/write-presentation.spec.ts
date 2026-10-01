import { describe, expect, it } from 'vitest'
import { approvalLane } from '../helpers/approval-stub.js'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { createNotePlan, renderCreateNote } from '../../src/tools/create-note.js'
import { updateItemTagsPlan, renderUpdateItemTags } from '../../src/tools/update-item-tags.js'
import {
  updateItemCollectionsPlan,
  renderUpdateItemCollections,
} from '../../src/tools/update-item-collections.js'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { ZOTERO_WRITE_APPROVAL_UNAVAILABLE } from '../../src/errors.js'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { Context, Service } from '@deepseek-ai/cordis'

/** An approval channel that always answers "Apply"; the ask is recorded. */
class ApprovingQuestions extends Service {
  readonly asks: {
    questions: {
      id: string
      detail?: string
      intent?: { kind: string; approve: string; callId?: unknown }
    }[]
    agent?: unknown
  }[] = []
  /** When set, the channel answers with these labels instead of "Apply". */
  answers: string[][] | undefined

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: {
    questions: {
      id: string
      detail?: string
      intent?: { kind: string; approve: string; callId?: unknown }
    }[]
    agent?: unknown
  }): Promise<unknown> {
    this.asks.push({ questions: request.questions, agent: request.agent })
    return {
      answers: request.questions.map((question, index) => ({
        id: question.id,
        selected: this.answers?.[index] ?? ['Apply'],
      })),
    }
  }
}

import { askPlanApproval } from '../../src/write-approval.js'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

const APPLIED_NOTE = {
  kind: 'applied' as const,
  ref: 'zotero://user/0/item/NEWNOTE01?server=srv',
  key: 'NEWNOTE01',
  version: 42,
  collections: ['zotero://user/0/collection/COLL1234'],
  tags: ['methods'],
  sourceRefs: ['zotero://user/0/item/SOURCE01?server=srv'],
  libraryVersion: 42,
  serverId: 'srv',
}

const APPLIED_TAGS = {
  kind: 'applied' as const,
  ref: 'zotero://user/0/item/ITEMABC1',
  version: 12,
  tags: ['a', 'b'],
  added: ['b'],
  removed: ['gone'],
  unchanged: false,
  libraryVersion: 12,
  serverId: 'srv',
}

const APPLIED_COLLECTIONS = {
  kind: 'applied' as const,
  ref: 'zotero://user/0/item/ITEMABC1',
  version: 13,
  collections: ['zotero://user/0/collection/COLL1234'],
  added: ['zotero://user/0/collection/COLL1234'],
  removed: [],
  unchanged: false,
  libraryVersion: 13,
  serverId: 'srv',
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}

function resultOf(meta: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: 'x' }], isError: false, meta } as unknown as ToolResult
}

describe('write tool renders', () => {
  it('renders an applied note with its saved collections, tags, and sources', () => {
    const text = textOf(renderCreateNote({ markdown: 'x' }, APPLIED_NOTE))
    expect(text).toContain(APPLIED_NOTE.ref)
    expect(text).toContain('zotero://user/0/collection/COLL1234')
    expect(text).toContain('Tags: methods')
    expect(text).toContain('Sources: ')
    expect(text).toContain('Library version: 42 (served by srv)')
  })

  it('renders an applied note with the optional parent and without empty lists', () => {
    const withParent = textOf(
      renderCreateNote(
        { markdown: 'x' },
        { ...APPLIED_NOTE, parentItem: 'zotero://user/0/item/ITEMABC1' },
      ),
    )
    expect(withParent).toContain('Parent: zotero://user/0/item/ITEMABC1')
    const bare = textOf(
      renderCreateNote(
        { markdown: 'x' },
        { ...APPLIED_NOTE, collections: [], tags: [], sourceRefs: [], serverId: undefined },
      ),
    )
    expect(bare).not.toContain('Collections:')
    expect(bare).not.toContain('Tags:')
    expect(bare).not.toContain('Sources:')
    expect(bare).not.toContain('(served by')
  })

  it('renders the declined outcome of every membership tool as a statement', () => {
    expect(textOf(renderCreateNote({ markdown: 'x' }, { kind: 'declined' }))).toContain('Declined')
    expect(textOf(renderUpdateItemTags({ ref: 'r', add: ['x'] }, { kind: 'declined' }))).toContain(
      'Declined',
    )
    expect(
      textOf(renderUpdateItemCollections({ ref: 'r', add: ['c'] }, { kind: 'declined' })),
    ).toContain('Declined')
  })

  it('renders the tag update with its unchanged, added, and removed arms', () => {
    const unchanged = textOf(
      renderUpdateItemTags(
        { ref: 'r', add: ['a'] },
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 10,
          tags: ['a'],
          added: [],
          removed: [],
          unchanged: true,
        },
      ),
    )
    expect(unchanged).toContain('No change')
    expect(unchanged).not.toContain('Library version:')
    const changed = textOf(renderUpdateItemTags({ ref: 'r', add: ['b'] }, APPLIED_TAGS))
    expect(changed).toContain('added b')
    expect(changed).toContain('removed gone')
    expect(changed).toContain('Tags now: a, b')
    expect(changed).toContain('Library version: 12 (served by srv)')
    const bareVersion = textOf(
      renderUpdateItemTags(
        { ref: 'r', add: ['b'] },
        { ...APPLIED_TAGS, libraryVersion: 11, serverId: undefined },
      ),
    )
    expect(bareVersion).toContain('Library version: 11')
    expect(bareVersion).not.toContain('(served by')
  })

  it('renders the collection membership update with its unchanged and changed arms', () => {
    const unchanged = textOf(
      renderUpdateItemCollections(
        { ref: 'r', add: ['Methods'] },
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 10,
          collections: ['zotero://user/0/collection/COLL1234'],
          added: [],
          removed: [],
          unchanged: true,
        },
      ),
    )
    expect(unchanged).toContain('No change')
    expect(unchanged).not.toContain('Library version:')
    const changed = textOf(
      renderUpdateItemCollections({ ref: 'r', add: ['Methods'] }, APPLIED_COLLECTIONS),
    )
    expect(changed).toContain('Updated collections on')
    expect(changed).toContain('Collections now: zotero://user/0/collection/COLL1234')
    expect(changed).toContain('Library version: 13 (served by srv)')
    const emptyLists = textOf(
      renderUpdateItemCollections(
        { ref: 'r', remove: ['Methods'] },
        { ...APPLIED_COLLECTIONS, collections: [], added: [], removed: [], libraryVersion: 14 },
      ),
    )
    expect(emptyLists).toContain('Collections now: (none)')
    expect(emptyLists).toContain('added (none)')
    expect(emptyLists).toContain('removed (none)')
  })

  it('builds the plan cards deterministically from the arguments', () => {
    const notePlan = createNotePlan({
      markdown: 'body',
      tags: ['a', 'b'],
      collections: ['Methods'],
    })
    expect(notePlan).toContain('- Tags: a, b')
    expect(notePlan).toContain('- Collections: Methods')
    expect(notePlan).toContain('- Kind: standalone note')
    expect(notePlan).toContain('- Sources: (none)')
    const childPlan = createNotePlan({
      markdown: 'body',
      parentItem: 'zotero://user/0/item/ITEMABC1',
      sourceRefs: ['zotero://user/0/item/SOURCE01'],
    })
    expect(childPlan).toContain('- Kind: child note under zotero://user/0/item/ITEMABC1')
    expect(childPlan).toContain('- Collections: (inherited from parent item)')
    expect(childPlan).toContain('- Sources: zotero://user/0/item/SOURCE01')
    // Even if a caller paints collections onto a child plan, the card must
    // describe inheritance — buildRequest refuses that combination on the
    // model path, and the domain refuses it on the non-tool path.
    const paintedChildPlan = createNotePlan({
      markdown: 'body',
      parentItem: 'zotero://user/0/item/ITEMABC1',
      collections: ['Methods'],
    })
    expect(paintedChildPlan).toContain('- Collections: (inherited from parent item)')
    expect(paintedChildPlan).not.toContain('Methods')

    const tagPlan = updateItemTagsPlan({
      ref: 'zotero://user/0/item/ITEMABC1',
      add: ['a'],
      remove: ['b'],
    })
    expect(tagPlan).toContain('- Tags to add: a')
    expect(tagPlan).toContain('- Tags to remove: b')
    expect(tagPlan).toContain('zotero://user/0/item/ITEMABC1')
    expect(tagPlan).toContain('version precondition')
    const emptyTagPlan = updateItemTagsPlan({ ref: 'r' })
    expect(emptyTagPlan).toContain('- Tags to add: (none)')
    expect(emptyTagPlan).toContain('- Tags to remove: (none)')

    const collectionPlan = updateItemCollectionsPlan({
      ref: 'zotero://user/0/item/ITEMABC1',
      add: ['Methods'],
      remove: ['Old'],
    })
    expect(collectionPlan).toContain('- Collections to add: Methods')
    expect(collectionPlan).toContain('- Collections to remove: Old')
    expect(collectionPlan).toContain('Names resolve before any write')
    const emptyCollectionPlan = updateItemCollectionsPlan({ ref: 'r' })
    expect(emptyCollectionPlan).toContain('- Collections to add: (none)')
    expect(emptyCollectionPlan).toContain('- Collections to remove: (none)')
  })
})

describe('approval-gate failure arms', () => {
  class AbortingQuestions extends Service {
    constructor(ctx: Context) {
      super(ctx, 'userQuestions')
    }

    async ask(): Promise<never> {
      throw new HarnessError('aborted by the UI', 'ASK_ABORTED')
    }
  }

  it('maps an aborted ask onto the harness abort code', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    await lane.ctx.plugin(AbortingQuestions)
    const result = await lane.runTool('zotero_create_note', { markdown: 'x' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect(result.error.info?.code).toBe('ABORTED')
    await lane.teardown()
  })

  it('renders the pending-call cards', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const note = lane.tool('zotero_create_note')!
    expect(note.presentCall?.({ markdown: 'x' })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero research note',
    })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(tags.presentCall?.({ ref: 'r', add: ['a'], remove: ['b'] })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item tags',
      rawInput: 'a, b',
    })
    const membership = lane.tool('zotero_update_item_collections')!
    expect(membership.presentCall?.({ ref: 'r', add: ['c'] })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item collections',
      rawInput: 'c',
    })
    await lane.teardown()
  })

  it('falls back to the generic title when the meta record lacks a ref, or is absent', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const note = lane.tool('zotero_create_note')!
    expect(
      note.presentResult?.({ markdown: 'x' }, {
        isError: false,
        meta: { kind: 'applied' },
      } as never),
    ).toEqual({
      card: 'generic',
      title: 'Zotero note created',
    })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(
      tags.presentResult?.({ ref: 'r', add: ['a'] }, {
        isError: false,
        meta: { kind: 'applied' },
      } as never),
    ).toEqual({
      card: 'generic',
      title: 'Zotero tags updated',
    })
    const membership = lane.tool('zotero_update_item_collections')!
    expect(
      membership.presentResult?.({ ref: 'r', add: ['c'] }, {
        isError: false,
        meta: { kind: 'applied' },
      } as never),
    ).toEqual({
      card: 'generic',
      title: 'Zotero membership updated',
    })
    expect(
      note.presentResult?.({ markdown: 'x' }, { isError: false, meta: undefined } as never),
    ).toBeUndefined()
    expect(
      tags.presentResult?.({ ref: 'r', add: ['a'] }, {
        isError: false,
        meta: undefined,
      } as never),
    ).toBeUndefined()
    expect(
      membership.presentResult?.({ ref: 'r', add: ['c'] }, {
        isError: false,
        meta: undefined,
      } as never),
    ).toBeUndefined()
    await lane.teardown()
  })

  it('covers the optional-libraryVersion arms of the applied-meta and render paths', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(
      tags.output.presentationMeta?.(
        {},
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 10,
          tags: ['a'],
          added: [],
          removed: [],
          unchanged: true,
        },
      ),
    ).toEqual({
      kind: 'applied',
      ref: 'zotero://user/0/item/ITEMABC1',
      version: 10,
      addedCount: 0,
      removedCount: 0,
    })
    expect(tags.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({ kind: 'declined' })
    await lane.teardown()
  })

  it('covers the ask-plan approval contract directly', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    await lane.ctx.plugin(ApprovingQuestions)
    const scripted = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    const agent = { id: 'agent-1' } as never
    const exec = {
      callId: 'call-plan-1',
      agent,
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    // The agent rides the request when present, and the answer names the card.
    const approved = await askPlanApproval(lane.ctx, { exec, plan: '- plan line' })
    expect(approved).toBe(true)
    expect(scripted.asks.at(-1)?.agent).toBe(agent)
    expect(scripted.asks.at(-1)?.questions[0]?.detail).toBe('- plan line')
    expect(scripted.asks.at(-1)?.questions[0]?.intent).toEqual({
      kind: 'plan-review',
      approve: 'Apply',
    })
    await lane.teardown()
  })

  it('answers false when the answer carries no selection', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    await lane.ctx.plugin(ApprovingQuestions)

    const scripted = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    scripted.answers = [[]]
    const approved = await askPlanApproval(lane.ctx, {
      exec: {
        signal: new AbortController().signal,
        name: 'zotero_create_note',
        callId: 'call-plan-2' as never,
      },
      plan: '- plan line',
    })
    expect(approved).toBe(false)
    await lane.teardown()
  })

  it('covers complete applied renderers with omitted optional fields', async () => {
    // Unchanged tag result: libraryVersion is absent when nothing was written.
    const sparse = textOf(
      renderUpdateItemTags(
        { ref: 'r', add: ['a'] },
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 10,
          tags: [],
          added: [],
          removed: [],
          unchanged: true,
        },
      ),
    )
    expect(sparse).toContain('No change')
    expect(sparse).not.toContain('Library version:')
    // Complete note result with empty lists and no optional parent/serverId.
    const bare = textOf(
      renderCreateNote(
        { markdown: 'x' },
        {
          kind: 'applied',
          ref: 'r',
          key: 'NEWNOTE1',
          version: 7,
          collections: [],
          tags: [],
          sourceRefs: [],
          libraryVersion: 7,
        },
      ),
    )
    expect(bare).toContain('Created note r (version 7).')
    // The plan preview truncates long markdown.
    const longPlan = createNotePlan({ markdown: 'x'.repeat(401) })
    expect(longPlan).toContain('…')
    expect(longPlan).not.toContain('xxxxx'.repeat(100))
  })

  it('projects complete applied outcomes into presentation meta', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(
      tags.output.presentationMeta?.(
        {},
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 12,
          tags: ['a'],
          added: ['a'],
          removed: ['b'],
          unchanged: false,
        },
      ),
    ).toEqual({
      kind: 'applied',
      ref: 'zotero://user/0/item/ITEMABC1',
      version: 12,
      addedCount: 1,
      removedCount: 1,
    })
    const membership = lane.tool('zotero_update_item_collections')!
    expect(
      membership.output.presentationMeta?.(
        {},
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 13,
          collections: ['zotero://user/0/collection/COLL1234'],
          added: ['zotero://user/0/collection/COLL1234'],
          removed: [],
          unchanged: false,
        },
      ),
    ).toEqual({
      kind: 'applied',
      ref: 'zotero://user/0/item/ITEMABC1',
      version: 13,
      addedCount: 1,
      removedCount: 0,
    })
    expect(membership.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    const note = lane.tool('zotero_create_note')!
    expect(
      note.output.presentationMeta?.(
        {},
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/NEWNOTE1',
          key: 'NEWNOTE1',
          version: 3,
          collections: [],
          tags: [],
          sourceRefs: [],
          libraryVersion: 3,
        },
      ),
    ).toEqual({
      kind: 'applied',
      ref: 'zotero://user/0/item/NEWNOTE1',
      key: 'NEWNOTE1',
      version: 3,
    })
    await lane.teardown()
  })

  it('maps the aborted ask, ASK_CANCELLED, and the empty answer through the approval contract', async () => {
    const aborting = {
      get: () => ({
        ask: async () => {
          throw new HarnessError('aborted by the UI', 'ASK_ABORTED')
        },
      }),
    }
    const exec = {
      callId: 'call-1',
      name: 'zotero_create_note',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await expect(
      askPlanApproval(aborting as unknown as Context, { exec, plan: '- plan' }),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
    const cancelled = {
      get: () => ({
        ask: async () => {
          throw new HarnessError('the user cancelled ask_user_question', 'ASK_CANCELLED')
        },
      }),
    }
    await expect(
      askPlanApproval(cancelled as unknown as Context, { exec, plan: '- plan' }),
    ).resolves.toBe(false)
    // The ask() exit path restores the real UserQuestionError instance.
    const restored = {
      get: () => ({
        ask: async () => {
          throw new UserQuestionError('cancel', 'ASK_CANCELLED')
        },
      }),
    }
    await expect(
      askPlanApproval(restored as unknown as Context, { exec, plan: '- plan' }),
    ).resolves.toBe(false)
    // A plain error carrying the code is not an ask settlement: fail closed.
    const rogue = {
      get: () => ({
        ask: async () => {
          throw Object.assign(new Error('cancel'), { code: 'ASK_CANCELLED' })
        },
      }),
    }
    await expect(
      askPlanApproval(rogue as unknown as Context, { exec, plan: '- plan' }),
    ).rejects.toMatchObject({ code: ZOTERO_WRITE_APPROVAL_UNAVAILABLE })
    const empty = { get: () => ({ ask: async () => ({ answers: [] }) }) }
    const approved = await askPlanApproval(empty as unknown as Context, { exec, plan: '- plan' })
    expect(approved).toBe(false)
  })

  it('reports the declined outcome per tool from the meta record', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const note = lane.tool('zotero_create_note')!
    expect(
      note.presentResult?.({ markdown: 'x' }, {
        isError: false,
        meta: { kind: 'declined' },
      } as never),
    ).toEqual({
      card: 'generic',
      title: 'Zotero note: declined, nothing written',
    })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(
      tags.presentResult?.({ ref: 'r', add: ['a'] }, {
        isError: false,
        meta: { kind: 'declined' },
      } as never),
    ).toEqual({
      card: 'generic',
      title: 'Zotero tags: declined, nothing written',
    })
    const membership = lane.tool('zotero_update_item_collections')!
    expect(
      membership.presentResult?.({ ref: 'r', add: ['c'] }, {
        isError: false,
        meta: { kind: 'declined' },
      } as never),
    ).toEqual({
      card: 'generic',
      title: 'Zotero membership: declined, nothing written',
    })
    await lane.teardown()
  })
})

describe('write tool presentation records', () => {
  it('projects the presentation meta per outcome and the card per meta record', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const note = lane.tool('zotero_create_note')!
    expect(note.output.presentationMeta?.({}, APPLIED_NOTE)).toEqual({
      kind: 'applied',
      ref: APPLIED_NOTE.ref,
      key: APPLIED_NOTE.key,
      version: 42,
    })
    expect(note.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({ kind: 'declined' })
    expect(note.presentResult?.({ markdown: 'x' }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero note: declined, nothing written',
    })
    expect(
      note.presentResult?.({ markdown: 'x' }, resultOf({ kind: 'applied', ref: APPLIED_NOTE.ref })),
    ).toEqual({
      card: 'generic',
      title: `Zotero note created: ${APPLIED_NOTE.ref}`,
    })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(tags.presentResult?.({ ref: 'r', add: ['a'] }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero tags: declined, nothing written',
    })
    expect(
      tags.presentResult?.({ ref: 'r', add: ['a'] }, resultOf({ kind: 'applied', ref: 'r' })),
    ).toEqual({
      card: 'generic',
      title: 'Zotero tags updated: r',
    })
    const membership = lane.tool('zotero_update_item_collections')!
    expect(
      membership.presentResult?.({ ref: 'r', add: ['c'] }, resultOf({ kind: 'applied', ref: 'r' })),
    ).toEqual({
      card: 'generic',
      title: 'Zotero membership updated: r',
    })
    await lane.teardown()
  })

  it('wires the pending-call cards', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const note = lane.tool('zotero_create_note')!
    expect(note.presentCall?.({ markdown: 'x' })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero research note',
    })
    const tags = lane.tool('zotero_update_item_tags')!
    expect(tags.presentCall?.({ ref: 'r', add: ['a'] })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item tags',
    })
    await lane.teardown()
  })

  it('enforces the note and list bounds before the approval gate', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const tooLong = await lane.runTool('zotero_create_note', { markdown: 'x'.repeat(65_537) })
    expect(tooLong.isError).toBe(true)
    if (!tooLong.isError) throw new Error('unreachable')
    expect(tooLong.error.message).toContain('65536-character bound')
    const emptySelection = await lane.runTool('zotero_update_item_tags', {
      ref: 'zotero://user/0/item/ITEMABC1',
    })
    expect(emptySelection.isError).toBe(true)
    if (!emptySelection.isError) throw new Error('unreachable')
    expect(emptySelection.error.message).toContain('at least one entry between them')
    const tooManyTags = await lane.runTool('zotero_update_item_tags', {
      ref: 'zotero://user/0/item/ITEMABC1',
      add: Array.from({ length: 51 }, (_, index) => `t${index}`),
    })
    expect(tooManyTags.isError).toBe(true)
    if (!tooManyTags.isError) throw new Error('unreachable')
    expect(tooManyTags.error.message).toContain('more than 50 items')
    const tooManyCollections = await lane.runTool('zotero_create_note', {
      markdown: 'x',
      collections: Array.from({ length: 51 }, (_, index) => `c${index}`),
    })
    expect(tooManyCollections.isError).toBe(true)
    if (!tooManyCollections.isError) throw new Error('unreachable')
    expect(tooManyCollections.error.message).toContain('more than 50 items')
    const sourceArms = await lane.runTool('zotero_create_note', {
      markdown: 'x',
      sourceRefs: ['zotero://user/0/item/SOURCE01'],
    })
    expect(sourceArms.isError).toBe(true)
    if (!sourceArms.isError) throw new Error('unreachable')
    expect(sourceArms.error.message).toContain('plan-review could not be asked')
    await lane.teardown()
  })
})
