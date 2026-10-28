// @vitest-environment jsdom
/** Inspector disclosure, child paging and recovery keep metadata visible. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../src/client/components/library/LibraryInspector.tsx'
import type { ZoteroItemDetailView } from '../../src/contract.ts'
import type { ChildLoadState } from '../../src/client/components/library/useLibraryFeed.ts'
import { ITEM_DETAIL } from './helpers/library-panel-harness.tsx'
import { mockT } from './helpers/mock-translate.ts'
import { zh } from '../../src/client/locales.ts'

afterEach(cleanup)

function mountInspector(detail: ZoteroItemDetailView, childStates = {}) {
  const pageChild = vi.fn(),
    retryChild = vi.fn()
  const props = {
    t: mockT,
    inspector: { phase: 'ready' as const, detail },
    retry: vi.fn(),
    pageChild,
    childStates,
    retryChild,
    inputActions: undefined,
    openFile: undefined,
    resolveAttachment: undefined,
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
})
