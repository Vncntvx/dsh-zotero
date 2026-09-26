// @vitest-environment jsdom
/**
 * Test suite for ExportToolView:
 * citation code blocks, format badges, copy actions, item attribution links, and empty states.
 * @module tests/client/toolviews/ExportToolView
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { ExportToolView } from '../../../src/client/toolviews/ExportToolView.tsx'
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

function renderView(props: Parameters<typeof createToolViewProps<'zotero_export'>>[0]) {
  return render(<ExportToolView {...createToolViewProps(props)} />)
}

describe('ExportToolView', () => {
  it('renders running state with export running indicator', () => {
    const block = running({
      name: 'zotero_export',
      argsRaw: JSON.stringify({ format: 'bibtex', refs: ['zotero://user/0/item/ABCD1234'] }),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(false),
      t: mockT,
    })

    expect(screen.getByText(zh.toolExportRunning)).toBeTruthy()
  })

  it('renders running state with toolRunning in body when expanded', () => {
    const block = running({
      name: 'zotero_export',
      argsRaw: JSON.stringify({ format: 'bibtex' }),
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'start',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolExportRunning).length).toBeGreaterThanOrEqual(1)
  })

  it('renders citation code block, format badge, copy button, and item links', () => {
    const bibtexSnippet = '@article{test2024,\n  title = {Quantum Test}\n}'
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: JSON.stringify({ format: 'bibtex', refs: ['zotero://user/0/item/ABCD1234'] }),
      },
      content: [{ type: 'text', text: bibtexSnippet }],
      meta: {
        format: 'bibtex',
        refs: ['zotero://user/0/item/ABCD1234'],
        items: [
          {
            ref: 'zotero://user/0/item/ABCD1234',
            title: 'Quantum Test',
            key: 'ABCD1234',
          },
          {
            ref: 'zotero://user/0/item/WXYZ6789',
            title: '',
            key: 'WXYZ6789',
          },
        ],
      },
    })

    const { container } = renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryExport', { format: 'BibTeX', count: 1 })),
    ).toBeTruthy()
    expect(container.querySelector('pre')?.textContent).toBe(bibtexSnippet)
    expect(screen.getByText(mockT('exportRefCount', { count: 1 }))).toBeTruthy()
    expect(screen.getByText('Quantum Test')).toBeTruthy()

    const selectLink = container.querySelector('a[href^="zotero://select/"]')
    expect(selectLink?.getAttribute('href')).toBe('zotero://select/library/items/ABCD1234')
  })

  it('renders alternative export format such as CSLJSON', () => {
    const jsonSnippet = '[\n  {\n    "id": "item1",\n    "type": "book"\n  }\n]'
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: JSON.stringify({ format: 'csljson', refs: ['zotero://user/0/item/ABCD1234'] }),
      },
      content: [{ type: 'text', text: jsonSnippet }],
      meta: {
        format: 'csljson',
        refs: ['zotero://user/0/item/ABCD1234'],
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryExport', { format: 'CSL JSON', count: 1 })),
    ).toBeTruthy()
  })

  it('renders empty result message when export text is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: JSON.stringify({ format: 'bibtex' }),
      },
      content: [],
      meta: {
        format: 'bibtex',
        refs: [],
      },
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getByText(zh.toolNoResults)).toBeTruthy()
  })

  it('renders error state when export failed', () => {
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: JSON.stringify({ format: 'bibtex' }),
      },
      isError: true,
      content: [{ type: 'text', text: 'Export format unsupported' }],
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText('Export format unsupported').length).toBeGreaterThanOrEqual(1)
  })

  it('renders default bibtex format and zero count when args/meta omit format and refs', () => {
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: JSON.stringify({}),
      },
      content: [{ type: 'text', text: 'plain text' }],
      meta: null,
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryExport', { format: 'BibTeX', count: 0 })),
    ).toBeTruthy()
  })

  it('renders error state with fallback title when raw content is empty', () => {
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: JSON.stringify({}),
      },
      isError: true,
      content: [],
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(screen.getAllByText(zh.toolFailed).length).toBeGreaterThanOrEqual(1)
  })

  it('handles malformed argsRaw where argsOf returns null', () => {
    const block = settled({
      call: {
        name: 'zotero_export',
        argsRaw: '{bad-json',
      },
      content: [{ type: 'text', text: 'plain text' }],
      meta: null,
    })

    renderView({
      callId: 'c1',
      toolName: 'zotero_export',
      phase: 'result',
      block,
      useDisclosure: mockUseDisclosure(true),
      t: mockT,
    })

    expect(
      screen.getByText(mockT('toolSummaryExport', { format: 'BibTeX', count: 0 })),
    ).toBeTruthy()
  })
})
