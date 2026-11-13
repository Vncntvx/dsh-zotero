import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS, LIBRARY_SECTIONS } from '../../../src/library-preferences.ts'
// @vitest-environment jsdom
/** Inspector disclosure, child paging and recovery keep metadata visible. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView, ZoteroItemDetailView } from '../../../src/contract.ts'
import type { ChildLoadState } from '../../../src/client/components/library/library-feed-types.ts'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

function mountInspector(
  detail: ZoteroItemDetailView,
  childStates = {},
  inputActions?: InputActions,
  openFile?: (path: string, options?: any) => void,
  resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>,
  parse?: Pick<Parameters<typeof LibraryInspector>[0], 'parsePdf' | 'parsedArtifact'>,
) {
  const pageChild = vi.fn(),
    retryChild = vi.fn()
  const openProtocol = vi.fn(async () => true)
  const props = {
    t: mockT,
    inspector: { phase: 'ready' as const, detail },
    retry: vi.fn(),
    pageChild,
    childStates,
    retryChild,
    inputActions,
    openFile,
    resolveAttachment:
      resolveAttachment ??
      (async (ref: string) => ({
        ok: true as const,
        value: {
          ref,
          kind: 'file' as const,
          title: 'paper.pdf',
          contentType: 'application/pdf',
          path: '/tmp/paper.pdf',
        },
      })),
    openProtocol,
    ...parse,
  }
  return {
    ...render(
      <LibraryPreferencesContext.Provider
        value={{ preferences: { ...LIBRARY_DEFAULTS, detailExpandedSections: LIBRARY_SECTIONS } }}
      >
        <LibraryInspector {...props} />
      </LibraryPreferencesContext.Provider>,
    ),
    pageChild,
    retryChild,
    openProtocol,
  }
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
    const toggle = screen.getByRole('button', { name: '收起摘要' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '展开摘要' }))
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

  it('renders doi copy button and copies on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    mountInspector({
      ...ITEM_DETAIL,
      doi: '10.1038/s41467-023-38203-3',
    })

    const doiButton = screen.getByRole('button', { name: '10.1038/s41467-023-38203-3' })
    expect(doiButton).toBeTruthy()
    fireEvent.click(doiButton)
    expect(writeText).toHaveBeenCalledWith('10.1038/s41467-023-38203-3')
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
    const insertQuote = vi.fn().mockReturnValue(true)
    const inputActions = { insertQuote } as unknown as InputActions

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
    expect(insertQuote).toHaveBeenCalledWith(longText)
  })

  it('renders annotation card with color, page badge, comment, clamping, copy, and chat quote', () => {
    const longQuote = 'Important quote from page 5. '.repeat(10)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const insertQuote = vi.fn().mockReturnValue(true)
    const inputActions = { insertQuote } as unknown as InputActions

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
    expect(insertQuote).toHaveBeenCalledWith(
      `"${longQuote}"${mockT('annotationPageSuffix', { page: 5 })}`,
    )
  })

  it('displays annotation page as plain provenance text', async () => {
    const openFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT00001',
        kind: 'file',
        path: '/storage/sample.pdf',
      },
    })

    mountInspector(
      {
        ...ITEM_DETAIL,
        attachments: {
          offset: 0,
          total: 1,
          returned: 1,
          limit: 1,
          items: [
            {
              ref: 'zotero://user/0/item/ATT00001',
              title: 'sample.pdf',
              contentType: 'application/pdf',
            },
          ],
        },
        annotations: {
          offset: 0,
          total: 1,
          returned: 1,
          limit: 1,
          items: [
            {
              ref: 'zotero://user/0/item/ANNO0001',
              type: 'highlight',
              text: 'Highlighted passage',
              pageLabel: '7',
            },
          ],
        },
      },
      {},
      undefined,
      openFile,
      resolveAttachment,
    )

    const badge = screen.getByText('P. 7')
    expect(badge).toBeTruthy()
    await act(async () => {
      fireEvent.click(badge)
    })

    expect(resolveAttachment).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
    expect(resolveAttachment).not.toHaveBeenCalled()
  })

  it('triggers protocol dispatch with a deep link when clicking annotation open in zotero button', () => {
    const { openProtocol } = mountInspector({
      ...ITEM_DETAIL,
      attachments: {
        offset: 0,
        total: 1,
        returned: 1,
        limit: 1,
        items: [
          {
            ref: 'zotero://user/0/item/ATTAC001',
            title: 'sample.pdf',
            contentType: 'application/pdf',
          },
        ],
      },
      annotations: {
        offset: 0,
        total: 1,
        returned: 1,
        limit: 1,
        items: [
          {
            ref: 'zotero://user/0/item/ANNO0001',
            type: 'highlight',
            text: 'Highlighted passage',
            pageLabel: '7',
          },
        ],
      },
    })

    const openBtns = screen.getAllByRole('button', { name: zh.openInZotero })
    expect(openBtns.length).toBeGreaterThanOrEqual(1)
    const annoOpenBtn = openBtns[openBtns.length - 1]!
    fireEvent.click(annoOpenBtn)
    expect(openProtocol).toHaveBeenCalledTimes(1)
  })

  it('renders extra metadata row and handles attachment row clicks', async () => {
    const openFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT00001',
        kind: 'file',
        path: '/storage/sample.pdf',
      },
    })

    mountInspector(
      {
        ...ITEM_DETAIL,
        extra: 'Citation Key: test2024',
        attachments: {
          offset: 0,
          total: 1,
          returned: 1,
          limit: 1,
          items: [
            {
              ref: 'zotero://user/0/item/ATT00001',
              title: 'sample.pdf',
              contentType: 'application/pdf',
            },
          ],
        },
      },
      {},
      undefined,
      openFile,
      resolveAttachment,
    )

    // Extra metadata
    expect(screen.getByText('Citation Key: test2024')).toBeTruthy()

    // Attachment row click
    const attBtn = screen.getByRole('button', { name: 'sample.pdf' })
    await act(async () => {
      fireEvent.click(attBtn)
    })
    expect(openFile).toHaveBeenCalledWith('/storage/sample.pdf')
  })

  it('opens external zotero url via direct open-in-zotero button', () => {
    const { openProtocol } = mountInspector(ITEM_DETAIL)
    const openBtns = screen.getAllByRole('button', { name: zh.openInZotero })
    expect(openBtns.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(openBtns[0]!)
    expect(openProtocol).toHaveBeenCalledTimes(1)
  })

  it('opens external browser window when clicking DOI and URL link buttons', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    // 1. Bare DOI and URL
    mountInspector({
      ...ITEM_DETAIL,
      doi: '10.1038/s41467-023-38203-3',
      url: 'https://example.com/paper',
    })

    const doiLinkBtn = screen.getByRole('button', {
      name: `https://doi.org/10.1038/s41467-023-38203-3 (${zh.openInZotero})`,
    })
    fireEvent.click(doiLinkBtn)
    expect(openSpy).toHaveBeenCalledWith(
      'https://doi.org/10.1038/s41467-023-38203-3',
      '_blank',
      'noopener,noreferrer',
    )

    const urlLinkBtn = screen.getByRole('button', {
      name: `https://example.com/paper (${zh.openInZotero})`,
    })
    fireEvent.click(urlLinkBtn)
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/paper',
      '_blank',
      'noopener,noreferrer',
    )

    // 2. HTTP DOI
    cleanup()
    mountInspector({
      ...ITEM_DETAIL,
      doi: 'http://dx.doi.org/10.1000/182',
    })
    const httpDoiBtn = screen.getByRole('button', {
      name: `http://dx.doi.org/10.1000/182 (${zh.openInZotero})`,
    })
    fireEvent.click(httpDoiBtn)
    expect(openSpy).toHaveBeenCalledWith(
      'http://dx.doi.org/10.1000/182',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('shows an insertion failure without replacing the existing draft', () => {
    const inputActions = {
      insertQuote: vi.fn(() => false),
      captureInsertion: vi.fn(),
      insertText: vi.fn(),
      setDraft: vi.fn(),
      persistDraft: vi.fn(),
    }
    mountInspector(ITEM_DETAIL, {}, inputActions as unknown as InputActions)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryAskInChat }))
    expect(inputActions.insertQuote).toHaveBeenCalledWith(expect.stringContaining(ITEM_DETAIL.ref))
    expect(screen.getByRole('alert').textContent).toBe(zh.libraryInsertFailed)
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.insertText).not.toHaveBeenCalled()
    expect(inputActions.persistDraft).not.toHaveBeenCalled()
  })

  it('puts the parse action in the header beside Read PDF, not in the attachment list', async () => {
    const parsePdf = vi.fn()
    const read = vi.fn(async () => ({ ok: true as const, value: { kind: 'missing' as const } }))
    mountInspector(ITEM_DETAIL, {}, undefined, undefined, undefined, {
      parsePdf,
      parsedArtifact: { sessionId: 'parse-session', read, revision: 1 },
    })
    await act(async () => {})
    // One header action, named for the item's primary PDF.
    const parseButtons = screen.getAllByRole('button', {
      name: zh.libraryParsePdfNamed.replace('{title}', 'paper.pdf'),
    })
    expect(parseButtons).toHaveLength(1)
    expect(screen.queryByRole('button', { name: zh.libraryParsePdf })).toBeNull()
    fireEvent.click(parseButtons[0]!)
    expect(parsePdf).toHaveBeenCalledTimes(1)
    expect(parsePdf.mock.calls[0]![0]).toMatchObject({ contentType: 'application/pdf' })
  })
})
