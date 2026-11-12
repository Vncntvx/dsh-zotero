// @vitest-environment jsdom
/**
 * The SourceAuditPanel component: citation generation (BibTeX / GB/T 7714),
 * one-click copy actions, coverage progress calculation, retrieval timeline,
 * source availability breakdown, and the technical ref identifier.
 * @module tests/client/workspace/SourceAuditPanel
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SourceAuditPanel } from '../../../src/client/components/workspace/SourceAuditPanel.tsx'
import type {
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
} from '../../../src/contract.ts'
import { searchOf, sourceOf } from '../helpers/source-fixtures.ts'
import { deferred } from '../../helpers/sync.ts'

import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

const t = mockT
const writeClipboard = clipboardWrites

const BIBTEX_RESULT: ZoteroLibraryExportResultView = {
  format: 'bibtex',
  text: '@article{authoritative2024,\n  title = {Authoritative title}\n}',
}

function exportStub(result: ZoteroLibraryExportResultView = BIBTEX_RESULT): (
  request: ZoteroLibraryExportRequestView,
) => Promise<{
  ok: true
  value: ZoteroLibraryExportResultView
}> {
  return vi.fn(async () => ({ ok: true as const, value: result }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourceAuditPanel component', () => {
  it('renders and copies only the authoritative remote citation', async () => {
    const exportCitation = exportStub()
    const item = sourceOf({
      key: 'zotero://user/0/item/ITEMKEY1',
      ref: 'zotero://user/0/item/ITEMKEY1',
      title: 'Local title that must not be fabricated',
      creators: 'Local author',
    })

    render(<SourceAuditPanel item={item} t={t} canExport exportCitation={exportCitation} />)

    expect(await screen.findByText(/@article\{authoritative2024,/)).toBeTruthy()
    expect(screen.queryByText(/Local title that must not be fabricated/)).toBeNull()
    expect(exportCitation).toHaveBeenCalledWith({ refs: [item.ref], format: 'bibtex' })

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: t('copy') })[0]!)
    })
    expect(writeClipboard).toHaveBeenCalledWith(BIBTEX_RESULT.text)
  })

  it('requests Zotero GB/T bibliography output without synthesizing missing metadata', async () => {
    const exportCitation = exportStub({
      format: 'bibliography',
      text: '<div class="csl-entry">Zotero GB/T result</div>',
    })
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY3',
      title: undefined,
      creators: undefined,
      year: undefined,
      venue: undefined,
    })

    render(<SourceAuditPanel item={item} t={t} canExport exportCitation={exportCitation} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: t('gbt7714Format') }))
    })

    expect(await screen.findByText('Zotero GB/T result')).toBeTruthy()
    expect(screen.queryByText(/佚名|无题/)).toBeNull()
    expect(exportCitation).toHaveBeenLastCalledWith({
      refs: [item.ref],
      format: 'bibliography',
      style: 'china-national-standard-gb-t-7714-2015-numeric',
      locale: 'zh-CN',
    })
  })

  it('shows remote failures as visible errors without fallback content', async () => {
    const exportCitation = vi.fn(async (_request: ZoteroLibraryExportRequestView) => ({
      ok: false as const,
      error: new RemoteError('zotero/domain', 'Zotero export failed', {
        code: 'ZOTERO_EXPORT_FAILED',
      }),
    }))
    const item = sourceOf({ title: 'Failure title' })
    render(<SourceAuditPanel item={item} t={t} canExport exportCitation={exportCitation} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Zotero export failed')
    expect(screen.queryByText(/Failure title/)).toBeNull()
  })

  it('surfaces promise rejections from citation export as alerts', async () => {
    const exportCitation = vi.fn().mockRejectedValue(new Error('Network disconnected'))
    const item = sourceOf({ title: 'Rejection title' })
    render(<SourceAuditPanel item={item} t={t} canExport exportCitation={exportCitation} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Network disconnected')
  })

  it('shows denied and empty citation states without fallback content', async () => {
    const item = sourceOf({ title: 'Must not become a citation' })
    const { unmount } = render(<SourceAuditPanel item={item} t={t} />)
    expect(screen.getByText(t('sourceCitationDenied'))).toBeTruthy()
    expect(screen.queryByText(/@article/)).toBeNull()
    unmount()

    render(
      <SourceAuditPanel
        item={item}
        t={t}
        canExport
        exportCitation={exportStub({ format: 'bibtex', text: '   ' })}
      />,
    )
    expect(await screen.findByText(t('sourceCitationEmpty'))).toBeTruthy()
    expect(screen.queryByText(/Must not become a citation/)).toBeNull()
  })

  it('reports an unavailable exporter instead of a citation when the workspace has none', () => {
    const item = sourceOf({ title: 'Must not become a citation' })
    render(<SourceAuditPanel item={item} t={t} canExport />)
    expect(screen.getByText(t('sourceCitationUnavailable'))).toBeTruthy()
    expect(screen.queryByText(/@article/)).toBeNull()
  })

  it('keeps the citation out of reach until the request settles', () => {
    const pending = deferred<{ ok: true; value: ZoteroLibraryExportResultView }>()
    const exportCitation = vi.fn(() => pending.promise)
    const item = sourceOf({ title: 'Must not become a citation' })
    render(<SourceAuditPanel item={item} t={t} canExport exportCitation={exportCitation} />)
    expect(screen.getByText(t('sourceCitationLoading'))).toBeTruthy()
    const copyBtn = screen.getAllByRole('button', { name: t('copy') })[0]! as HTMLButtonElement
    expect(copyBtn.disabled).toBe(true)
  })

  it('drops a late citation response after the selected source changes', async () => {
    const first = deferred<{ ok: true; value: ZoteroLibraryExportResultView }>()
    const second = deferred<{ ok: true; value: ZoteroLibraryExportResultView }>()
    const exportCitation = vi
      .fn<
        (
          request: ZoteroLibraryExportRequestView,
        ) => Promise<{ ok: true; value: ZoteroLibraryExportResultView }>
      >()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const itemA = sourceOf({ key: 'a', ref: 'zotero://user/0/item/AAAAAAA1' })
    const itemB = sourceOf({ key: 'b', ref: 'zotero://user/0/item/BBBBBBB2' })
    const view = render(
      <SourceAuditPanel item={itemA} t={t} canExport exportCitation={exportCitation} />,
    )
    view.rerender(<SourceAuditPanel item={itemB} t={t} canExport exportCitation={exportCitation} />)
    await act(async () => {
      second.resolve({ ok: true, value: { format: 'bibtex', text: '@book{B}' } })
      await second.promise
    })
    expect(await screen.findByText(/@book\{B\}/)).toBeTruthy()
    await act(async () => {
      first.resolve({ ok: true, value: { format: 'bibtex', text: '@book{A}' } })
      await first.promise
    })
    expect(screen.queryByText(/@book\{A\}/)).toBeNull()
    expect(screen.getByText(/@book\{B\}/)).toBeTruthy()
  })

  it('renders indexing coverage bar for complete, page-based, and char-based metrics', () => {
    // 1. Page-based coverage
    const pageItem = sourceOf({
      retrievalFacts: {
        truncated: false,
        coverage: {
          complete: false,
          indexedPages: 8,
          totalPages: 10,
        },
        sourceAvailability: {},
      },
    })
    const { unmount: unmount1 } = render(<SourceAuditPanel item={pageItem} t={t} />)
    expect(screen.getByText('80%')).toBeTruthy()
    unmount1()

    // 2. Char-based coverage
    const charItem = sourceOf({
      retrievalFacts: {
        truncated: false,
        coverage: {
          complete: false,
          indexedChars: 500,
          totalChars: 1000,
        },
        sourceAvailability: {},
      },
    })
    const { unmount: unmount2 } = render(<SourceAuditPanel item={charItem} t={t} />)
    expect(screen.getByText('50%')).toBeTruthy()
    unmount2()

    // 3. Complete coverage
    const completeItem = sourceOf({
      retrievalFacts: {
        truncated: false,
        coverage: {
          complete: true,
        },
        sourceAvailability: {},
      },
    })
    const { unmount: unmount3 } = render(<SourceAuditPanel item={completeItem} t={t} />)
    expect(screen.getByText('100%')).toBeTruthy()
    unmount3()

    // 4. Incomplete without pages/chars
    const incompleteItem = sourceOf({
      retrievalFacts: {
        truncated: false,
        coverage: {
          complete: false,
        },
        sourceAvailability: {},
      },
    })
    const { unmount: unmount4 } = render(<SourceAuditPanel item={incompleteItem} t={t} />)
    expect(screen.getByText('0%')).toBeTruthy()
    unmount4()
  })

  it('renders retrieval occurrences timeline and handles empty searches', () => {
    // With searches
    const itemWithSearches = sourceOf({
      searches: [
        searchOf({
          callId: 's1',
          query: 'transformers',
          scope: { kind: 'collection', name: 'NLP Papers' },
          tags: ['deep-learning'],
          returned: 3,
          total: 5,
          noteMatches: 2,
        }),
        searchOf({
          callId: 's2',
          query: '',
          returned: 1,
          total: 1,
        }),
      ],
    })

    const { unmount } = render(<SourceAuditPanel item={itemWithSearches} t={t} />)
    expect(screen.getByText(t('retrievalTimeline'))).toBeTruthy()
    expect(screen.getByText(/transformers/)).toBeTruthy()
    expect(screen.getByText(/deep-learning/)).toBeTruthy()
    expect(
      screen.getByText(new RegExp(t('searchEpisodeNoteHits', { noteMatches: 2 }))),
    ).toBeTruthy()
    unmount()

    // Empty searches
    const emptyItem = sourceOf({ searches: [] })
    render(<SourceAuditPanel item={emptyItem} t={t} />)
    expect(screen.getByText(t('overviewNoSearch'))).toBeTruthy()
  })

  it('renders source availability breakdown', () => {
    const item = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {
          PDF: { requested: true, unavailable: false, returnedPassages: 3 },
          ZoteroNotes: { requested: true, unavailable: false, returnedPassages: 0 },
          WebSnapshot: { requested: true, unavailable: true, returnedPassages: 0 },
        },
      },
    })

    render(<SourceAuditPanel item={item} t={t} />)
    expect(screen.getByText(t('availabilityTitle'))).toBeTruthy()
    expect(screen.getByText(t('availUnavailable'))).toBeTruthy()
    expect(screen.getByText(t('availNoMatch'))).toBeTruthy()
    expect(screen.getByText(t('availReturned', { count: 3 }))).toBeTruthy()
  })

  it('copies technical ref identifier on button click', async () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/REFKEY123',
    })

    render(<SourceAuditPanel item={item} t={t} />)
    expect(screen.getByText('zotero://user/0/item/REFKEY123')).toBeTruthy()

    const copyBtns = screen.getAllByRole('button', { name: t('copy') })
    const refCopyBtn = copyBtns[copyBtns.length - 1]!
    await act(async () => {
      fireEvent.click(refCopyBtn)
    })
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/REFKEY123')
  })
})
