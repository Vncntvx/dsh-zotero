// @vitest-environment jsdom
/**
 * The SourceEvidence component: passages feed, retrieval summary head,
 * truncated budget limits, jump-to-sidebar PDF actions (direct and resolved),
 * grounding context hints, and empty/omitted state notes.
 * @module tests/client/workspace/SourceEvidence
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  SourceEvidence,
  retrievalSummaryLineOf,
} from '../../../src/client/components/workspace/SourceEvidence.tsx'
import { passageOf, sourceOf } from '../helpers/source-fixtures.ts'

import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourceEvidence helpers', () => {
  it('formats retrieval summary line with and without budget truncation', () => {
    const itemWithoutSummary = sourceOf({ retrievalSummary: undefined })
    expect(retrievalSummaryLineOf(itemWithoutSummary, t)).toBe('')

    const itemNormal = sourceOf({
      fulltextReads: [],
      evidenceTotal: 5,
      facts: { reportedEvidenceCount: 7 },
      retrievalSummary: {
        runCount: 2,
        truncated: false,
      },
    })
    const lineNormal = retrievalSummaryLineOf(itemNormal, t)
    expect(lineNormal).toContain(t('retrievalRunCount', { count: 2 }))
    expect(lineNormal).toContain(t('retrievalKeptCount', { count: 5 }))
    expect(lineNormal).toContain(t('retrievalReportedCount', { count: 7 }))
    expect(lineNormal).not.toContain(t('budgetLimitedNote'))

    const itemTruncated = sourceOf({
      fulltextReads: [],
      evidenceTotal: 5,
      facts: { reportedEvidenceCount: 7 },
      retrievalSummary: {
        runCount: 2,
        truncated: true,
      },
    })
    const lineTruncated = retrievalSummaryLineOf(itemTruncated, t)
    expect(lineTruncated).toContain(t('budgetLimitedNote'))
  })
})

describe('SourceEvidence component', () => {
  it('renders unretrieved state when retrievalFacts is undefined', () => {
    const item = sourceOf({ retrievalFacts: undefined })
    render(<SourceEvidence item={item} t={t} />)
    expect(screen.getByText(t('evidenceNotRetrieved'))).toBeTruthy()
  })

  it('renders empty evidence note when evidence list is empty', () => {
    const itemNone = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      facts: { reportedEvidenceCount: 0 },
      evidence: [],
    })
    const { unmount } = render(<SourceEvidence item={itemNone} t={t} />)
    expect(screen.getByText(t('evidenceRetrievedNone'))).toBeTruthy()
    unmount()

    const itemReportedOnly = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      facts: { reportedEvidenceCount: 3 },
      evidence: [],
    })
    render(<SourceEvidence item={itemReportedOnly} t={t} />)
    expect(screen.getByText(t('evidenceReportedNoPreview', { count: 3 }))).toBeTruthy()
  })

  it('renders rich passage cards with truncated preview, page label, and omitted note', () => {
    const item = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      fulltextReads: [],
      evidenceTotal: 3,
      evidence: [
        passageOf({
          source: 'PDF',
          text: 'Passage one content',
          pageLabel: '42',
          previewTruncated: true,
          callIds: ['c1', 'c2'],
        }),
      ],
    })

    render(<SourceEvidence item={item} t={t} />)
    expect(screen.getByText(/Passage one content/)).toBeTruthy()
    expect(screen.getByText(new RegExp(t('truncatedPreview')))).toBeTruthy()
    expect(screen.getByText(t('pageLabel', { label: '42' }))).toBeTruthy()
    expect(screen.getByText(t('retrievedMultiple', { count: 2 }))).toBeTruthy()
    expect(screen.getByText(t('groundingRelationHint', { calls: 2 }))).toBeTruthy()
    expect(screen.getByText(t('evidenceOmittedNote', { count: 3 }))).toBeTruthy()
  })

  it('handles jump to sidebar PDF when direct file path is available', async () => {
    const openFile = vi.fn()
    const item = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/item/ATT1',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/paper.pdf',
      },
      evidence: [
        passageOf({
          attachmentRef: 'zotero://user/0/item/ATT1',
          text: 'Passage with direct file',
          callIds: ['c1'],
        }),
      ],
    })

    render(<SourceEvidence item={item} t={t} openFile={openFile} />)
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })
    expect(openFile).toHaveBeenCalledWith('/storage/paper.pdf')
  })

  it('handles jump to sidebar PDF by resolving attachment ref', async () => {
    const openFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        kind: 'file',
        path: '/resolved/path/paper.pdf',
      },
    })
    const item = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
        attachmentRef: 'zotero://user/0/item/ATT2',
      },
      evidence: [
        passageOf({
          sourceRef: 'zotero://user/0/item/ATT2',
          text: 'Passage requiring resolution',
          callIds: ['c1'],
        }),
      ],
    })

    render(
      <SourceEvidence
        item={item}
        t={t}
        openFile={openFile}
        resolveAttachment={resolveAttachment}
      />,
    )
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })
    expect(resolveAttachment).toHaveBeenCalledWith('zotero://user/0/item/ATT2')
    expect(openFile).toHaveBeenCalledWith('/resolved/path/paper.pdf')
  })

  it('shows a remote resolution rejection in the passage card', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: false,
      error: new RemoteError('zotero/no-attachment', 'attachment resolution refused', {
        code: 'ZOTERO_NO_ATTACHMENT',
      }),
    })
    const item = sourceOf({
      retrievalFacts: { truncated: false, sourceAvailability: {}, attachmentRef: 'ref-denied' },
      evidence: [passageOf({ attachmentRef: 'ref-denied' })],
    })
    render(
      <SourceEvidence item={item} t={t} openFile={vi.fn()} resolveAttachment={resolveAttachment} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(screen.getByRole('alert').textContent).toContain('attachment resolution refused')
  })

  it('shows a missing resolved path instead of opening an empty reader', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        kind: 'file',
        ref: 'ref-missing',
        title: 'paper.pdf',
        contentType: 'application/pdf',
      },
    })
    const item = sourceOf({
      retrievalFacts: { truncated: false, sourceAvailability: {}, attachmentRef: 'ref-missing' },
      evidence: [passageOf({ attachmentRef: 'ref-missing' })],
    })
    const openFile = vi.fn()
    render(
      <SourceEvidence
        item={item}
        t={t}
        openFile={openFile}
        resolveAttachment={resolveAttachment}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(screen.getByRole('alert').textContent).toContain(t('pdfFileNotFound'))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('shows URL resolution as unavailable without opening the external URL', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        kind: 'url',
        ref: 'ref-url',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        url: 'https://papers.example/paper.pdf',
      },
    })
    const openFile = vi.fn()
    const item = sourceOf({
      retrievalFacts: { truncated: false, sourceAvailability: {}, attachmentRef: 'ref-url' },
      evidence: [passageOf({ attachmentRef: 'ref-url' })],
    })
    render(
      <SourceEvidence
        item={item}
        t={t}
        openFile={openFile}
        resolveAttachment={resolveAttachment}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(screen.getByRole('alert').textContent).toContain(t('libraryPdfReaderUnavailable'))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('shows a reader open exception from the resolved local path', async () => {
    const openFile = vi.fn(() => {
      throw new Error('reader refused the file')
    })
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'file', path: '/resolved/paper.pdf' },
    })
    const item = sourceOf({
      retrievalFacts: { truncated: false, sourceAvailability: {}, attachmentRef: 'ref-open' },
      evidence: [passageOf({ attachmentRef: 'ref-open' })],
    })
    render(
      <SourceEvidence
        item={item}
        t={t}
        openFile={openFile}
        resolveAttachment={resolveAttachment}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(screen.getByRole('alert').textContent).toContain('reader refused the file')
  })

  it('uses the combined opening operation once and shows its rejection', async () => {
    const openPdf = vi.fn().mockRejectedValue(new Error('combined PDF open refused'))
    const item = sourceOf({
      retrievalFacts: { truncated: false, sourceAvailability: {}, attachmentRef: 'ref-combined' },
      evidence: [passageOf({ attachmentRef: 'ref-combined' })],
    })
    render(<SourceEvidence item={item} t={t} openPdf={openPdf} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(openPdf).toHaveBeenCalledExactlyOnceWith('ref-combined')
    expect(screen.getByRole('alert').textContent).toContain('combined PDF open refused')
  })

  it('delegates jump to openPdf when provided and succeeds', async () => {
    const openPdf = vi.fn().mockResolvedValue(undefined)
    const item = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
        attachmentRef: 'ref-combined-ok',
      },
      evidence: [passageOf({ attachmentRef: 'ref-combined-ok' })],
    })
    render(<SourceEvidence item={item} t={t} openPdf={openPdf} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(openPdf).toHaveBeenCalledWith('ref-combined-ok')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('alerts that reader is unavailable when no resolver or local path exists for the target ref', async () => {
    const openFile = vi.fn()
    const item = sourceOf({
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
        attachmentRef: 'ref-no-resolver',
      },
      evidence: [passageOf({ attachmentRef: 'ref-no-resolver' })],
    })
    render(<SourceEvidence item={item} t={t} openFile={openFile} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t('jumpToPageInSidebar') }))
    })
    expect(screen.getByRole('alert').textContent).toContain(t('libraryPdfReaderUnavailable'))
  })

  it('renders a fulltext-read card instead of an empty evidence note', () => {
    const item = sourceOf({
      fulltextReads: [
        {
          sourceKind: 'attachment' as const,
          sourceLabel: 'zotero://user/0/attachment/EFGH5678',
          textFormat: 'markdown' as const,
          totalChars: 40_000,
          inputTruncated: false,
          start: 0,
          end: 12_000,
          isTruncated: true,
          spillAvailable: false,
          callIds: ['fulltext-read'],
        },
      ],
    })
    render(<SourceEvidence item={item} t={t} />)
    const card = screen.getByText(/已读取/)
    expect(card.textContent).toBe(
      t('fulltextReadCard', {
        source: t('fulltextSourceAttachment'),
        format: t('fulltextFormatMarkdown'),
        start: 0,
        end: 12_000,
        total: 40_000,
      }),
    )
    // The sentence states what kind of source and format were read. The raw
    // `zotero://` ref and the `markdown` wire enum never reach the prose; the
    // ref stays available on the card's title.
    expect(card.textContent).not.toContain('zotero://')
    expect(card.textContent).not.toContain('markdown')
    expect((card.closest('[title]') as HTMLElement | null)?.title).toBe(
      'zotero://user/0/attachment/EFGH5678',
    )
    expect(screen.getByText(t('fulltextReadWindowed'))).toBeDefined()
    expect(screen.queryByText(t('evidenceNotRetrieved'))).toBeNull()
  })

  it('names the whole-document handle on a complete read', () => {
    const item = sourceOf({
      fulltextReads: [
        {
          sourceKind: 'attachment' as const,
          sourceLabel: 'zotero://user/0/attachment/EFGH5678',
          textFormat: 'markdown' as const,
          totalChars: 40_000,
          inputTruncated: false,
          start: 0,
          end: 40_000,
          isTruncated: false,
          spillAvailable: true,
          callIds: ['complete-read'],
        },
      ],
    })
    render(<SourceEvidence item={item} t={t} />)
    // A complete read reports the handle, not an upcoming window.
    expect(screen.getByText(t('fulltextReadSpillAvailable'))).toBeDefined()
    expect(screen.queryByText(t('fulltextReadWindowed'))).toBeNull()
  })

  it('names a URL-sourced window by its kind and keeps the origin off the sentence', () => {
    const item = sourceOf({
      fulltextReads: [
        {
          sourceKind: 'url' as const,
          sourceLabel: 'https://papers.example.org/…',
          textFormat: 'text' as const,
          totalChars: 900,
          inputTruncated: false,
          start: 0,
          end: 900,
          isTruncated: false,
          spillAvailable: false,
          callIds: ['url-read'],
        },
      ],
    })
    render(<SourceEvidence item={item} t={t} />)
    const card = screen.getByText(/已读取/)
    expect(card.textContent).toContain(t('fulltextSourceUrl'))
    expect(card.textContent).toContain(t('fulltextFormatText'))
    expect(card.textContent).not.toContain('https://')
    expect(card.textContent).not.toContain('text')
  })

  it('keys two windows of one document without a duplicate-key warning', () => {
    const first = {
      sourceKind: 'attachment' as const,
      sourceLabel: 'zotero://user/0/attachment/EFGH5678',
      textFormat: 'markdown' as const,
      totalChars: 40_000,
      inputTruncated: false,
      start: 0,
      end: 12_000,
      isTruncated: true,
      spillAvailable: false,
      callIds: ['w1'],
    }
    const second = { ...first, start: 12_000, end: 24_000, callIds: ['w2'] }
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    try {
      render(<SourceEvidence item={sourceOf({ fulltextReads: [first, second] })} t={t} />)
    } finally {
      spy.mockRestore()
    }
    expect(screen.getAllByText(/已读取/)).toHaveLength(2)
    expect(errors.filter((line) => line.includes('same key'))).toEqual([])
  })

  it.each([
    {
      name: 'a bound-cut window',
      read: {
        sourceKind: 'attachment' as const,
        sourceLabel: 'zotero://user/0/attachment/EFGH5678',
        textFormat: 'markdown' as const,
        totalChars: 40_000,
        inputTruncated: true,
        start: 0,
        end: 12_000,
        isTruncated: true,
        spillAvailable: false,
        callIds: ['r1'],
      },
      expectBounded: true,
      expectWindowed: true,
    },
    {
      name: 'the final window of a bounded document',
      read: {
        sourceKind: 'url' as const,
        sourceLabel: 'https://papers.example.org/…',
        textFormat: 'text' as const,
        totalChars: 40_000,
        inputTruncated: true,
        start: 36_000,
        end: 40_000,
        isTruncated: false,
        spillAvailable: false,
        callIds: ['r2'],
      },
      expectBounded: true,
      expectWindowed: false,
    },
    {
      name: 'a complete short document',
      read: {
        sourceKind: 'attachment' as const,
        sourceLabel: 'zotero://user/0/attachment/EFGH5678',
        textFormat: 'markdown' as const,
        totalChars: 900,
        inputTruncated: false,
        start: 0,
        end: 900,
        isTruncated: false,
        spillAvailable: false,
        callIds: ['r3'],
      },
      expectBounded: false,
      expectWindowed: false,
    },
  ])(
    'renders $name with exactly its own bounds notes',
    ({ read, expectBounded, expectWindowed }) => {
      const item = sourceOf({ fulltextReads: [read] })
      render(<SourceEvidence item={item} t={t} />)
      // The card names the window span the read proves, and the two truncation
      // notes are independent facts: the configured bound cut the document
      // before windowing (`inputTruncated`), and more windows follow
      // (`isTruncated`). Neither note may appear on a read it does not describe.
      expect(screen.getByText(/已读取/)).toBeDefined()
      expect(
        screen.getByText(
          t('fulltextReadCard', {
            source: t(read.sourceKind === 'url' ? 'fulltextSourceUrl' : 'fulltextSourceAttachment'),
            format: t(
              read.textFormat === 'markdown' ? 'fulltextFormatMarkdown' : 'fulltextFormatText',
            ),
            start: read.start,
            end: read.end,
            total: read.totalChars,
          }),
        ),
      ).toBeDefined()
      expect(screen.queryByText(t('fulltextReadWindowed'))).toBe(
        expectWindowed ? screen.getByText(t('fulltextReadWindowed')) : null,
      )
      expect(screen.queryByText(t('fulltextReadBounded'))).toBe(
        expectBounded ? screen.getByText(t('fulltextReadBounded')) : null,
      )
    },
  )

  it('renders the fulltext windows in trail order and reports the omitted tail', () => {
    const first = {
      sourceKind: 'attachment' as const,
      sourceLabel: 'zotero://user/0/attachment/EFGH5678',
      textFormat: 'markdown' as const,
      totalChars: 40_000,
      inputTruncated: false,
      start: 0,
      end: 12_000,
      isTruncated: true,
      spillAvailable: false,
      callIds: ['w1'],
    }
    const second = { ...first, start: 12_000, end: 24_000, isTruncated: true, callIds: ['w2'] }
    const third = { ...first, start: 24_000, end: 36_000, isTruncated: true, callIds: ['w3'] }
    const item = sourceOf({
      fulltextReads: [first, second, third],
      fulltextReadsTotal: 4,
    })
    render(<SourceEvidence item={item} t={t} />)
    const cards = screen.getAllByText(/已读取/).map((node) => node.textContent ?? '')
    // Window order follows the trail, so the continuation chain reads in
    // source order: 0–12000, then 12000–24000, then 24000–36000.
    expect(cards.length).toBe(3)
    expect(cards[0]).toContain('0–12000')
    expect(cards[1]).toContain('12000–24000')
    expect(cards[2]).toContain('24000–36000')
    // The windowed list is a projection: the trail holds one window more
    // than the card list shows, and the omission is named.
    expect(screen.getByText(t('fulltextReadsOmittedNote', { count: 4 }))).toBeDefined()
  })

  it('renders page controls when a pager is provided', () => {
    const pager = {
      pages: [],
      shown: 0,
      loading: false,
      error: undefined,
      hasMore: true,
      loadMore: vi.fn(),
      retry: vi.fn(),
    }
    const item = sourceOf({
      retrievalFacts: { truncated: false, sourceAvailability: {} },
      evidence: [passageOf()],
    })
    render(<SourceEvidence item={item} t={t} pager={pager} />)
    expect(screen.getByRole('button', { name: t('sourcePageMore') })).toBeDefined()
  })
})
