/**
 * `zotero_batch_items`, the unified batch engine: argument refusals before
 * any write exists, the aggregated plan markdown it renders (including the
 * top-level deletion warning), the receipt arms, presentation projections,
 * and the delete previews. Execution through the approval seam runs against
 * the host lane in `./batch-execution.spec.ts`.
 * @module tests/tools/batch-items
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, type ToolDefinition, type ToolResult } from '@deepseek-ai/dsh-tools'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_UNEXPECTED,
  ZoteroError,
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  WRITE_LIST_SELECTION_MESSAGE,
  writeLibraryUnsupportedMessage,
  writeListTooLongMessage,
  writeNonBlankMessage,
  writeItemTypeUnsupportedMessage,
} from '../../src/errors.js'
import { resolveConfig } from '../../src/config.js'
import { ApprovingQuestions, resetApprovalStub, StubApproval } from '../helpers/approval-stub.js'
import {
  batchItemsPlan,
  buildBatchItemsRequest,
  previewBatchItems,
  type DeleteItemPreview,
} from '../../src/tools/batch-items.js'
import { presentBatchItemsResultView } from '../../src/tools/write-present.js'
import type { ZoteroService } from '../../src/service.js'

const ITEM_REF_1 = 'zotero://user/0/item/ITEMABC1'
const ITEM_REF_2 = 'zotero://user/0/item/ITEMABC2'
const ITEM_REF_3 = 'zotero://user/0/item/ITEMABC3'
const ITEM_REF_4 = 'zotero://user/0/item/ITEMABC4'

let lane: HostLane

beforeEach(async () => {
  resetApprovalStub()
  lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
})

afterEach(async () => {
  await lane.teardown()
})

function definition(name: string): ToolDefinition {
  const tool = lane.tool(name)
  if (tool === undefined) throw new Error(`tool ${name} not registered`)
  return tool
}

async function refusal(args: Record<string, unknown>): Promise<string> {
  const result = await lane.runTool('zotero_batch_items', args)
  if (!result.isError) throw new Error('expected the call to be refused')
  return (result.content[0] as { text: string }).text
}

function ok(meta: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'x' }],
    isError: false,
    meta: meta as ToolResult['meta'],
  }
}

describe('zotero_batch_items argument refusals', () => {
  it('refuses an empty call with no operations', async () => {
    expect(await refusal({})).toContain(WRITE_LIST_SELECTION_MESSAGE)
    expect(await refusal({ create: [], update: [], delete: [] })).toContain(
      WRITE_LIST_SELECTION_MESSAGE,
    )
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('refuses total operations over the limit', async () => {
    const deletes = Array.from({ length: 51 }, (_, i) => `zotero://user/0/item/DEL000${i}`)
    expect(await refusal({ delete: deletes })).toContain(writeListTooLongMessage('batch items', 50))
  })

  it('refuses group-library targets for update and delete', async () => {
    expect(await refusal({ delete: ['zotero://group/1/item/GRP00001'] })).toContain(
      writeLibraryUnsupportedMessage({ type: 'group', id: 1 }),
    )
    expect(
      await refusal({
        update: [{ ref: 'zotero://group/1/item/GRP00001', addTags: ['test'] }],
      }),
    ).toContain(writeLibraryUnsupportedMessage({ type: 'group', id: 1 }))
  })

  it('refuses invalid creatable item types', async () => {
    expect(
      await refusal({
        create: [{ itemType: 'unsupportedType', title: 'Paper' }],
      }),
    ).toContain(writeItemTypeUnsupportedMessage('unsupportedType'))
  })

  it('refuses create entries with neither title nor url', async () => {
    expect(
      await refusal({
        create: [{ itemType: 'journalArticle', date: '2026' }],
      }),
    ).toContain(WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE)
  })

  it('refuses update entries with no tag or collection changes', async () => {
    expect(
      await refusal({
        update: [{ ref: ITEM_REF_1, addTags: [] }],
      }),
    ).toContain(WRITE_LIST_SELECTION_MESSAGE)
  })

  it('refuses blank fields in entries', async () => {
    expect(
      await refusal({
        create: [{ itemType: 'book', title: '   ' }],
      }),
    ).toContain(WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE)
    expect(
      await refusal({
        update: [{ ref: ITEM_REF_1, addTags: ['   '] }],
      }),
    ).toContain(writeNonBlankMessage('addTags'))
  })
})

describe('zotero_batch_items plan generation', () => {
  it('renders prominent deletion warnings at the top when deletes are present', () => {
    const previews: DeleteItemPreview[] = [
      { ref: ITEM_REF_1, title: 'Deep Learning Review', childCount: 2 },
      { ref: ITEM_REF_2, childCount: 1 },
    ]
    const plan = batchItemsPlan(
      {
        delete: [ITEM_REF_1, ITEM_REF_2],
        create: [{ itemType: 'journalArticle', title: 'New Paper' }],
        update: [
          {
            ref: ITEM_REF_3,
            addTags: ['survey'],
            removeTags: ['old'],
            addCollections: ['Project'],
            removeCollections: ['Archive'],
          },
          { ref: ITEM_REF_4 },
        ],
      },
      previews,
    )
    expect(plan).toContain('### Deletions (2 items)')
    expect(plan).toContain('are moved to Zotero Trash')
    expect(plan).toContain('Deep Learning Review')
    expect(plan).toContain('2 notes/attachments')
    expect(plan).toContain('1 note/attachment')
    expect(plan).toContain('### Create items (1 item)')
    expect(plan).toContain('New Paper')
    expect(plan).toContain('### Update items (2 items)')
    expect(plan).toContain('survey')
    expect(plan).toContain('old')
    expect(plan).toContain('Collections to join: Project')
    expect(plan).toContain('Collections to leave: Archive')
    expect(plan).toContain('+col: Project')
    expect(plan).toContain('-col: Archive')
    // The host's plan view escapes raw HTML, so a collapse tag would render
    // as text instead of folding anything.
    expect(plan).not.toContain('<details')
    expect(plan).not.toContain('<summary')
  })

  it('discloses every field and destination for all eleven creates', () => {
    const create = Array.from({ length: 11 }, (_, index) => ({
      itemType: 'book',
      title: `Book ${index}`,
      url: `https://example.org/${index}`,
      date: '2026',
      doi: '10.1000/test',
      abstractNote: 'Full abstract\n```markdown\ncomplete',
      publicationTitle: 'Venue',
      creators: [{ creatorType: 'editor', name: 'Research team' }],
      tags: ['reviewed'],
      collections: ['Project collection'],
    }))
    const plan = batchItemsPlan({ create })
    for (const [index, input] of create.entries()) {
      expect(plan).toContain(`Create index ${index}`)
      expect(plan).toContain(JSON.stringify(input, null, 2))
    }
    expect(plan).toContain('````json')
    expect(plan).not.toContain('... and')
  })

  it('omits deletion section when no deletes are requested', () => {
    const plan = batchItemsPlan({
      create: [{ itemType: 'book', title: 'Some Book' }],
      update: [{ ref: ITEM_REF_1, addTags: ['nlp'] }],
    })
    expect(plan).not.toContain('### Deletions')
    expect(plan).toContain('### Create items (1 item)')
    expect(plan).toContain('### Update items (1 item)')
  })

  it('lists only the list operations the updates actually carry', () => {
    const collection = 'zotero://user/0/collection/COLLABC1'
    const plan = batchItemsPlan({
      update: [
        { ref: ITEM_REF_1, removeTags: ['stale'], addCollections: [collection] },
        { ref: ITEM_REF_3, removeCollections: [collection] },
      ],
    })
    expect(plan).toContain('- Tags to remove: stale')
    expect(plan).not.toContain('- Tags to add:')
    expect(plan).toContain(`- Collections to join: ${collection}`)
    expect(plan).toContain(`- Collections to leave: ${collection}`)
  })

  it('renders an empty plan and deletion targets whose preview is unknown', () => {
    expect(batchItemsPlan({})).toContain('Total operations: 0')
    const plan = batchItemsPlan({ delete: [ITEM_REF_1] })
    expect(plan).toContain(`\`${ITEM_REF_1}\`:`)
    expect(plan).not.toContain('undefined')
  })
})

describe('zotero_batch_items presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_batch_items')

  it('renders each settle arm, including declined and partial failures', () => {
    const render = tool().output.render
    expect(render({}, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })

    const appliedText = (
      render(
        {},
        {
          kind: 'applied',
          total: 3,
          created: [
            {
              index: 0,
              ref: ITEM_REF_1,
              key: 'ITEMABC1',
              version: 1,
              itemType: 'journalArticle',
              title: 'Paper 1',
            },
          ],
          updated: [
            {
              ref: ITEM_REF_2,
              version: 2,
              addedTags: ['a'],
              removedTags: [],
              addedCollections: [],
              removedCollections: [],
              unchanged: false,
            },
          ],
          deleted: [
            {
              ref: 'zotero://user/0/item/ITEMDEL1',
              key: 'ITEMDEL1',
              deleted: true,
              version: 3,
              children: [],
            },
          ],
          failed: [],
          unverified: [],
          libraryVersion: 10,
        },
      )[0] as { text: string }
    ).text

    expect(appliedText).toContain('Batch items applied: 1 created, 1 updated, 1 trashed.')
    expect(appliedText).toContain(ITEM_REF_1)
    expect(appliedText).toContain('Paper 1')
    expect(appliedText).toContain('Library version: 10')
  })

  it('renders URL-only creates, acknowledged Trash progress, descendants, and unchanged updates', () => {
    const text = (
      tool().output.render(
        {},
        {
          kind: 'applied',
          total: 4,
          created: [
            {
              index: 0,
              ref: ITEM_REF_1,
              key: 'ITEMABC1',
              version: 4,
              itemType: 'webpage',
              url: 'https://example.org',
            },
          ],
          updated: [
            {
              ref: ITEM_REF_2,
              version: 5,
              addedTags: [],
              removedTags: [],
              addedCollections: [],
              removedCollections: [],
              unchanged: true,
            },
          ],
          deleted: [
            {
              ref: ITEM_REF_3,
              key: 'ITEMABC3',
              deleted: true,
              version: 6,
              children: ['zotero://user/0/item/CHILD0001'],
            },
          ],
          failed: [
            {
              op: 'delete',
              ref: ITEM_REF_2,
              code: 'ZOTERO_WRITE_CONFLICT',
              message: 'version changed',
              completedRefs: ['zotero://user/0/item/CHILD0002'],
            },
            { op: 'create', index: 1, code: 'ZOTERO_INVALID_ARGUMENT', message: 'refused' },
          ],
          unverified: [],
        },
      )[0] as { text: string }
    ).text
    expect(text).toContain('https://example.org')
    expect(text).toContain('acknowledged Trash writes: zotero://user/0/item/CHILD0002')
    expect(text).toContain('Trashed:')
    expect(text).toContain('zotero://user/0/item/CHILD0001')
    expect(text).toContain('1 of 1 updates resulted in no change')
    expect(text).toContain('index 1')
    expect(presentBatchItemsResultView(ok(undefined))).toBeUndefined()
    expect(
      presentBatchItemsResultView(ok({ kind: 'applied', failedCount: 1, unverifiedCount: 0 })),
    ).toMatchObject({ title: expect.stringContaining('1 failed') })
  })

  it('renders partial unverified receipts and persists identity for reconciliation', () => {
    const value = {
      kind: 'applied',
      total: 2,
      created: [
        {
          index: 0,
          ref: ITEM_REF_1,
          key: 'ITEMABC1',
          itemType: 'book',
          version: 5,
          title: 'Verified',
        },
      ],
      updated: [],
      deleted: [],
      failed: [],
      unverified: [
        {
          op: 'create',
          index: 1,
          committed: true,
          retryable: false,
          reason: 'saved-state-unverified',
          key: 'ITEMABC2',
          ref: ITEM_REF_2,
          serverId: 'server',
        },
      ],
    }
    const text = (tool().output.render({}, value)[0] as { text: string }).text
    expect(text).toContain(ITEM_REF_1)
    expect(text).toContain(ITEM_REF_2)
    expect(text).toContain('do not retry')
    expect(tool().output.presentationMeta!({}, value)).toMatchObject({
      created: value.created,
      unverified: value.unverified,
      unverifiedCount: 1,
    })
    expect(tool().presentResult!({}, ok({ kind: 'applied', unverifiedCount: 1 }))).toMatchObject({
      title: expect.stringContaining('unverified; do not retry'),
    })
  })

  it('names the card for each settle state', () => {
    const present = tool().presentResult!
    expect(present({}, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero batch items: declined, nothing written',
    })
    expect(
      present(
        {},
        ok({
          kind: 'applied',
          createdCount: 2,
          updatedCount: 3,
          deletedCount: 1,
        }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero batch items applied: 2 created, 3 updated, 1 trashed',
    })
  })

  it('offers the pending card describing operation counts', () => {
    expect(
      tool().presentCall!({
        create: [{ itemType: 'book', title: 'B' }],
        update: [{ ref: ITEM_REF_1, addTags: ['t'] }],
        delete: [ITEM_REF_2],
      }),
    ).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Batch item operations',
      rawInput: '1 creates, 1 updates, 1 deletes',
    })
    expect(tool().presentCall!({})).toMatchObject({ rawInput: '0 creates, 0 updates, 0 deletes' })
  })

  it('projects the presentation meta', () => {
    const meta = tool().output.presentationMeta!
    expect(
      meta(
        {},
        {
          kind: 'applied',
          total: 2,
          created: [
            {
              index: 0,
              ref: ITEM_REF_1,
              key: 'ITEMABC1',
              version: 1,
              itemType: 'book',
            },
          ],
          updated: [],
          deleted: [{ ref: ITEM_REF_2, key: 'ITEMABC2', deleted: true, version: 2, children: [] }],
          failed: [],
          unverified: [],
        },
      ),
    ).toEqual({
      kind: 'applied',
      createdCount: 1,
      created: [{ index: 0, ref: ITEM_REF_1, key: 'ITEMABC1', version: 1, itemType: 'book' }],
      unverified: [],
      unverifiedCount: 0,
      updatedCount: 0,
      deletedCount: 1,
      failedCount: 0,
    })
    expect(meta({}, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })
})

describe('zotero_batch_items request construction and previews', () => {
  it('normalizes every create and update field before approval', () => {
    const request = buildBatchItemsRequest(
      {
        create: [
          {
            itemType: 'book',
            title: 'Book',
            url: 'https://example.org/book',
            date: '2026',
            doi: '10.1000/example',
            abstractNote: 'Abstract',
            publicationTitle: 'Publisher',
            creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
            tags: ['reviewed'],
            collections: ['Project'],
          },
        ],
        update: [
          {
            ref: ITEM_REF_1,
            addTags: ['new'],
            removeTags: [],
            addCollections: ['Project'],
            removeCollections: [],
          },
          {
            ref: ITEM_REF_2,
            addTags: ['another'],
            removeTags: ['old'],
            addCollections: ['Project'],
            removeCollections: ['Archive'],
          },
        ],
        delete: [ITEM_REF_2],
      },
      resolveConfig({}),
    )
    expect(request).toEqual({
      create: [
        {
          itemType: 'book',
          title: 'Book',
          url: 'https://example.org/book',
          date: '2026',
          doi: '10.1000/example',
          abstractNote: 'Abstract',
          publicationTitle: 'Publisher',
          creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
          tags: ['reviewed'],
          collections: ['Project'],
        },
      ],
      update: [
        {
          ref: expect.objectContaining({ key: 'ITEMABC1' }),
          addTags: ['new'],
          addCollections: ['Project'],
        },
        {
          ref: expect.objectContaining({ key: 'ITEMABC2' }),
          addTags: ['another'],
          removeTags: ['old'],
          addCollections: ['Project'],
          removeCollections: ['Archive'],
        },
      ],
      delete: [expect.objectContaining({ key: 'ITEMABC2' })],
    })
    expect(
      buildBatchItemsRequest(
        { update: [{ ref: ITEM_REF_3, removeTags: ['stale'] }] },
        resolveConfig({}),
      ),
    ).toMatchObject({ update: [{ ref: expect.objectContaining({ key: 'ITEMABC3' }) }] })
    expect(
      buildBatchItemsRequest(
        { create: [{ itemType: 'webpage', url: 'https://example.org' }] },
        resolveConfig({}),
      ),
    ).toMatchObject({ create: [{ itemType: 'webpage', url: 'https://example.org' }] })
  })

  it('previews each deletion, keeping missing targets and child counts explicit', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        title: 'First item',
        attachments: { total: 2 },
        notes: { total: 1 },
      })
      // Zero children, reported through the notes collection alone: the count
      // must not invent an attachments listing the server never sent.
      .mockResolvedValueOnce({ notes: { total: 0 } })
      .mockRejectedValueOnce(new ZoteroError('missing', ZOTERO_NOT_FOUND))
    const service = { get } as unknown as ZoteroService
    const previews = await previewBatchItems(
      service,
      [ITEM_REF_1, ITEM_REF_2, ITEM_REF_3],
      undefined,
    )
    expect(previews).toEqual([
      { ref: ITEM_REF_1, title: 'First item', childCount: 3 },
      { ref: ITEM_REF_2, title: undefined, childCount: 0 },
      { ref: ITEM_REF_3 },
    ])
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('drops only the child count when the target itself is gone or ambiguous', async () => {
    // The child count is the preview's one advisory field, so a gone or
    // ambiguous target degrades it to undefined — the same closed rule
    // `degradable.ts` states — while the rest of the preview survives.
    const get = vi.fn().mockResolvedValue({ title: 'An item' })
    const service = { get } as unknown as ZoteroService
    const previews = await previewBatchItems(service, [ITEM_REF_1], undefined)
    expect(previews).toEqual([{ ref: ITEM_REF_1, title: 'An item', childCount: undefined }])
  })

  it('does not hide non-degradable preview failures', async () => {
    const service = {
      get: vi.fn().mockRejectedValue(new ZoteroError('protocol changed', ZOTERO_UNEXPECTED)),
    } as unknown as ZoteroService
    await expect(previewBatchItems(service, [ITEM_REF_1], undefined)).rejects.toMatchObject({
      code: ZOTERO_UNEXPECTED,
    })
  })

  it('does not swallow a transport failure of the child-count read', async () => {
    // The regression this locks: the child-count read used to fail into a
    // bare `catch {}`, so a timeout or a transport error silently under-
    // reported the deletion's blast radius and the user approved a plan
    // that claimed fewer children than the item has.
    const get = vi.fn().mockRejectedValue(new Error('children unavailable'))
    const service = { get } as unknown as ZoteroService
    await expect(previewBatchItems(service, [ITEM_REF_1], undefined)).rejects.toThrow(
      'children unavailable',
    )
  })

  it('reports caller cancellation as the harness abort even when only the child read failed', async () => {
    // Cancellation outranks every degradation rule: a cancelled call must
    // surface as TOOL_ABORTED, never as a plan card with a missing count.
    const caller = new AbortController()
    caller.abort()
    const get = vi.fn().mockRejectedValue(new Error('late failure'))
    const service = { get } as unknown as ZoteroService
    await expect(previewBatchItems(service, [ITEM_REF_1], caller.signal)).rejects.toBeInstanceOf(
      HarnessError,
    )
    await expect(previewBatchItems(service, [ITEM_REF_1], caller.signal)).rejects.toMatchObject({
      code: TOOL_ABORTED,
    })
  })
})
