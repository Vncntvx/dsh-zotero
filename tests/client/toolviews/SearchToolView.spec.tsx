// @vitest-environment jsdom
/**
 * Test suite for SearchToolView:
 * literature hits, metadata badges, note match counts, links, and empty/fallback states.
 * @module tests/client/toolviews/SearchToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { SearchToolView } from '../../../src/client/toolviews/SearchToolView.tsx'
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

function renderView(props: Parameters<typeof createToolViewProps<'zotero_search'>>[0]) {
  return render(<SearchToolView {...createToolViewProps(props)} />)
}

describe('SearchToolView', () => {
  it('renders running state with active query', () => {
    const block = running({
      name: 'zotero_search',
      argsRaw: JSON.stringify({ query: 'quantum computing' }),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getByText('"quantum computing"')).toBeTruthy()
  })

  it('renders running state with generic fallback when query is empty', () => {
    const block = running({
      name: 'zotero_search',
      argsRaw: JSON.stringify({}),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getByText(zh.toolSearchRunning)).toBeTruthy()
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_search',
      argsRaw: JSON.stringify({ q: 'quantum' }),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolSearchRunning).length).toBeGreaterThanOrEqual(1)
  })

  it('renders search results with literature hits, badges, and deep links', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({ query: 'quantum' }),
      },
      meta: {
        items: [
          {
            ref: 'zotero://user/0/item/ABCD1234',
            title: 'Quantum Advantage in 2024',
            creatorSummary: 'Alice & Bob',
            year: 2024,
            bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
            bestAttachmentType: 'application/pdf',
          },
        ],
      },
    })

    const { container } = renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    // Summary count
    expect(screen.getByText(mockT('toolSummaryFound', { count: 1 }))).toBeTruthy()

    // Title and creator
    expect(screen.getByText('Quantum Advantage in 2024')).toBeTruthy()
    expect(screen.getByText('Alice & Bob')).toBeTruthy()

    // Year and PDF badge
    expect(screen.getByText('2024')).toBeTruthy()
    expect(screen.getByText(zh.badgePdf)).toBeTruthy()

    // Links
    const links = container.querySelectorAll('a')
    expect(links.length).toBe(2)
    const selectLink = Array.from(links).find((a) =>
      a.getAttribute('href')?.startsWith('zotero://select/'),
    )
    const pdfLink = Array.from(links).find((a) =>
      a.getAttribute('href')?.startsWith('zotero://open-pdf/'),
    )
    expect(selectLink?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
    expect(pdfLink?.getAttribute('href')).toBe('zotero://open-pdf/library/items/WXYZ6789')
  })

  it('renders summary with note matches when noteMatches > 0', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({ query: 'superconducting' }),
      },
      meta: {
        noteMatches: 3,
        items: [
          {
            ref: 'zotero://user/0/item/ITEM5678',
            title: 'Superconducting Qubits',
            creatorSummary: 'Charlie',
            year: 2023,
          },
        ],
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryFoundWithNotes', { count: 1, notes: 3 })),
    ).toBeTruthy()
  })

  it('renders empty result notice when 0 items returned', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({ query: 'nonexistent' }),
      },
      meta: {
        items: [],
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolSummaryFound', { count: 0 }))).toBeTruthy()
    expect(screen.getByText(zh.toolNoResults)).toBeTruthy()
  })

  it('renders raw text fallback when rows are absent or malformed but raw content exists', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({ query: 'raw text' }),
      },
      content: [{ type: 'text', text: 'Item 1: Fallback Raw Title' }],
      meta: {},
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText('Item 1: Fallback Raw Title')).toBeTruthy()
  })

  it('renders error state when tool call failed', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({ query: 'error test' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'Zotero is not running' }],
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Zotero is not running').length).toBeGreaterThanOrEqual(1)
  })

  it('renders error state with fallback title when raw content is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({ query: 'error test' }),
      },
      isError: true,
      content: [],
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('renders fallback summary when settled without rows and without query', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: JSON.stringify({}),
      },
      meta: null,
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleSearch).length).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_search',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'raw hit' }],
      meta: null,
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_search',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleSearch).length).toBeGreaterThanOrEqual(1)
  })
})
