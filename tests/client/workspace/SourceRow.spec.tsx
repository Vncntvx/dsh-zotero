// @vitest-environment jsdom
/**
 * The source row and its dossier: provable fact badges, dossier visibility,
 * copy feedback, expansion, prefills, and the dossier sections.
 * @module tests/client/workspace/SourceRow
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { CopyButton } from '../../../src/client/components/CopyButton.tsx'
import { PdfReadButton } from '../../../src/client/components/open/PdfReadButton.tsx'
import { ZoteroLocateActions } from '../../../src/client/components/open/ZoteroLocateActions.tsx'
import { badgesOf } from '../../../src/client/components/workspace/SourceListItem.tsx'
import { artifactOf, passageOf, sourceOf } from '../helpers/source-fixtures.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki, the
// portal machinery); the row only needs the shared DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from '../helpers/mock-translate.ts'
import { writeClipboardSpy } from '../helpers/primitives-stub.ts'

const t = mockT
const writeClipboard = await writeClipboardSpy()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('badgesOf', () => {
  it('returns nothing for a bare source', () => {
    expect(badgesOf(sourceOf({}), t)).toEqual([])
  })

  it('flags a mismatching instance under the issues badge', () => {
    expect(badgesOf(sourceOf({ evidenceMatch: 'mismatch' }), t)).toEqual([zh.issuesBadge])
  })

  it('badges a PDF and stays silent for a resolved non-PDF attachment', () => {
    expect(
      badgesOf(
        sourceOf({
          attachment: {
            ref: 'zotero://user/0/attachment/WXYZ6789',
            kind: 'file',
            contentType: 'application/pdf',
            title: 'a.pdf',
            location: '/tmp/a.pdf',
          },
        }),
        t,
      ),
    ).toEqual([zh.badgePdf])
    expect(
      badgesOf(
        sourceOf({
          attachment: {
            kind: 'url',
            contentType: 'text/html',
            title: 'p',
            location: 'https://e.org',
          },
        }),
        t,
      ),
    ).toEqual([])
  })

  it('badges a resolved web PDF like a file PDF', () => {
    expect(
      badgesOf(
        sourceOf({
          attachment: {
            kind: 'url',
            contentType: 'application/pdf',
            title: 'p',
            location: 'https://e.org/p.pdf',
          },
        }),
        t,
      ),
    ).toEqual([zh.badgePdf])
  })

  it('badges a PDF hint and stays silent for a type-less ref of an older session', () => {
    expect(
      badgesOf(
        sourceOf({
          bestAttachment: {
            ref: 'zotero://user/0/attachment/WXYZ6789',
            contentType: 'application/pdf',
          },
        }),
        t,
      ),
    ).toEqual([zh.badgePdf])
    expect(
      badgesOf(sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/WXYZ6789' } }), t),
    ).toEqual([])
  })

  it('stays silent for a hint without a deep-linkable ref', () => {
    expect(badgesOf(sourceOf({ bestAttachment: { contentType: 'application/pdf' } }), t)).toEqual(
      [],
    )
  })

  it('badges evidence and exports, collapsing every operation into one issues badge', () => {
    const badges = badgesOf(
      sourceOf({
        facts: {
          reportedEvidenceCount: 2,
        },
        evidence: [passageOf(), passageOf({ text: 'A second passage on data retention.' })],
        exports: [artifactOf()],
        operations: { running: 1, failed: 2, stopped: 3 },
      }),
      t,
    )
    expect(badges).toEqual([
      zh.evidenceBadge.replace('{count}', '2'),
      zh.exportBadge.replace('{count}', '1'),
      zh.issuesBadge,
    ])
  })
})

describe('CopyButton', () => {
  it('copies the value, shows the caller label, and swaps to the copied label briefly', async () => {
    vi.useFakeTimers()
    render(<CopyButton value="zotero://user/0/item/A" label={zh.copyRef} copiedLabel={zh.copied} />)
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/A')
    // The copied flag lands on the clipboard promise, not on the click.
    await act(async () => {})
    expect(screen.getByText(zh.copied)).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    vi.useRealTimers()
  })

  it('stays on the action label when the clipboard write is denied', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(false)
    render(<CopyButton value="x" label={zh.copyRef} copiedLabel={zh.copied} />)
    fireEvent.click(screen.getByRole('button'))
    await act(async () => {})
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    expect(screen.queryByText(zh.copied)).toBeNull()
    vi.useRealTimers()
  })

  it('ignores a stale clipboard resolution after a newer click', async () => {
    let resolveFirst!: (ok: boolean) => void
    let resolveSecond!: (ok: boolean) => void
    vi.mocked(writeClipboard)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveSecond = resolve)))
    render(<CopyButton value="x" label={zh.copyRef} copiedLabel={zh.copied} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    // The first click resolves late with success, but its epoch is stale:
    // the flag must not flip for it.
    resolveFirst(true)
    await act(async () => {})
    expect(screen.queryByText(zh.copied)).toBeNull()
    // The second click's own resolution still earns the feedback.
    resolveSecond(true)
    await act(async () => {})
    expect(screen.getByText(zh.copied)).toBeDefined()
  })
})

describe('PdfReadButton', () => {
  it('renders a button and opens the local file path on click without any anchor tag', () => {
    const onOpenFile = vi.fn()
    const { container } = render(
      <PdfReadButton filePath="/path/to/local/paper.pdf" onOpenFile={onOpenFile} t={t} />,
    )
    expect(container.querySelector('a')).toBeNull()
    const button = screen.getByRole('button', { name: new RegExp(zh.readPdf) })
    expect(button).toBeDefined()
    fireEvent.click(button)
    expect(onOpenFile).toHaveBeenCalledWith('/path/to/local/paper.pdf')
  })

  it('resolves the attachment on demand when filePath is not yet known', async () => {
    const onOpenFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'file', path: '/resolved/path/paper.pdf' },
    })
    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/attachment/WXYZ6789"
        resolveAttachment={resolveAttachment}
        onOpenFile={onOpenFile}
        t={t}
      />,
    )
    const button = screen.getByRole('button', { name: new RegExp(zh.readPdf) })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(resolveAttachment).toHaveBeenCalledWith('zotero://user/0/attachment/WXYZ6789')
    expect(onOpenFile).toHaveBeenCalledWith('/resolved/path/paper.pdf')
  })

  it('displays error feedback when attachment resolution fails', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: zh.pdfFileNotFound },
    })
    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/attachment/MISSING1"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )
    const button = screen.getByRole('button', { name: new RegExp(zh.readPdf) })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByText(zh.pdfFileNotFound)).toBeDefined()
  })

  it('opens web URLs in a new browser window/tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<PdfReadButton webUrl="https://example.org/paper.pdf" t={t} />)
    const button = screen.getByRole('button', { name: new RegExp(zh.readPdf) })
    fireEvent.click(button)
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.org/paper.pdf',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })
})

describe('ZoteroLocateActions', () => {
  it('renders copy title and copy link buttons with zero external protocol anchors', () => {
    const { container } = render(
      <ZoteroLocateActions
        title="Attention Is All You Need"
        selectUrl="zotero://select/library/items/ABCDEFGH"
        t={t}
      />,
    )
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(screen.getByText(zh.copyTitle)).toBeDefined()
    expect(screen.getByText(zh.copyZoteroLink)).toBeDefined()

    fireEvent.click(screen.getByText(zh.copyTitle))
    expect(writeClipboard).toHaveBeenCalledWith('Attention Is All You Need')

    fireEvent.click(screen.getByText(zh.copyZoteroLink))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://select/library/items/ABCDEFGH')
  })
})
