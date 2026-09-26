// @vitest-environment jsdom
/**
 * Test suite for ChildrenToolView:
 * child items, attachments, PDF/Zotero links, and fallback states.
 * @module tests/client/toolviews/ChildrenToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { ChildrenToolView } from '../../../src/client/toolviews/ChildrenToolView.tsx'
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

function renderChildren(
  props: Parameters<typeof createToolViewProps<'zotero_children' | 'zotero_attachment'>>[0],
) {
  return render(<ChildrenToolView {...createToolViewProps(props)} />)
}

describe('ChildrenToolView (zotero_children & zotero_attachment)', () => {
  it('renders zotero_children settled raw output and summary', () => {
    const block = settled({
      call: {
        name: 'zotero_children',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      content: [{ type: 'text', text: 'Child Note 1\nChild Attachment 2' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolTitleChildren)).toBeTruthy()
    expect(screen.getByText(/Child Note 1/)).toBeTruthy()
  })

  it('renders zotero_children with structured meta counts in summary', () => {
    const block = settled({
      call: {
        name: 'zotero_children',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        notes: { total: 2 },
        attachments: { total: 3 },
      },
      content: [{ type: 'text', text: 'Children details' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolSummaryChildren', { count: 5 }))).toBeTruthy()
  })

  it('renders running state with toolRunning when expanded', () => {
    const block = running({
      name: 'zotero_children',
      argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolRunning)).toBeTruthy()
  })

  it('renders zotero_attachment with metadata, title, and PDF link', () => {
    const block = settled({
      call: {
        name: 'zotero_attachment',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
      },
      meta: {
        kind: 'file',
        title: 'FullTextPaper.pdf',
        contentType: 'application/pdf',
        path: '/path/to/FullTextPaper.pdf',
        ref: 'zotero://user/0/attachment/WXYZ6789',
      },
    })

    const { container } = renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryAttachment', { title: 'FullTextPaper.pdf' })),
    ).toBeTruthy()
    expect(screen.getByText('FullTextPaper.pdf')).toBeTruthy()
    expect(screen.getByText('application/pdf')).toBeTruthy()
    expect(screen.getByText('/path/to/FullTextPaper.pdf')).toBeTruthy()

    const pdfLink = container.querySelector('a[href^="zotero://open-pdf/"]')
    expect(pdfLink?.getAttribute('href')).toBe('zotero://open-pdf/library/items/WXYZ6789')
  })

  it('renders error state on attachment failure', () => {
    const block = settled({
      call: {
        name: 'zotero_attachment',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'Attachment file missing' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Attachment file missing').length).toBeGreaterThanOrEqual(1)
  })

  it('renders running state without ref falling back to respective tool titles', () => {
    const blockAttach = running({
      name: 'zotero_attachment',
      argsRaw: JSON.stringify({}),
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'start',
      block: blockAttach,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleAttachment).length).toBeGreaterThanOrEqual(1)

    const blockChild = running({
      name: 'zotero_children',
      argsRaw: JSON.stringify({}),
    })

    renderChildren({
      callId: 'c2',
      toolName: 'zotero_children',
      phase: 'start',
      block: blockChild,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleChildren).length).toBeGreaterThanOrEqual(1)
  })

  it('renders error state with fallback title when raw content is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_attachment',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
      },
      isError: true,
      content: [],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('renders zotero_children settled with ref in summary', () => {
    const block = settled({
      call: {
        name: 'zotero_children',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      content: [{ type: 'text', text: 'Child 1' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('zotero://user/0/item/ABCD1234').length).toBeGreaterThanOrEqual(1)
  })

  it('renders zotero_attachment falling back to ref when title is absent', () => {
    const block = settled({
      call: {
        name: 'zotero_attachment',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
      },
      meta: {
        kind: 'file',
        path: '/tmp/test.pdf',
        ref: 'zotero://user/0/attachment/WXYZ6789',
      },
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getAllByText('zotero://user/0/attachment/WXYZ6789').length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw in children/attachment where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_children',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'Child 1' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleChildren).length).toBeGreaterThanOrEqual(1)
  })
})
