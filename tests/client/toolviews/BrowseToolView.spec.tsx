// @vitest-environment jsdom
/**
 * Test suite for BrowseToolView:
 * browse views, changes views, empty/running states, and error handling.
 * @module tests/client/toolviews/BrowseToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { BrowseToolView } from '../../../src/client/toolviews/BrowseToolView.tsx'
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

function renderBrowse(
  props: Parameters<typeof createToolViewProps<'zotero_browse' | 'zotero_changes'>>[0],
) {
  return render(<BrowseToolView {...createToolViewProps(props)} />)
}

describe('BrowseToolView (zotero_browse & zotero_changes)', () => {
  it('renders zotero_browse with category summary and raw listing', () => {
    const block = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ category: 'collections' }),
      },
      content: [{ type: 'text', text: 'Col 1\nCol 2\nCol 3' }],
    })

    const { container } = renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleBrowse).length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getByText(mockT('toolSummaryBrowse', { category: 'collections', count: 3 })),
    ).toBeTruthy()
    expect(container.querySelector('pre')?.textContent).toBe('Col 1\nCol 2\nCol 3')
  })

  it('renders zotero_changes with changes summary and output', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: 10 }),
      },
      content: [{ type: 'text', text: 'Change 1: version 11' }],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleChanges).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Change 1: version 11')).toBeTruthy()
  })

  it('renders zotero_changes with meta totals using toolSummaryChanges', () => {
    const block = settled({
      call: {
        name: 'zotero_changes',
        argsRaw: JSON.stringify({ since: 10 }),
      },
      meta: {
        totals: {
          items: 4,
          collections: 2,
        },
      },
      content: [{ type: 'text', text: 'Change details...' }],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_changes',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolSummaryChanges', { count: 6 }))).toBeTruthy()
  })

  it('renders running state for browse operations', () => {
    const block = running({
      name: 'zotero_browse',
      argsRaw: JSON.stringify({ category: 'items' }),
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleBrowse).length).toBeGreaterThanOrEqual(1)
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_browse',
      argsRaw: JSON.stringify({ category: 'items' }),
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolRunning).length).toBe(2)
  })

  it('renders zotero_browse with default items category when category is omitted', () => {
    const block = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({}),
      },
      content: [{ type: 'text', text: 'Item 1' }],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryBrowse', { category: 'items', count: 1 })),
    ).toBeTruthy()
  })

  it('renders zotero_browse empty results notice when output is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ category: 'items' }),
      },
      content: [],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolNoResults)).toBeTruthy()
    expect(
      screen.getByText(mockT('toolSummaryBrowse', { category: 'items', count: 0 })),
    ).toBeTruthy()
  })

  it('renders zotero_browse count 0 when output is empty string', () => {
    const block = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ category: 'items' }),
      },
      content: [{ type: 'text', text: '' }],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryBrowse', { category: 'items', count: 0 })),
    ).toBeTruthy()
  })

  it('renders zotero_browse error state with message and fallback', () => {
    const blockWithError = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ category: 'items' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'Category invalid' }],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block: blockWithError,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Category invalid').length).toBeGreaterThanOrEqual(1)

    cleanup()

    const blockEmptyError = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: JSON.stringify({ category: 'items' }),
      },
      isError: true,
      content: [],
    })

    renderBrowse({
      callId: 'c2',
      toolName: 'zotero_browse',
      phase: 'result',
      block: blockEmptyError,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw in browse where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_browse',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'Row 1' }],
    })

    renderBrowse({
      callId: 'c1',
      toolName: 'zotero_browse',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryBrowse', { category: 'items', count: 1 })),
    ).toBeTruthy()
  })
})
