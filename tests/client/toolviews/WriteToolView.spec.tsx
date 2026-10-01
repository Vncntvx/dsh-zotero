// @vitest-environment jsdom
/**
 * Test suite for WriteToolView — the eight write cards:
 * write receipts (note, tags, membership, collection, item, library tags),
 * plan-review decline banners, committed-unverified warnings,
 * error state rendering, and running states.
 * @module tests/client/toolviews/WriteToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { WriteToolView } from '../../../src/client/toolviews/WriteToolView.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { running, settled } from '../helpers/blocks.ts'
import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

type WriteName =
  | 'zotero_create_note'
  | 'zotero_update_item_tags'
  | 'zotero_update_item_collections'
  | 'zotero_create_collection'
  | 'zotero_delete_collection'
  | 'zotero_create_item'
  | 'zotero_update_item'
  | 'zotero_delete_library_tags'

const REF = 'zotero://user/0/item/ABCD1234'

/** One settled write block: the call, its projection meta, and the rendered text. */
function settledWrite(
  toolName: WriteName,
  {
    args,
    meta,
    text = '',
    isError = false,
  }: {
    readonly args: Record<string, unknown>
    readonly meta?: Record<string, unknown>
    readonly text?: string
    readonly isError?: boolean
  },
): ToolCallPhaseProps['block'] {
  return settled({
    call: { name: toolName, argsRaw: JSON.stringify(args) },
    ...(meta === undefined ? {} : { meta }),
    isError,
    content: isError && text === '' ? [] : [{ type: 'text', text }],
  })
}

function renderWrite(
  toolName: WriteName,
  block: ToolCallPhaseProps['block'],
  expanded = true,
): ReturnType<typeof render> {
  return render(
    <WriteToolView
      {...createToolViewProps({
        callId: 'c1',
        toolName,
        phase: 'phase' in block ? block.phase : 'result',
        block,
        useDisclosure: mockUseDisclosure(expanded),
        t: mockT,
      })}
    />,
  )
}

