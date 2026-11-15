// @vitest-environment jsdom
/**
 * The item-level parse action is state-aware: the same button submits a parse
 * while no artifact exists and opens the committed artifact once one does. An
 * item with several PDFs asks which one first, in the same chooser the read
 * action uses. Opening is the panel's tab, never an in-place dialog.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { ParsePdfAction } from '../../../src/client/enrichment/ParsePdfAction.tsx'
import type {
  ZoteroAttachmentRowView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
} from '../../../src/contract.ts'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { ParsedDocuments } from '../../../src/client/parsed-documents.ts'

afterEach(cleanup)

const PDF: ZoteroAttachmentRowView = {
  ref: attachmentRef(),
  title: 'Selected PDF',
  contentType: 'application/pdf',
}
const OTHER: ZoteroAttachmentRowView = {
  ref: attachmentRef('OTHERAT1'),
  title: 'Supplement PDF',
  contentType: 'application/pdf',
}
const SESSION = 'parse-session'
const READY = {
  kind: 'ready' as const,
  images: [],
  sourceId: 'a'.repeat(64),
  targetLabel: 'Selected PDF',
  mode: 'free' as const,
  artifactId: 'b'.repeat(64),
  fingerprint: 'c'.repeat(64),
  characterCount: 32,
}

function readerOf(pages: (offset: number) => RemoteResult<ZoteroDocumentArtifactResultView>) {
  return vi.fn(
    async (
      request: ZoteroDocumentArtifactRequestView,
    ): Promise<RemoteResult<ZoteroDocumentArtifactResultView>> => {
      if (request.op === 'probe') {
        // One batched answer folded from the same per-target state the
        // single-target arm gives.
        const state = pages(-1)
        return {
          ok: true,
          value: {
            kind: 'probed',
            results: request.refs.map((ref) => ({
              ref,
              state:
                state.ok && state.value.kind === 'ready'
                  ? ('ready' as const)
                  : ('missing' as const),
            })),
          },
        }
      }
      return pages(request.op === 'page' ? request.offset : -1)
    },
  )
}

/** The attachment ref a request targets; every probe here names an attachment. */
function targetedRef(request: ZoteroDocumentArtifactRequestView): string | undefined {
  return 'target' in request && request.target.kind === 'attachment'
    ? request.target.ref
    : undefined
}

/** One attachment arrives at the panel's opener. */
type ParseCommand = (attachment: ZoteroAttachmentRowView) => void

function mount(
  read: ReturnType<typeof readerOf> | undefined,
  handlers: { onParse?: Mock<ParseCommand>; onOpenParsed?: Mock<ParseCommand> } = {},
  attachments: readonly ZoteroAttachmentRowView[] = [PDF],
) {
  const onParse = handlers.onParse ?? vi.fn<ParseCommand>()
  const onOpenParsed = handlers.onOpenParsed ?? vi.fn<ParseCommand>()
  render(
    <ParsePdfAction
      t={mockT}
      sessionId={SESSION}
      attachments={attachments}
      {...(read !== undefined ? { read } : {})}
      onParse={onParse}
      onOpenParsed={onOpenParsed}
    />,
  )
  return { onParse, onOpenParsed }
}

