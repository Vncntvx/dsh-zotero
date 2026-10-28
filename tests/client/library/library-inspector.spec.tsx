// @vitest-environment jsdom
/** Inspector disclosure, child paging and recovery keep metadata visible. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView, ZoteroItemDetailView } from '../../../src/contract.ts'
import type { ChildLoadState } from '../../../src/client/components/library/useLibraryFeed.ts'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

function mountInspector(
  detail: ZoteroItemDetailView,
  childStates = {},
  inputActions?: InputActions,
  openFile?: (path: string) => void,
  resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>,
) {
  const pageChild = vi.fn(),
    retryChild = vi.fn()
  const props = {
    t: mockT,
    inspector: { phase: 'ready' as const, detail },
    retry: vi.fn(),
    pageChild,
    childStates,
    retryChild,
    inputActions,
    openFile,
    resolveAttachment,
  }
  return { ...render(<LibraryInspector {...props} />), pageChild, retryChild }
}

describe('library inspector', () => {
  it('renders a minimal record with an empty creator and a truncated child note', () => {
    const { attachments: _attachments, ...detail } = ITEM_DETAIL
    mountInspector({
      ...detail,
      creators: [{ creatorType: 'author', name: '' }],
      venue: undefined,
      date: undefined,
      doi: undefined,
      url: undefined,
      extra: undefined,
      notes: {
        ...ITEM_DETAIL.notes!,
        items: [{ ...ITEM_DETAIL.notes!.items[0]!, truncated: true }],
      },
    })
    expect(screen.queryByText(zh.libraryInfoTitle)).toBeNull()
    expect(screen.getByText(zh.libraryAbstractTruncated)).toBeTruthy()
  })
  it('expands a truncated abstract and renders note and attachment format fallbacks', () => {
    mountInspector({
      ...ITEM_DETAIL,
      abstractTruncated: true,
      noteBody: { text: 'Standalone note preview', truncated: true },
      creators: [{ creatorType: 'author', name: 'A Laboratory' }, { creatorType: 'author' }],
      collections: [{ ref: 'zotero://user/0/collection/COLL0001' }],
      attachments: {
        ...ITEM_DETAIL.attachments!,
        total: 4,
        returned: 4,
        items: ['text/html', 'text/markdown', 'text/plain', 'custom'].map((contentType, index) => ({
          ...ITEM_DETAIL.attachments!.items[0]!,
          ref: `attachment-${index}`,
          title: `file-${index}`,
          contentType,
        })),
      },
      annotations: {
        ...ITEM_DETAIL.annotations!,
        items: [{ ...ITEM_DETAIL.annotations!.items[0]!, text: '', comment: 'Margin comment' }],
      },
    })
    const toggle = screen.getByRole('button', { name: zh.libraryExpand })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(
      screen.getByRole('button', { name: zh.libraryCollapse }).getAttribute('aria-expanded'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: zh.libraryCollapse }))
    expect(screen.getByRole('button', { name: zh.libraryExpand })).toBeTruthy()
    for (const text of [
      'Standalone note preview',
      'A Laboratory',
      'HTML',
      'MARKDOWN',
      'PLAIN',
      'CUSTOM',
      'Margin comment',
      'zotero://user/0/collection/COLL0001',
    ])
      expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.readPdf })).toBeNull()
  })

  it('prefers the best attachment for the read action even when it is off-page', () => {
    mountInspector({
      ...ITEM_DETAIL,
      bestAttachment: {
        ref: 'zotero://user/0/item/BEST0001',
        title: 'best.pdf',
        contentType: 'application/pdf',
      },
      attachments: {
        ...ITEM_DETAIL.attachments!,
        items: [{ ...ITEM_DETAIL.attachments!.items[0]!, contentType: 'text/html' }],
      },
    })
    // The head action targets the best attachment, not whatever the current
    // attachment page happens to carry.
    expect(screen.getByRole('button', { name: zh.readPdf })).toBeTruthy()
  })

  it('ignores a non-PDF best attachment and falls back to the current page', () => {
    mountInspector({
      ...ITEM_DETAIL,
      bestAttachment: {
        ref: 'zotero://user/0/item/BEST0001',
        title: 'snapshot.html',
        contentType: 'text/html',
      },
    })
    expect(screen.getByRole('button', { name: zh.readPdf })).toBeTruthy()
  })

  it.each(['attachments', 'notes', 'annotations'] as const)(
    'pages %s independently and exposes an inline retry',
    (kind) => {
      const page = ITEM_DETAIL[kind]!
      const detail = { ...ITEM_DETAIL, [kind]: { ...page, total: 2, nextOffset: 1 } }
      const state: ChildLoadState = { phase: 'error', message: `${kind} failed` }
      const { pageChild, retryChild } = mountInspector(detail, { [kind]: state })
      const title = mockT(
        kind === 'attachments'
          ? 'libraryAttachmentsTitle'
          : kind === 'notes'
            ? 'libraryNotesTitle'
            : 'libraryAnnotationsTitle',
        { count: 2 },
      )
      const section = screen.getByRole('heading', { name: title }).closest('section')!
      expect(within(section).getByRole('alert').textContent).toBe(`${kind} failed`)
      fireEvent.click(within(section).getByRole('button', { name: zh.libraryRetry }))
      expect(retryChild).toHaveBeenCalledWith(kind)
      fireEvent.click(within(section).getByRole('button', { name: zh.libraryPageNext }))
      expect(pageChild).toHaveBeenCalledWith(kind, 1)
      const text =
        kind === 'attachments'
          ? 'paper.pdf'
          : kind === 'notes'
            ? ITEM_DETAIL.notes!.items[0]!.text
            : ITEM_DETAIL.annotations!.items[0]!.text
      expect(within(section).getByText(text)).toBeTruthy()
    },
  )

  it('shows child loading without discarding the current child rows', () => {
    mountInspector(ITEM_DETAIL, { notes: { phase: 'loading' } })
    expect(screen.getByRole('status').textContent).toBe(zh.libraryLoading)
    expect(screen.getByText(ITEM_DETAIL.notes!.items[0]!.text)).toBeTruthy()
  })

  it('renders url copy button and copies on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    mountInspector({
      ...ITEM_DETAIL,
      url: 'https://example.com/paper',
    })

    const urlButton = screen.getByRole('button', { name: 'https://example.com/paper' })
    expect(urlButton).toBeTruthy()
    fireEvent.click(urlButton)
    expect(writeText).toHaveBeenCalledWith('https://example.com/paper')
  })

  it('renders clickable attachment button and resolves file for reader', async () => {
    const openFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'file', path: '/path/to/paper.pdf' },
    })

    mountInspector(ITEM_DETAIL, {}, undefined, openFile, resolveAttachment)

    const attachButton = screen.getByRole('button', { name: 'paper.pdf' })
    expect(attachButton).toBeTruthy()
    fireEvent.click(attachButton)
    await vi.waitFor(() => {
      expect(resolveAttachment).toHaveBeenCalledWith(ITEM_DETAIL.attachments!.items[0]!.ref)
      expect(openFile).toHaveBeenCalledWith('/path/to/paper.pdf')
    })
  })

  it('opens attachment url in new window when resolved to url', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'url', url: 'https://example.com/doc.pdf' },
    })

    mountInspector(ITEM_DETAIL, {}, undefined, undefined, resolveAttachment)

    const attachButton = screen.getByRole('button', { name: 'paper.pdf' })
    fireEvent.click(attachButton)
    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com/doc.pdf',
        '_blank',
        'noopener,noreferrer',
      )
    })
    openSpy.mockRestore()
  })

  it('renders unsupported attachment as non-clickable item', () => {
    mountInspector({
      ...ITEM_DETAIL,
      attachments: {
        offset: 0,
        total: 1,
        returned: 1,
        limit: 1,
        items: [
          {
            ref: 'zotero://user/0/item/ATTAC002',
            title: 'data.xyz',
            contentType: 'application/octet-stream',
          },
        ],
      },
    })

    expect(screen.queryByRole('button', { name: 'data.xyz' })).toBeNull()
    expect(screen.getByText('data.xyz')).toBeTruthy()
  })

  it('displays error message on attachment resolution failure', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'File not found on disk' },
    })

    mountInspector(ITEM_DETAIL, {}, undefined, undefined, resolveAttachment)

    const attachButton = screen.getByRole('button', { name: 'paper.pdf' })
    fireEvent.click(attachButton)
    await vi.waitFor(() => {
      expect(attachButton.getAttribute('title')).toBe('File not found on disk')
    })
  })

  it('collapses and expands child section on header button click', () => {
    mountInspector(ITEM_DETAIL)
    const notesHeaderBtn = screen.getByRole('button', {
      name: `收起笔记（${ITEM_DETAIL.notes!.total}）`,
    })
    expect(notesHeaderBtn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(ITEM_DETAIL.notes!.items[0]!.text)).toBeTruthy()

    // Click to collapse
    fireEvent.click(notesHeaderBtn)
    expect(notesHeaderBtn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(ITEM_DETAIL.notes!.items[0]!.text)).toBeNull()

    // Click to expand again
    fireEvent.click(notesHeaderBtn)
    expect(notesHeaderBtn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(ITEM_DETAIL.notes!.items[0]!.text)).toBeTruthy()
  })

  it('renders clamped note with expand toggle, copy, and chat quote action', () => {
    const longText = 'A'.repeat(250)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const captureInsertion = vi.fn().mockReturnValue({ start: 0, end: 0 })
    const insertText = vi.fn()
    const inputActions = { captureInsertion, insertText } as unknown as InputActions

    mountInspector(
      {
        ...ITEM_DETAIL,
        notes: {
          offset: 0,
          total: 1,
          returned: 1,
          limit: 1,
          items: [{ ref: 'zotero://user/0/item/NOTE999', text: longText, truncated: true }],
        },
      },
      {},
      inputActions,
    )

    // Expand toggle exists
    const toggle = screen.getByRole('button', { name: zh.libraryExpand })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: zh.libraryCollapse })).toBeTruthy()

    // Copy note action
    const copyBtns = screen.getAllByRole('button', { name: zh.copy })
    expect(copyBtns.length).toBeGreaterThan(0)
    fireEvent.click(copyBtns[0]!)
    expect(writeText).toHaveBeenCalledWith(longText)

    // Quote note in chat action
    const quoteNoteBtn = screen.getByRole('button', { name: zh.libraryInsertNote })
    fireEvent.click(quoteNoteBtn)
    expect(captureInsertion).toHaveBeenCalled()
    expect(insertText).toHaveBeenCalledWith(longText, { start: 0, end: 0 })
  })

  it('renders annotation card with color, page badge, comment, clamping, copy, and chat quote', () => {
    const longQuote = 'Important quote from page 5. '.repeat(10)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const captureInsertion = vi.fn().mockReturnValue({ start: 0, end: 0 })
    const insertText = vi.fn()
    const inputActions = { captureInsertion, insertText } as unknown as InputActions

    mountInspector(
      {
        ...ITEM_DETAIL,
        annotations: {
          offset: 0,
          total: 1,
          returned: 1,
          limit: 1,
          items: [
            {
              ref: 'zotero://user/0/item/ANNO999',
              type: 'highlight',
              text: longQuote,
              color: '#ffd400',
              pageLabel: '5',
              comment: 'My thought on this quote.',
            },
          ],
        },
      },
      {},
      inputActions,
    )

    // Page badge
    expect(screen.getByText('P. 5')).toBeTruthy()

    // Comment
    expect(screen.getByText('My thought on this quote.')).toBeTruthy()

    // DSH design specification: card uses stylesheet border without raw inline Zotero hex colors
    const annoItem = screen.getByText('P. 5').closest('li')
    expect(annoItem).toBeTruthy()
    expect(annoItem!.style.borderLeftColor).toBe('')

    // Expand toggle
    const toggle = screen.getByRole('button', { name: zh.libraryExpand })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: zh.libraryCollapse })).toBeTruthy()

    // Copy quote action
    const copyBtns = screen.getAllByRole('button', { name: zh.copy })
    fireEvent.click(copyBtns[copyBtns.length - 1]!)
    expect(writeText).toHaveBeenCalledWith(longQuote)

    // Quote in chat action
    const quoteBtn = screen.getByRole('button', { name: zh.libraryInsertQuote })
    fireEvent.click(quoteBtn)
    expect(captureInsertion).toHaveBeenCalled()
    expect(insertText).toHaveBeenCalledWith(`> "${longQuote}" (P. 5)\n\n`, {
      start: 0,
      end: 0,
    })
  })
})
