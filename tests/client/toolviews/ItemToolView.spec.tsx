// @vitest-environment jsdom
/**
 * Test suite for ItemToolView:
 * paper metadata cards, venue, year badge, PDF/Zotero deep links, and fallback states.
 * @module tests/client/toolviews/ItemToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { ItemToolView } from '../../../src/client/toolviews/ItemToolView.tsx'
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

function renderItem(props: Parameters<typeof createToolViewProps<'zotero_get'>>[0]) {
  return render(<ItemToolView {...createToolViewProps(props)} />)
}

describe('ItemToolView (zotero_get)', () => {
  it('renders running state with ref summary', () => {
    const block = running({
      name: 'zotero_get',
      argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ITEM1234' }),
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getByText('zotero://user/0/item/ITEM1234')).toBeTruthy()
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_get',
      argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ITEM1234' }),
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolRunning)).toBeTruthy()
  })

  it('renders settled metadata card with title, creators, venue, year badge, and links', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        title: 'Deep Learning in 2026',
        creators: 'Smith, J. & Doe, A.',
        year: 2026,
        venue: 'Nature AI',
        bestAttachment: {
          ref: 'zotero://user/0/attachment/WXYZ6789',
          contentType: 'application/pdf',
        },
      },
    })

    const { container } = renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Deep Learning in 2026').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Smith, J. & Doe, A.')).toBeTruthy()
    expect(screen.getByText('Nature AI')).toBeTruthy()
    expect(screen.getByText('2026')).toBeTruthy()
    expect(screen.getByText(zh.badgePdf)).toBeTruthy()

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

  it('renders raw text fallback when metadata is absent', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      content: [{ type: 'text', text: 'Item data without structured meta' }],
      meta: {},
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText('Item data without structured meta')).toBeTruthy()
  })

  it('renders error state on failure', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'Item not found' }],
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Item not found').length).toBeGreaterThanOrEqual(1)
  })

  it('renders running state without ref falling back to default title', () => {
    const block = running({
      name: 'zotero_get',
      argsRaw: JSON.stringify({}),
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleGet).length).toBeGreaterThanOrEqual(1)
  })

  it('renders error state with fallback title when raw content is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      isError: true,
      content: [],
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('renders item card without year badge when year is missing', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        title: 'Paper Without Year',
      },
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Paper Without Year').length).toBeGreaterThanOrEqual(1)
  })

  it('renders item card falling back to ref when title is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        title: '',
      },
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('zotero://user/0/item/ABCD1234').length).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw in zotero_get where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_get',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'Item details' }],
    })

    renderItem({
      callId: 'c1',
      toolName: 'zotero_get',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleGet).length).toBeGreaterThanOrEqual(1)
  })
})
