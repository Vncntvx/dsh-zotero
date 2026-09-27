// @vitest-environment jsdom
/**
 * Test suite for WriteToolView:
 * write receipts (notes, tags, collections), plan-review decline banners,
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

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWrite(
  props: Parameters<
    typeof createToolViewProps<
      'zotero_create_note' | 'zotero_add_tags' | 'zotero_add_to_collection'
    >
  >[0],
) {
  return render(<WriteToolView {...createToolViewProps(props)} />)
}

describe('WriteToolView (create_note, add_tags, add_to_collection)', () => {
  it('renders zotero_create_note receipt with note title and parent link from real contract args', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({
          markdown: '# Meeting Notes 2026\nDiscussion on AI agents.',
          parentItem: 'zotero://user/0/item/ABCD1234',
        }),
      },
      content: [{ type: 'text', text: 'Created note zotero://user/0/item/NOTE1234' }],
    })

    const { container } = renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolTitleCreateNote)).toBeTruthy()
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryCreateNote', { title: 'Meeting Notes 2026' })).length,
    ).toBeGreaterThanOrEqual(1)

    const parentLink = container.querySelector('a[href^="zotero://select/"]')
    expect(parentLink?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
  })

  it('renders zotero_add_tags receipt with tag badges and count', () => {
    const block = settled({
      call: {
        name: 'zotero_add_tags',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          tags: ['AI', 'Quantum', 'Physics'],
        }),
      },
      content: [{ type: 'text', text: 'Tags added' }],
    })

    const { container } = renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_tags',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolTitleAddTags)).toBeTruthy()
    expect(screen.getByText('AI')).toBeTruthy()
    expect(screen.getByText('Quantum')).toBeTruthy()
    expect(screen.getByText('Physics')).toBeTruthy()

    const parentLink = container.querySelector('a[href^="zotero://select/"]')
    expect(parentLink).toBeTruthy()
  })

  it('renders zotero_add_tags when tags arg is omitted or non-array', () => {
    const block = settled({
      call: {
        name: 'zotero_add_tags',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
        }),
      },
      content: [{ type: 'text', text: 'Tags added' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_tags',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddTagsRequested', { count: 0 })).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders zotero_add_to_collection when collection arg is empty string', () => {
    const block = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: '',
        }),
      },
      content: [{ type: 'text', text: 'Added' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_to_collection',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolTitleAddToCollection)).toBeTruthy()
  })

  it('names the target collection by ref or exact name', () => {
    // Both spellings reach the same receipt; which one the user sees is the
    // only difference, and neither is a claim about what landed.
    const block = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: 'zotero://user/0/collection/COLL1234',
        }),
      },
      meta: { kind: 'applied', ref: 'zotero://user/0/item/ABCD1234', version: 9, added: true },
      content: [{ type: 'text', text: 'Added to collection' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_to_collection',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolTitleAddToCollection)).toBeTruthy()
    expect(
      screen.getAllByText(mockT('toolSummaryAddToCollection', { name: 'COLL1234' })).length,
    ).toBeGreaterThanOrEqual(1)

    cleanup()

    const blockExactName = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: 'Deep Learning',
        }),
      },
      meta: { kind: 'applied', ref: 'zotero://user/0/item/ABCD1234', version: 9, added: true },
      content: [{ type: 'text', text: 'Added to collection' }],
    })

    renderWrite({
      callId: 'c2',
      toolName: 'zotero_add_to_collection',
      phase: 'result',
      block: blockExactName,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddToCollection', { name: 'Deep Learning' })).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders plan-review declined notice via meta.kind declined', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({ markdown: 'Unwanted Note' }),
      },
      meta: { kind: 'declined' },
      content: [{ type: 'text', text: 'Declined: User rejected note creation' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolDeclined).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Declined: User rejected note creation')).toBeTruthy()
  })

  it('renders a committed-unverified create_note as a warning receipt, never a green OK', () => {
    // The exact projection `zotero_create_note` emits for an unverified
    // commit (`src/tools/create-note.ts` presentationMeta), beside the text
    // its own render produces for the same outcome.
    const reasonText =
      'Zotero committed the note (key NOTE1234), but its saved state could not be verified. Do not retry; reconcile the note by its key/ref.'
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({ markdown: '# Reading note' }),
      },
      meta: { kind: 'committed-unverified', reason: 'saved-state-unverified', key: 'NOTE1234' },
      content: [{ type: 'text', text: reasonText }],
    })

    const { container } = renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(container.querySelector('[data-tool]')?.getAttribute('data-state')).toBe('unverified')
    // The collapsed line carries the label; the expanded body carries only the
    // tool's own sentence, so the wording appears exactly once.
    expect(screen.getAllByText(zh.toolUnverified)).toHaveLength(1)
    expect(screen.getByText(zh.toolUnverifiedDetail)).toBeTruthy()
    expect(screen.getByText(reasonText)).toBeTruthy()
    // The write boundary's whole point: an unverified commit is the one write
    // outcome that must never render as a clean success.
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
    expect(screen.queryByText(zh.toolDeclined)).toBeNull()
  })

  it('renders an unverified commit whose own commit is unproven as the same warning state', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({ markdown: 'Racing note' }),
      },
      meta: { kind: 'committed-unverified', reason: 'commit-unknown' },
      content: [
        {
          type: 'text',
          text: 'Zotero may have committed the note, but the response did not prove the outcome. Do not retry; reconcile by checking Zotero for the note before taking any further action.',
        },
      ],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolUnverified).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('reports the applied tag count, not the requested one', () => {
    // `zotero_add_tags` merges: two of the five requested tags were already on
    // the item, so the receipt must say two. The projection carries
    // `addedCount` (src/tools/add-tags.ts presentationMeta).
    const block = settled({
      call: {
        name: 'zotero_add_tags',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          tags: ['AI', 'Quantum', 'Physics', 'Biology', 'Chemistry'],
        }),
      },
      meta: { kind: 'applied', ref: 'zotero://user/0/item/ABCD1234', version: 9, addedCount: 2 },
      content: [{ type: 'text', text: 'Tagged zotero://user/0/item/ABCD1234' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_tags',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddTags', { count: 2 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
    // The approved plan still lists every requested tag.
    expect(screen.getByText('Chemistry')).toBeTruthy()
  })

  it('reports a no-op add_tags as writing nothing when every tag was already present', () => {
    const block = settled({
      call: {
        name: 'zotero_add_tags',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          tags: ['AI', 'Quantum'],
        }),
      },
      meta: { kind: 'applied', ref: 'zotero://user/0/item/ABCD1234', version: 9, addedCount: 0 },
      content: [
        {
          type: 'text',
          text: 'No change: zotero://user/0/item/ABCD1234 already carries every requested tag (version 9).',
        },
      ],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_tags',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolNoTagsAdded).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeNoOp)).toBeTruthy()
    // "Added 2 tags" would be the bug this establishes against.
    expect(screen.queryByText(mockT('toolSummaryAddTags', { count: 2 }))).toBeNull()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('reports an already-a-member add_to_collection as writing nothing', () => {
    const block = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: 'zotero://user/0/collection/COLL1234',
        }),
      },
      meta: {
        kind: 'applied',
        ref: 'zotero://user/0/item/ABCD1234',
        version: 9,
        added: false,
      },
      content: [
        {
          type: 'text',
          text: 'zotero://user/0/item/ABCD1234 was already a member; nothing was written (version 9).',
        },
      ],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_to_collection',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddToCollectionNoop', { name: 'COLL1234' })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeNoOp)).toBeTruthy()
    expect(screen.queryByText(mockT('toolSummaryAddToCollection', { name: 'COLL1234' }))).toBeNull()
  })

  it('reports a genuinely added membership as a success receipt', () => {
    const block = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: 'Deep Learning',
        }),
      },
      meta: {
        kind: 'applied',
        ref: 'zotero://user/0/item/ABCD1234',
        version: 9,
        added: true,
      },
      content: [{ type: 'text', text: 'Added zotero://user/0/item/ABCD1234 to the collection' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_to_collection',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddToCollection', { name: 'Deep Learning' })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeSuccess)).toBeTruthy()
  })

  it('falls back to the requested count when the applied count is unreported', () => {
    // No meta: nested code dispatch or a malformed replay record. The card
    // cannot prove what landed, so it states the request and says the outcome
    // is unreported rather than claiming an applied count or a no-op.
    const block = settled({
      call: {
        name: 'zotero_add_tags',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          tags: ['AI', 'Quantum'],
        }),
      },
      content: [{ type: 'text', text: 'Tagged zotero://user/0/item/ABCD1234' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_tags',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddTagsRequested', { count: 2 })).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeUnreported)).toBeTruthy()
    expect(screen.queryByText(mockT('toolSummaryAddTags', { count: 2 }))).toBeNull()
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
    expect(screen.queryByText(zh.badgeNoOp)).toBeNull()
  })

  it('states a membership as requested when nothing reported whether it landed', () => {
    // "Added to collection X" beside a "no change" badge is a contradiction;
    // without the applied fact the receipt says only what was asked.
    const block = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: 'Deep Learning',
        }),
      },
      content: [{ type: 'text', text: 'Added zotero://user/0/item/ABCD1234' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_add_to_collection',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryAddToCollectionRequested', { name: 'Deep Learning' }))
        .length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(zh.badgeUnreported)).toBeTruthy()
    expect(
      screen.queryByText(mockT('toolSummaryAddToCollection', { name: 'Deep Learning' })),
    ).toBeNull()
  })

  it('renders write error state on failure without rendering OK', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({ markdown: 'Note body' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'Write permission denied' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Write permission denied').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(zh.badgeSuccess)).toBeNull()
  })

  it('renders write error state with fallback title when raw content is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({}),
      },
      isError: true,
      content: [],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_create_note',
      argsRaw: JSON.stringify({ markdown: 'Writing...' }),
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolRunning)).toBeTruthy()
  })

  it('renders write note with default title when markdown is omitted', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: JSON.stringify({}),
      },
      content: [{ type: 'text', text: 'Created note' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryCreateNote', { title: mockT('toolDefaultNoteTitle') }))
        .length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw in write tool where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_create_note',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'Created' }],
    })

    renderWrite({
      callId: 'c1',
      toolName: 'zotero_create_note',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText(mockT('toolSummaryCreateNote', { title: mockT('toolDefaultNoteTitle') }))
        .length,
    ).toBeGreaterThanOrEqual(1)
  })
})