describe('the item parse action', () => {
  it('submits a parse while no artifact exists', async () => {
    const { onParse, onOpenParsed } = mount(
      readerOf(() => ({ ok: true, value: { kind: 'missing' } })),
    )
    await act(async () => {})
    const button = screen.getByRole('button', {
      name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
    })
    expect(button.textContent).toContain(mockT('libraryParsePdf'))
    fireEvent.click(button)
    expect(onParse).toHaveBeenCalledWith(PDF)
    expect(onOpenParsed).not.toHaveBeenCalled()
  })

  it('becomes a read action once an artifact exists and opens its tab', async () => {
    const read = readerOf(() => ({ ok: true, value: READY }))
    const { onParse, onOpenParsed } = mount(read)
    await act(async () => {})
    const button = screen.getByRole('button', {
      name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
    })
    expect(button.textContent).toContain(mockT('libraryParsedView'))
    fireEvent.click(button)
    expect(onOpenParsed).toHaveBeenCalledWith(PDF)
    expect(onParse).not.toHaveBeenCalled()
    // The probe is metadata only: no page is read to learn that it exists.
    expect(read.mock.calls[0]![0]).not.toHaveProperty('read')
  })

  it('falls back to the submit action without read access', async () => {
    const { onParse } = mount(undefined)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
      }),
    )
    expect(onParse).toHaveBeenCalledWith(PDF)
  })

  it('treats an unreadable probe as absence, not as an error banner', async () => {
    const read = readerOf(() => ({
      ok: false,
      error: new RemoteError('zotero/enrichment', 'Probe failed', {
        code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
      }),
    }))
    mount(read)
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
      }),
    ).toBeDefined()
  })

  it('falls back to the submit action when the probe rejects', async () => {
    const read = vi.fn(async () => {
      throw new Error('Probe unreachable')
    })
    const { onParse } = mount(read as unknown as ReturnType<typeof readerOf>)
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
      }),
    )
    expect(onParse).toHaveBeenCalledWith(PDF)
  })

  it('re-probes every PDF when the revision changes', async () => {
    const read = readerOf(() => ({ ok: true, value: { kind: 'missing' } }))
    const view = (revision?: number) => (
      <ParsePdfAction
        t={mockT}
        sessionId={SESSION}
        attachments={[PDF, OTHER]}
        read={read}
        {...(revision !== undefined ? { revision } : {})}
        onParse={vi.fn()}
      />
    )
    const { rerender } = render(view())
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(1)
    rerender(view(1))
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('re-probes when the parsed-document provider reports a commit or discard', async () => {
    const ready = new Set([PDF.ref])
    const read = vi.fn(async (request: ZoteroDocumentArtifactRequestView) =>
      request.op === 'probe'
        ? {
            ok: true as const,
            value: {
              kind: 'probed' as const,
              results: request.refs.map((ref) => ({
                ref,
                state: ready.has(ref) ? ('ready' as const) : ('missing' as const),
              })),
            },
          }
        : { ok: true as const, value: READY },
    )
    const documents = new ParsedDocuments(
      read as never,
      () => ({ getSnapshot: () => true, subscribe: () => () => {} }),
      vi.fn(),
    )
    const view = () => (
      <ParsePdfAction
        t={mockT}
        sessionId={SESSION}
        attachments={[PDF, OTHER]}
        read={read as never}
        documents={documents}
        onParse={vi.fn()}
      />
    )
    const { rerender } = render(view())
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(1)
    ready.delete(PDF.ref)
    act(() => documents.discarded(SESSION, 'b'.repeat(64)))
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(2)
    rerender(view())
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('asks which PDF to parse when the item carries several', async () => {
    const read = readerOf(() => ({ ok: true, value: { kind: 'missing' } }))
    const { onParse } = mount(read, {}, [PDF, OTHER])
    await act(async () => {})
    // One batched probe answers for every attachment.
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]![0]).toMatchObject({ op: 'probe', refs: [PDF.ref, OTHER.ref] })
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsePdfAny') }))
    await act(async () => {})
    expect(screen.getByRole('heading', { name: mockT('libraryPickPdf') })).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: `${OTHER.title} ${mockT('libraryParsePdfAny')}` }),
    )
    expect(onParse).toHaveBeenCalledWith(OTHER)
  })

  it('marks the parsed PDF in the chooser and opens its tab', async () => {
    const read = vi.fn(
      async (
        request: ZoteroDocumentArtifactRequestView,
      ): Promise<RemoteResult<ZoteroDocumentArtifactResultView>> => {
        if (request.op === 'probe') {
          return {
            ok: true,
            value: {
              kind: 'probed',
              results: request.refs.map((ref) => ({
                ref,
                state: ref === OTHER.ref ? ('ready' as const) : ('missing' as const),
              })),
            },
          }
        }
        return targetedRef(request) === OTHER.ref
          ? { ok: true, value: READY }
          : { ok: true, value: { kind: 'missing' } }
      },
    )
    const { onParse, onOpenParsed } = mount(read, {}, [PDF, OTHER])
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedView') }))
    await act(async () => {})
    expect(screen.getByRole('heading', { name: mockT('libraryPickPdf') })).toBeDefined()
    expect(
      screen.getByRole('button', { name: `${PDF.title} ${mockT('libraryParsePdfAny')}` }),
    ).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: `${OTHER.title} ${mockT('libraryParsedView')}` }),
    )
    expect(onOpenParsed).toHaveBeenCalledWith(OTHER)
    expect(onParse).not.toHaveBeenCalled()
  })

  it('renders nothing for an item without a PDF', async () => {
    const { container } = render(
      <ParsePdfAction
        t={mockT}
        sessionId={SESSION}
        attachments={[]}
        onParse={vi.fn<ParseCommand>()}
      />,
    )
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })

  it('submits the chosen PDF when no tab viewer is available', async () => {
    const read = readerOf(() => ({ ok: true, value: READY }))
    const onParse = vi.fn()
    render(
      <ParsePdfAction
        t={mockT}
        sessionId={SESSION}
        attachments={[PDF, OTHER]}
        read={read}
        onParse={onParse}
      />,
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedView') }))
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', { name: `${PDF.title} ${mockT('libraryParsedView')}` }),
    )
    expect(onParse).toHaveBeenCalledWith(PDF)
  })
})
