// @vitest-environment jsdom
/**
 * Test suite for ChildrenToolView:
 * child items, attachments, PDF/Zotero links, and fallback states.
 * @module tests/client/toolviews/ChildrenToolView
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { ChildrenToolView } from '../../../src/client/toolviews/ChildrenToolView.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { running, settled } from '../helpers/blocks.ts'
import { writeClipboardSpy } from '../helpers/primitives-stub.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

const writeClipboard = await writeClipboardSpy()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderChildren(
  props: Parameters<typeof createToolViewProps<'zotero_children' | 'zotero_attachment'>>[0],
) {
  return render(<ChildrenToolView {...createToolViewProps(props)} />)
}

/**
 * Render one annotation carrying `overrides` and return its swatch's inline
 * style, or null when the card drew no swatch. Read from the DOM rather than
 * from the view's own helper, so what this pins is what a reader would see.
 */
function annotationRows(overrides: Record<string, unknown>): string | null {
  const block = settled({
    call: {
      name: 'zotero_children',
      argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
    },
    meta: {
      ref: 'zotero://user/0/item/ABCD1234',
      annotations: {
        total: 1,
        returned: 1,
        items: [{ ref: 'zotero://user/0/annotation/ANN12345', parentRef: null, ...overrides }],
      },
    },
    content: [{ type: 'text', text: 'one annotation' }],
  })
  const { container, unmount } = renderChildren({
    callId: 'c1',
    toolName: 'zotero_children',
    phase: 'result',
    block,
    useDisclosure: mockUseDisclosure(true),
    t: mockT,
  })
  const style = container
    .querySelector('[data-child-row="annotation"] span[style]')
    ?.getAttribute('style')
  unmount()
  return style ?? null
}

describe('ChildrenToolView (zotero_children & zotero_attachment)', () => {
  it('copies the resolved attachment location', () => {
    // The resolved path or URL is the whole point of the call, and it is the
    // one value a reader cannot retype from memory.
    const block = settled({
      call: {
        name: 'zotero_attachment',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
      },
      meta: {
        kind: 'file',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        path: '/Users/xu/Zotero/storage/paper.pdf',
        ref: 'zotero://user/0/attachment/WXYZ6789',
      },
      content: [{ type: 'text', text: '/Users/xu/Zotero/storage/paper.pdf' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    fireEvent.click(screen.getByLabelText(zh.copy))
    expect(writeClipboard).toHaveBeenCalledWith('/Users/xu/Zotero/storage/paper.pdf')
  })

  it("copies a linked attachment's URL rather than a path", () => {
    const block = settled({
      call: {
        name: 'zotero_attachment',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
      },
      meta: {
        kind: 'url',
        title: 'Preprint',
        contentType: 'text/html',
        url: 'https://arxiv.org/abs/1706.03762',
        ref: 'zotero://user/0/attachment/WXYZ6789',
      },
      content: [{ type: 'text', text: 'https://arxiv.org/abs/1706.03762' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_attachment',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    fireEvent.click(screen.getByLabelText(zh.copy))
    expect(writeClipboard).toHaveBeenCalledWith('https://arxiv.org/abs/1706.03762')
  })
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
        notes: { total: 2, returned: 2, items: [] },
        attachments: { total: 3, returned: 3, items: [] },
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

  it('partitions the child graph by kind, with page labels and Zotero colours', () => {
    const block = settled({
      call: {
        name: 'zotero_children',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        ref: 'zotero://user/0/item/ABCD1234',
        itemType: 'journalArticle',
        notes: {
          total: 1,
          returned: 1,
          items: [
            { ref: 'zotero://user/0/note/NOTE1234', text: 'a reading note', truncated: false },
          ],
        },
        attachments: {
          total: 1,
          returned: 1,
          items: [
            {
              ref: 'zotero://user/0/attachment/WXYZ6789',
              title: 'paper.pdf',
              contentType: 'application/pdf',
              linkMode: 'imported_file',
            },
          ],
        },
        annotations: {
          total: 4,
          returned: 2,
          items: [
            {
              ref: 'zotero://user/0/annotation/ANN12345',
              type: 'highlight',
              text: 'Scaled dot-product attention',
              color: '#ffd400',
              pageLabel: '3',
              parentRef: 'zotero://user/0/attachment/WXYZ6789',
            },
          ],
        },
      },
      content: [{ type: 'text', text: 'zotero://user/0/item/ABCD1234' }],
    })

    const { container } = renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    // One section per kind, headed with its own count. Two annotations exist
    // beyond the two returned, so that heading states both.
    const sections = Array.from(container.querySelectorAll('[data-child-kind]'))
    expect(sections.map((s) => s.getAttribute('data-child-kind'))).toEqual([
      'note',
      'attachment',
      'annotation',
    ])
    expect(sections.map((s) => s.querySelector('span')?.textContent)).toEqual([
      `${zh.toolChildrenNotes} · 1`,
      `${zh.toolChildrenAttachments} · 1`,
      // The projection reported two annotations but carried one row, so the
      // count is what the card can actually show next to the true total: never
      // a number the reader cannot find on the page.
      `${zh.toolChildrenAnnotations} · ${mockT('countOfReturned', { total: 4, shown: 1 })}`,
    ])

    expect(screen.getByText('a reading note')).toBeTruthy()
    expect(screen.getByText('paper.pdf')).toBeTruthy()
    expect(screen.getByText('Scaled dot-product attention')).toBeTruthy()
    // The page label and the annotation's own colour, both of which the
    // projection already carried.
    expect(screen.getByText('3')).toBeTruthy()
    const swatch = container.querySelector('[data-child-row="annotation"] span[style]')
    expect(swatch?.getAttribute('style')).toContain('#ffd400')
    // An annotation is only reachable through the PDF it lives in.
    const pdfLink = Array.from(container.querySelectorAll('a')).find((a) =>
      a.getAttribute('href')?.startsWith('zotero://open-pdf/'),
    )
    expect(pdfLink?.getAttribute('href')).toBe('zotero://open-pdf/library/items/WXYZ6789?page=3')
  })

  it('says a returned kind is empty rather than showing it as absent', () => {
    const block = settled({
      call: {
        name: 'zotero_children',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        ref: 'zotero://user/0/item/ABCD1234',
        notes: { total: 0, returned: 0, items: [] },
      },
      content: [{ type: 'text', text: 'No notes.' }],
    })

    renderChildren({
      callId: 'c1',
      toolName: 'zotero_children',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    // "Zero notes exist" is a finding; leaving the section out would read as
    // "the call did not ask".
    expect(screen.getByText(zh.toolChildrenNone)).toBeTruthy()
  })

  it('draws the swatch only for a colour the browser can actually paint', () => {
    // Zotero's own colour is data, so it is passed through as a custom
    // property, which means a value CSS cannot read would render as a hollow
    // box painted by the property's `transparent` fallback. Every length CSS
    // accepts is drawn; the 5- and 7-digit forms it rejects are not.
    const swatchFor = (color: unknown): string | null =>
      annotationRows({
        color,
        type: 'highlight',
        text: 'hit',
      })

    for (const color of ['#ffd400', '#fff', '#ffff', '#ffd400ff', '#FFD400']) {
      expect(swatchFor(color), color).toContain('zotero-annotation')
    }
    for (const color of ['#ffff0', '#fffff00', 'ffd400', 'red', '#gggggg', '', null]) {
      expect(swatchFor(color), String(color)).toBeNull()
    }
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
