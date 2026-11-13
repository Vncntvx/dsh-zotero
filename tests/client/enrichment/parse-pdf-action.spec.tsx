// @vitest-environment jsdom
/**
 * The item-level parse action is state-aware: the same button submits a parse
 * while no artifact exists and reads the committed artifact once one does. The
 * result opens in a reader; nothing is added to the attachment list.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsePdfAction } from '../../../src/client/enrichment/ParsePdfAction.tsx'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../../../src/contract.ts'
import type {
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
} from '../../../src/contract.ts'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

const TARGET = { kind: 'attachment' as const, ref: attachmentRef() }
const SESSION = 'parse-session'
const BODY = '# Parsed\n\nEvidence paragraph.'
const READY = {
  kind: 'ready' as const,
  sourceId: 'a'.repeat(64),
  targetLabel: 'Selected PDF',
  mode: 'free' as const,
  artifactId: 'b'.repeat(64),
  fingerprint: 'c'.repeat(64),
  characterCount: BODY.length,
}

function readerOf(pages: (offset: number) => RemoteResult<ZoteroDocumentArtifactResultView>) {
  return vi.fn(
    async (
      request: ZoteroDocumentArtifactRequestView,
    ): Promise<RemoteResult<ZoteroDocumentArtifactResultView>> => pages(request.read?.offset ?? -1),
  )
}

function mount(read: ReturnType<typeof readerOf> | undefined, onParse = vi.fn()) {
  render(
    <ParsePdfAction
      t={mockT}
      sessionId={SESSION}
      target={TARGET}
      title="Selected PDF"
      {...(read !== undefined ? { read } : {})}
      onParse={onParse}
    />,
  )
  return { onParse }
}

describe('the item parse action', () => {
  it('submits a parse while no artifact exists', async () => {
    const { onParse } = mount(readerOf(() => ({ ok: true, value: { kind: 'missing' } })))
    await act(async () => {})
    const button = screen.getByRole('button', {
      name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
    })
    expect(button.textContent).toContain(mockT('libraryParsePdf'))
    fireEvent.click(button)
    expect(onParse).toHaveBeenCalledTimes(1)
  })

  it('becomes a read action once an artifact exists and opens the reader', async () => {
    const read = readerOf((offset) =>
      offset === -1
        ? { ok: true, value: READY }
        : { ok: true, value: { ...READY, page: { offset, text: BODY, totalChars: BODY.length } } },
    )
    const { onParse } = mount(read)
    await act(async () => {})
    const button = screen.getByRole('button', {
      name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
    })
    expect(button.textContent).toContain(mockT('libraryParsedView'))
    fireEvent.click(button)
    await act(async () => {})
    // The probe carried no page request; only opening the reader reads text.
    expect(read.mock.calls[0]![0]).not.toHaveProperty('read')
    expect(onParse).not.toHaveBeenCalled()
    expect(screen.getByText('Parsed')).toBeDefined()
    expect(screen.getByText(/Evidence paragraph/)).toBeDefined()
  })

  it('falls back to the submit action without read access', async () => {
    const { onParse } = mount(undefined)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
      }),
    )
    expect(onParse).toHaveBeenCalledTimes(1)
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

  it('reads more before enabling copy and download', async () => {
    const head = 'h'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS)
    const read = readerOf((offset) => ({
      ok: true,
      value:
        offset === -1
          ? { ...READY, characterCount: head.length + 5 }
          : {
              ...READY,
              characterCount: head.length + 5,
              page: {
                offset,
                text: offset === 0 ? head : 'tail!',
                totalChars: head.length + 5,
              },
            },
    }))
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedCopy') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReadMore') }))
    await act(async () => {})
    expect(read).toHaveBeenLastCalledWith(
      expect.objectContaining({ read: { offset: head.length } }),
    )
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedCopy') }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('keeps a page read failure inline', async () => {
    const read = readerOf((offset) =>
      offset === -1
        ? { ok: true, value: READY }
        : {
            ok: false,
            error: new RemoteError('zotero/enrichment', 'Paging failed', {
              code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
            }),
          },
    )
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('Paging failed')
    // Nothing loaded, so the copy action stays unavailable.
    expect(
      (screen.getByRole('button', { name: mockT('libraryParsedCopy') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('hands "parse again" back to the submit form', async () => {
    const read = readerOf((offset) =>
      offset === -1
        ? { ok: true, value: READY }
        : { ok: true, value: { ...READY, page: { offset, text: BODY, totalChars: BODY.length } } },
    )
    const { onParse } = mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReparse') }))
    expect(onParse).toHaveBeenCalledTimes(1)
  })

  it('reports a thrown page read as an inline error', async () => {
    const read = vi.fn(
      async (
        request: ZoteroDocumentArtifactRequestView,
      ): Promise<RemoteResult<ZoteroDocumentArtifactResultView>> => {
        if (request.read === undefined) return { ok: true, value: READY }
        throw new Error('Connection lost')
      },
    )
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('Connection lost')
  })

  it('downloads the complete text once every page is loaded', async () => {
    const read = readerOf((offset) =>
      offset === -1
        ? { ok: true, value: READY }
        : { ok: true, value: { ...READY, page: { offset, text: BODY, totalChars: BODY.length } } },
    )
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:parsed')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedDownload') }))
      expect(created).toHaveBeenCalledTimes(1)
    } finally {
      created.mockRestore()
      revoke.mockRestore()
    }
  })

  it('falls back to the submit action when the probe rejects', async () => {
    const read = vi.fn(async () => {
      throw new Error('Probe unreachable')
    })
    mount(read as unknown as ReturnType<typeof readerOf>)
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: mockT('libraryParsePdfNamed', { title: 'Selected PDF' }),
      }),
    ).toBeDefined()
  })

  it('shows an artifact page count without a page being read', async () => {
    const read = readerOf((offset) =>
      offset === -1
        ? { ok: true, value: { ...READY, pageCount: 18 } }
        : { ok: true, value: { ...READY, page: { offset, text: BODY, totalChars: BODY.length } } },
    )
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    expect(screen.getByText(/18/)).toBeDefined()
  })

  it('reports a page whose offset does not continue the loaded text', async () => {
    const read = readerOf((offset) =>
      offset === -1
        ? { ok: true, value: READY }
        : {
            ok: true,
            value: { ...READY, page: { offset: offset + 5, text: BODY, totalChars: 99 } },
          },
    )
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain(mockT('libraryParsedNoPage'))
  })

  it('reports a page read that lacks a page arm', async () => {
    const read = readerOf((offset) =>
      offset === -1 ? { ok: true, value: READY } : { ok: true, value: { kind: 'missing' } },
    )
    mount(read)
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: 'Selected PDF' }),
      }),
    )
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain(mockT('libraryParsedNoPage'))
  })

  it('stringifies a non-Error page failure and names an unspeakable file', async () => {
    const read = vi.fn(
      async (
        request: ZoteroDocumentArtifactRequestView,
      ): Promise<RemoteResult<ZoteroDocumentArtifactResultView>> => {
        if (request.read === undefined) return { ok: true, value: READY }
        throw 'plain failure'
      },
    )
    render(
      <ParsePdfAction
        t={mockT}
        sessionId={SESSION}
        target={TARGET}
        title="***"
        read={read}
        onParse={vi.fn()}
      />,
    )
    await act(async () => {})
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryParsedResultNamed', { title: '***' }),
      }),
    )
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('plain failure')
  })
})
