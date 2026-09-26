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
      screen.getAllByText(mockT('toolSummaryAddTags', { count: 0 })).length,
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

  it('renders zotero_add_to_collection receipt with collection ref or exact name', () => {
    const block = settled({
      call: {
        name: 'zotero_add_to_collection',
        argsRaw: JSON.stringify({
          ref: 'zotero://user/0/item/ABCD1234',
          collection: 'zotero://user/0/collection/COLL1234',
        }),
      },
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
