// @vitest-environment jsdom
/**
 * The item's PDF actions: one PDF opens directly, several ask which one first,
 * and the parse action sits beside the read action over the same list.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfActions } from '../../../src/client/components/library/PdfActions.tsx'
import type { ZoteroAttachmentRowView } from '../../../src/contract.ts'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

const PDF: ZoteroAttachmentRowView = {
  ref: attachmentRef(),
  title: 'paper.pdf',
  contentType: 'application/pdf',
}
const OTHER: ZoteroAttachmentRowView = {
  ref: attachmentRef('OTHERAT1'),
  title: 'supplement.pdf',
  contentType: 'application/pdf',
}

/** The attachment resolver the panel pairs with every read command. */
const resolveAttachment = vi.fn(async (ref: string) => ({
  ok: true as const,
  value: {
    ref,
    kind: 'file' as const,
    path: '/tmp/paper.pdf',
    title: 'paper.pdf',
    contentType: 'application/pdf',
  },
}))

describe('the item PDF actions', () => {
  it('reads a single PDF directly', async () => {
    const readPdf = vi.fn(async () => {})
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF]}
        readPdf={readPdf}
        resolveAttachment={resolveAttachment}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    await act(async () => {})
    expect(readPdf).toHaveBeenCalledWith(PDF.ref)
  })

  it('asks which PDF to read when the item carries several', async () => {
    const readPdf = vi.fn(async () => {})
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF, OTHER]}
        readPdf={readPdf}
        resolveAttachment={resolveAttachment}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    expect(readPdf).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: mockT('libraryPickPdfRead') })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: `${OTHER.title} ${mockT('readPdf')}` }))
    await act(async () => {})
    expect(readPdf).toHaveBeenCalledWith(OTHER.ref)
    // The chooser gets out of the way once the reader took over.
    expect(screen.queryByRole('heading', { name: mockT('libraryPickPdfRead') })).toBeNull()
  })

  it('keeps the chooser open with the reason when a read fails', async () => {
    const readPdf = vi.fn(async () => {
      throw new Error('Zotero is closed')
    })
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF, OTHER]}
        readPdf={readPdf}
        resolveAttachment={resolveAttachment}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    fireEvent.click(screen.getByRole('button', { name: `${PDF.title} ${mockT('readPdf')}` }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('Zotero is closed')
    expect(screen.getByRole('heading', { name: mockT('libraryPickPdfRead') })).toBeDefined()
  })

  it('stringifies a read that throws a plain value', async () => {
    const readPdf = vi.fn(async () => {
      throw 'plain failure'
    })
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF, OTHER]}
        readPdf={readPdf}
        resolveAttachment={resolveAttachment}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    fireEvent.click(screen.getByRole('button', { name: `${PDF.title} ${mockT('readPdf')}` }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('plain failure')
  })

  it('closes the read chooser without reading', async () => {
    const readPdf = vi.fn(async () => {})
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF, OTHER]}
        readPdf={readPdf}
        resolveAttachment={resolveAttachment}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    fireEvent.click(screen.getByRole('button', { name: mockT('parseClose') }))
    expect(screen.queryByRole('heading', { name: mockT('libraryPickPdfRead') })).toBeNull()
    expect(readPdf).not.toHaveBeenCalled()
  })

  it('disables the chooser without a way to open a file', () => {
    render(<PdfActions t={mockT} attachments={[PDF, OTHER]} />)
    const button = screen.getByRole('button', { name: mockT('readPdf') }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toBe(mockT('libraryNoSessionForOpen'))
  })

  it('seats the parse action over the same PDF list', async () => {
    const onParse = vi.fn()
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF]}
        readPdf={vi.fn(async () => {})}
        parse={{ sessionId: 'parse-session', onParse }}
      />,
    )
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsePdfNamed', { title: PDF.title }),
      }),
    )
    expect(onParse).toHaveBeenCalledWith(PDF)
  })

  it('hands a parsed attachment to the tab opener', async () => {
    const onOpenParsed = vi.fn()
    const read = vi.fn(async (request: { op: string; refs?: readonly string[] }) => {
      if (request.op === 'probe') {
        return {
          ok: true as const,
          value: {
            kind: 'probed' as const,
            results: (request.refs ?? []).map((ref) => ({ ref, state: 'ready' as const })),
          },
        }
      }
      return {
        ok: true as const,
        value: {
          kind: 'ready' as const,
          images: [],
          sourceId: 'a'.repeat(64),
          targetLabel: PDF.title,
          mode: 'free' as const,
          artifactId: 'b'.repeat(64),
          fingerprint: 'c'.repeat(64),
          characterCount: 12,
        },
      }
    })
    render(
      <PdfActions
        t={mockT}
        attachments={[PDF]}
        readPdf={vi.fn(async () => {})}
        resolveAttachment={resolveAttachment}
        parse={{ sessionId: 'parse-session', read, onParse: vi.fn(), onOpenParsed }}
      />,
    )
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: PDF.title }),
      }),
    )
    expect(onOpenParsed).toHaveBeenCalledWith(PDF)
  })

  it('renders nothing without a PDF', () => {
    const { container } = render(<PdfActions t={mockT} attachments={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