describe('WriteToolView (create_note)', () => {
  it('renders a note receipt with note title and parent link from real contract args', () => {
    const block = settledWrite('zotero_create_note', {
      args: {
        markdown: '# Meeting Notes 2026\nDiscussion on AI agents.',
        parentItem: REF,
      },
      text: 'Created note zotero://user/0/item/NOTE1234',
    })

    const { container } = renderWrite('zotero_create_note', block)

    expect(screen.getByText(zh.toolTitleCreateNote)).toBeTruthy()
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryCreateNote', { title: 'Meeting Notes 2026' })).length,
    ).toBeGreaterThanOrEqual(1)

    const parentLink = container.querySelector('a[href^="zotero://select/"]')
    expect(parentLink?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
  })

  it('falls back to the default title for a titleless or malformed note call', () => {
    const empty = settledWrite('zotero_create_note', { args: {} })
    renderWrite('zotero_create_note', empty)
    expect(
      screen.getAllByText(mockT('toolSummaryCreateNote', { title: mockT('toolDefaultNoteTitle') }))
        .length,
    ).toBeGreaterThanOrEqual(1)
    cleanup()

    const malformed = settled({
      call: { name: 'zotero_create_note', argsRaw: '{bad-json' },
      content: [{ type: 'text', text: 'Created' }],
    })
    renderWrite('zotero_create_note', malformed)
    expect(
      screen.getAllByText(mockT('toolSummaryCreateNote', { title: mockT('toolDefaultNoteTitle') }))
        .length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders a committed-unverified note as a warning receipt, never a green OK', () => {
    const reasonText =
      'Zotero committed the note (key NOTE1234), but its saved state could not be verified. Do not retry; reconcile the note by its key/ref.'
    const block = settledWrite('zotero_create_note', {
      args: { markdown: '# Reading note' },
      meta: { kind: 'committed-unverified', reason: 'saved-state-unverified', key: 'NOTE1234' },
      text: reasonText,
    })

    const { container } = renderWrite('zotero_create_note', block)

    expect(container.querySelector('[data-tool]')?.getAttribute('data-state')).toBe('unverified')
    // The collapsed line carries the label; the expanded body carries only the
    // tool's own sentence, so the wording appears exactly once.
    expect(screen.getAllByText(zh.toolUnverified)).toHaveLength(1)
    expect(screen.getByText(zh.toolUnverifiedDetail)).toBeTruthy()
    expect(screen.getByText(reasonText)).toBeTruthy()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
    expect(screen.queryByText(zh.toolDeclined)).toBeNull()
  })
})

describe('WriteToolView (zotero_update_item_tags)', () => {
  it('reports the applied counts, not the requested tags, beside every planned tag', () => {
    const block = settledWrite('zotero_update_item_tags', {
      args: { ref: REF, add: ['AI', 'Quantum'], remove: ['Physics'] },
      meta: { kind: 'applied', addedCount: 1, removedCount: 1 },
      text: 'Tags merged',
    })

    const { container } = renderWrite('zotero_update_item_tags', block)

    expect(screen.getByText(zh.toolTitleUpdateItemTags)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemTags', { added: 1, removed: 1 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    // The pills list what the plan card showed the user.
    for (const tag of ['AI', 'Quantum', 'Physics']) expect(screen.getByText(tag)).toBeTruthy()
    const link = container.querySelector('a[href^="zotero://select/"]')
    expect(link?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
  })

  it('reports a no-op tag merge as writing nothing', () => {
    const block = settledWrite('zotero_update_item_tags', {
      args: { ref: REF, add: ['AI'] },
      meta: { kind: 'applied', addedCount: 0, removedCount: 0 },
      text: 'No change',
    })

    renderWrite('zotero_update_item_tags', block)

    expect(screen.getAllByText(zh.toolNoTagsChanged).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeNoOp)).toBeTruthy()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('falls back to the requested count when the applied counts are unreported', () => {
    // No meta: nested code dispatch or a malformed replay record. The card
    // cannot prove what landed, so it states the request and says the outcome
    // is unreported rather than claiming an applied count or a no-op.
    const block = settledWrite('zotero_update_item_tags', {
      args: { ref: REF, add: ['AI', 'Quantum'] },
      text: 'Tags merged',
    })

    renderWrite('zotero_update_item_tags', block)

    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemTagsRequested', { count: 2 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeUnreported)).toBeTruthy()
    expect(
      screen.queryByText(mockT('toolSummaryUpdateItemTags', { added: 2, removed: 0 })),
    ).toBeNull()
    expect(screen.queryByText(zh.badgeNoOp)).toBeNull()
  })
})

describe('WriteToolView (zotero_update_item_collections)', () => {
  it('reports the applied membership counts as a success receipt', () => {
    const block = settledWrite('zotero_update_item_collections', {
      args: { ref: REF, add: ['Deep Learning'] },
      meta: { kind: 'applied', addedCount: 1, removedCount: 0 },
      text: 'Membership merged',
    })

    const { container } = renderWrite('zotero_update_item_collections', block)

    expect(screen.getByText(zh.toolTitleUpdateItemCollections)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemCollections', { added: 1, removed: 0 }))
        .length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    const link = container.querySelector('a[href^="zotero://select/"]')
    expect(link?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
  })

  it('reports an already-a-member merge as writing nothing', () => {
    const block = settledWrite('zotero_update_item_collections', {
      args: { ref: REF, add: ['Deep Learning'] },
      meta: { kind: 'applied', addedCount: 0, removedCount: 0 },
      text: 'Already a member',
    })

    renderWrite('zotero_update_item_collections', block)

    expect(screen.getAllByText(zh.toolNoMembershipChanged).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeNoOp)).toBeTruthy()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('names the target collection by ref or exact name when nothing reported', () => {
    renderWrite(
      'zotero_update_item_collections',
      settledWrite('zotero_update_item_collections', {
        args: { ref: REF, add: ['zotero://user/0/collection/COLL1234'] },
        text: 'Membership merged',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemCollectionsRequested', { name: 'COLL1234' }))
        .length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeUnreported)).toBeTruthy()
    cleanup()

    renderWrite(
      'zotero_update_item_collections',
      settledWrite('zotero_update_item_collections', {
        args: { ref: REF, add: ['Deep Learning'] },
        text: 'Membership merged',
      }),
    )
    expect(
      screen.getAllByText(
        mockT('toolSummaryUpdateItemCollectionsRequested', { name: 'Deep Learning' }),
      ).length,
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('WriteToolView (collections and items)', () => {
  it('renders a created collection with its name and optional parent link', () => {
    const block = settledWrite('zotero_create_collection', {
      args: { name: 'Field notes', parent: REF },
      text: 'Created',
    })

    const { container } = renderWrite('zotero_create_collection', block)

    expect(screen.getByText(zh.toolTitleCreateCollection)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryCreateCollection', { name: 'Field notes' })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('a[href^="zotero://select/"]')).toBeTruthy()
  })

  it('names the deleted collection by ref key or by its exact name', () => {
    renderWrite(
      'zotero_delete_collection',
      settledWrite('zotero_delete_collection', {
        args: { collection: 'zotero://user/0/collection/COLL1234' },
        text: 'Deleted',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryDeleteCollection', { name: 'COLL1234' })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.toolTitleDeleteCollection)).toBeTruthy()
    cleanup()

    renderWrite(
      'zotero_delete_collection',
      settledWrite('zotero_delete_collection', {
        args: { collection: 'Field notes' },
        text: 'Deleted',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryDeleteCollection', { name: 'Field notes' })).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders a created item from its title, or its URL when no title was sent', () => {
    renderWrite(
      'zotero_create_item',
      settledWrite('zotero_create_item', {
        args: { itemType: 'journalArticle', title: 'A study' },
        text: 'Created',
      }),
    )
    expect(screen.getByText(zh.toolTitleCreateItem)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryCreateItem', { title: 'A study' })).length,
    ).toBeGreaterThanOrEqual(1)
    cleanup()

    renderWrite(
      'zotero_create_item',
      settledWrite('zotero_create_item', {
        args: { itemType: 'webpage', url: 'https://example.org' },
        text: 'Created',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryCreateItem', { title: 'https://example.org' })).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders an updated item keyed by its short ref, with the open link', () => {
    const block = settledWrite('zotero_update_item', {
      args: { ref: REF, set: { title: 'A study' } },
      text: 'Updated',
    })

    const { container } = renderWrite('zotero_update_item', block)

    expect(screen.getByText(zh.toolTitleUpdateItem)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItem', { ref: 'ABCD1234' })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('a[href^="zotero://select/"]')).toBeTruthy()
  })
})

describe('WriteToolView (zotero_delete_library_tags)', () => {
  it('reports the applied deletion count beside every planned tag', () => {
    const block = settledWrite('zotero_delete_library_tags', {
      args: { tags: ['legacy', 'draft'] },
      meta: { kind: 'deleted', deletedCount: 2 },
      text: 'Deleted',
    })

    renderWrite('zotero_delete_library_tags', block)

    expect(screen.getByText(zh.toolTitleDeleteLibraryTags)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryDeleteLibraryTags', { count: 2 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    for (const tag of ['legacy', 'draft']) expect(screen.getByText(tag)).toBeTruthy()
  })

  it('falls back to the requested count when nothing reported what was deleted', () => {
    const block = settledWrite('zotero_delete_library_tags', {
      args: { tags: ['legacy'] },
      text: 'Deleted',
    })

    renderWrite('zotero_delete_library_tags', block)

    expect(
      screen.getAllByText(mockT('toolSummaryDeleteLibraryTagsRequested', { count: 1 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeUnreported)).toBeTruthy()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
    expect(screen.queryByText(zh.badgeNoOp)).toBeNull()
  })
})

describe('WriteToolView verdicts and failures', () => {
  it('renders plan-review declined notice via meta.kind declined', () => {
    const block = settledWrite('zotero_delete_library_tags', {
      args: { tags: ['legacy'] },
      meta: { kind: 'declined' },
      text: 'Declined: the user dismissed the plan',
    })

    renderWrite('zotero_delete_library_tags', block)

    expect(screen.getAllByText(zh.toolDeclined).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Declined: the user dismissed the plan')).toBeTruthy()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('renders an unverified commit whose own commit is unproven as the same warning state', () => {
    const block = settledWrite('zotero_update_item', {
      args: { ref: REF, set: { title: 'A study' } },
      meta: { kind: 'committed-unverified', reason: 'commit-unknown' },
      text: 'Zotero may have applied the change, but the response did not prove the outcome.',
    })

    renderWrite('zotero_update_item', block)

    expect(screen.getAllByText(zh.toolUnverified).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.toolUnverifiedDetail)).toBeTruthy()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('renders write error state on failure without rendering OK', () => {
    const block = settledWrite('zotero_create_note', {
      args: { markdown: 'Note body' },
      text: 'Write permission denied',
      isError: true,
    })

    renderWrite('zotero_create_note', block)

    expect(screen.getAllByText('Write permission denied').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('renders write error state with fallback title when raw content is empty', () => {
    const block = settledWrite('zotero_create_note', { args: {}, isError: true, text: '' })

    renderWrite('zotero_create_note', block)

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_delete_collection',
      argsRaw: JSON.stringify({ collection: 'Field notes' }),
    })

    renderWrite('zotero_delete_collection', block)

    expect(screen.getByText(zh.toolRunning)).toBeTruthy()
  })
})

describe('WriteToolView argument and count fallbacks', () => {
  it('keeps the default note title when no body line survives trimming', () => {
    // A whitespace-only body has no line to take a title from; a first line
    // of punctuation strips to nothing. Both fall back instead of quoting the
    // raw marker back as the note's title.
    for (const markdown of ['   \n \t ', '###']) {
      renderWrite(
        'zotero_create_note',
        settledWrite('zotero_create_note', { args: { markdown }, text: 'Created' }),
      )
      expect(
        screen.getAllByText(
          mockT('toolSummaryCreateNote', { title: mockT('toolDefaultNoteTitle') }),
        ).length,
      ).toBeGreaterThanOrEqual(1)
      cleanup()
    }
  })

  it('renders every write card from a malformed argument payload without claiming a target', () => {
    const titles: Record<WriteName, string> = {
      zotero_create_note: zh.toolTitleCreateNote,
      zotero_update_item_tags: zh.toolTitleUpdateItemTags,
      zotero_update_item_collections: zh.toolTitleUpdateItemCollections,
      zotero_create_collection: zh.toolTitleCreateCollection,
      zotero_delete_collection: zh.toolTitleDeleteCollection,
      zotero_create_item: zh.toolTitleCreateItem,
      zotero_update_item: zh.toolTitleUpdateItem,
      zotero_delete_library_tags: zh.toolTitleDeleteLibraryTags,
    }
    for (const [name, title] of Object.entries(titles) as [WriteName, string][]) {
      const block = settled({
        call: { name, argsRaw: '{bad-json' },
        content: [{ type: 'text', text: 'done' }],
      })
      renderWrite(name, block)
      expect(screen.getByText(title)).toBeTruthy()
      cleanup()
    }
  })

  it('reads a null count as one side of the merge rather than a no-op', () => {
    // One count reported and the other absent: the card zeroes the missing
    // side instead of treating the absence as proof nothing was written.
    renderWrite(
      'zotero_update_item_tags',
      settledWrite('zotero_update_item_tags', {
        args: { ref: REF, add: ['AI'], remove: ['Physics'] },
        meta: { kind: 'applied', addedCount: 1 },
        text: 'Tags merged',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemTags', { added: 1, removed: 0 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    expect(screen.queryByText(zh.badgeNoOp)).toBeNull()
    cleanup()

    renderWrite(
      'zotero_update_item_tags',
      settledWrite('zotero_update_item_tags', {
        args: { ref: REF, remove: ['Physics', 'Legacy'] },
        meta: { kind: 'applied', removedCount: 2 },
        text: 'Tags merged',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemTags', { added: 0, removed: 2 })).length,
    ).toBeGreaterThanOrEqual(1)
    cleanup()

    renderWrite(
      'zotero_update_item_collections',
      settledWrite('zotero_update_item_collections', {
        args: { ref: REF, add: ['Deep Learning'] },
        meta: { kind: 'applied', addedCount: 3 },
        text: 'Membership merged',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemCollections', { added: 3, removed: 0 }))
        .length,
    ).toBeGreaterThanOrEqual(1)
    cleanup()

    renderWrite(
      'zotero_update_item_collections',
      settledWrite('zotero_update_item_collections', {
        args: { ref: REF, remove: ['Old'] },
        meta: { kind: 'applied', removedCount: 1 },
        text: 'Membership merged',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItemCollections', { added: 0, removed: 1 }))
        .length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('names an update target by its raw text when the ref carries no key', () => {
    renderWrite(
      'zotero_update_item',
      settledWrite('zotero_update_item', {
        args: { ref: 'ITEM-2026', set: { date: '2026' } },
        text: 'Updated',
      }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItem', { ref: 'ITEM-2026' })).length,
    ).toBeGreaterThanOrEqual(1)
    cleanup()

    renderWrite(
      'zotero_update_item',
      settledWrite('zotero_update_item', {
        args: { set: { date: '2026' } },
        text: 'Updated',
      }),
    )
    // No ref argument at all: the summary keeps its sentence and states no
    // target rather than inventing one (the trailing blank trims away).
    expect(
      screen.getAllByText(mockT('toolSummaryUpdateItem', { ref: '' }).trim()).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('falls back to an empty title when the created item named neither title nor url', () => {
    renderWrite(
      'zotero_create_item',
      settledWrite('zotero_create_item', { args: { itemType: 'webpage' }, text: 'Created' }),
    )
    expect(
      screen.getAllByText(mockT('toolSummaryCreateItem', { title: '' })).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
