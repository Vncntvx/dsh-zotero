// @vitest-environment jsdom
/**
 * Test suite for RetrieveToolView:
 * extracted evidence passages, source badges, page labels, copy buttons, and coverage notice.
 * @module tests/client/toolviews/RetrieveToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { RetrieveToolView } from '../../../src/client/toolviews/RetrieveToolView.tsx'
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

function renderView(props: Parameters<typeof createToolViewProps<'zotero_retrieve'>>[0]) {
  return render(<RetrieveToolView {...createToolViewProps(props)} />)
}

describe('RetrieveToolView', () => {
  it('renders running state with retrieve running indicator', () => {
    const block = running({
      name: 'zotero_retrieve',
      argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getByText(zh.toolRetrieveRunning)).toBeTruthy()
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_retrieve',
      argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolRetrieveRunning).length).toBeGreaterThanOrEqual(1)
  })

  it('renders evidence passages with badges, text, copy button, and deep links', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        items: [
          {
            source: 'pdf',
            sourceRef: 'zotero://user/0/item/ABCD1234',
            preview: 'Crucial evidence excerpt from page 5.',
            previewTruncated: false,
            pageLabel: '5',
            attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
          },
          {
            source: 'note',
            sourceRef: 'zotero://user/0/item/ABCD1234',
            preview: 'Second note passage.',
            previewTruncated: false,
          },
        ],
      },
    })

    const { container } = renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(mockT('toolSummaryEvidence', { count: 2 }))).toBeTruthy()
    expect(screen.getByText('Crucial evidence excerpt from page 5.')).toBeTruthy()
    expect(screen.getByText(zh.sourceFulltext)).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()

    const links = container.querySelectorAll('a')
    const pdfLink = Array.from(links).find((a) =>
      a.getAttribute('href')?.startsWith('zotero://open-pdf/'),
    )
    const selectLink = Array.from(links).find((a) =>
      a.getAttribute('href')?.startsWith('zotero://select/'),
    )

    expect(pdfLink?.getAttribute('href')).toBe('zotero://open-pdf/library/items/WXYZ6789?page=5')
    expect(selectLink?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
  })

  it('renders truncated preview indicator when passage was truncated', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        items: [
          {
            source: 'pdf',
            sourceRef: 'zotero://user/0/item/ABCD1234',
            preview: 'Long passage beginning here...',
            previewTruncated: true,
          },
        ],
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(new RegExp(zh.truncatedPreview))).toBeTruthy()
  })

  it('renders index coverage notice when coverage is present in meta', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        items: [],
        coverage: {
          complete: false,
          indexedPages: 10,
          totalPages: 20,
        },
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(new RegExp(zh.coverageLabel))).toBeTruthy()
    expect(screen.getByText(new RegExp(zh.coverageIncomplete.trim()))).toBeTruthy()
  })

  it('renders empty result message when 0 passages returned without coverage', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        items: [],
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolNoResults)).toBeTruthy()
  })

  it('renders raw text fallback when meta is empty but raw content exists', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      content: [{ type: 'text', text: 'Passage retrieved as plain text' }],
      meta: {},
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText('Passage retrieved as plain text')).toBeTruthy()
  })

  it('renders index coverage complete with chars when pages are omitted', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      meta: {
        items: [],
        coverage: {
          complete: true,
          indexedChars: 5000,
          totalChars: 5000,
        },
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(new RegExp(zh.coverageComplete.trim()))).toBeTruthy()
  })

  it('renders error state with fallback title when raw content is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({ ref: 'zotero://user/0/item/ABCD1234' }),
      },
      isError: true,
      content: [],
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('renders fallback summary when settled without items and without ref', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: JSON.stringify({}),
      },
      meta: null,
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleRetrieve).length).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_retrieve',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'Some text' }],
      meta: null,
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_retrieve',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolTitleRetrieve).length).toBeGreaterThanOrEqual(1)
  })
})
