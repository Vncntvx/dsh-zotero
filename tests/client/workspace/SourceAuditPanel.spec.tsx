// @vitest-environment jsdom
/**
 * The SourceAuditPanel component: citation generation (BibTeX / GB/T 7714),
 * one-click copy actions, coverage progress calculation, retrieval timeline,
 * source availability breakdown, and the technical ref identifier.
 * @module tests/client/workspace/SourceAuditPanel
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceAuditPanel } from '../../../src/client/components/workspace/SourceAuditPanel.tsx'
import { artifactOf, searchOf, sourceOf } from '../helpers/source-fixtures.ts'

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

describe('SourceAuditPanel component', () => {
  it('synthesizes BibTeX from item fields and copies on button click', async () => {
    const item = sourceOf({
      key: 'zotero://user/0/item/ITEMKEY1',
      ref: 'zotero://user/0/item/ITEMKEY1',
      title: 'Attention Is All You Need',
      creators: 'Vaswani et al.',
      year: 2017,
      venue: 'NeurIPS',
    })

    render(<SourceAuditPanel item={item} t={t} />)

    expect(screen.getByText(/@article\{zotero_ITEMKEY1,/)).toBeTruthy()
    expect(screen.getByText(/title = \{Attention Is All You Need\},/)).toBeTruthy()
    expect(screen.getByText(/author = \{Vaswani et al\.\},/)).toBeTruthy()
    expect(screen.getByText(/year = \{2017\},/)).toBeTruthy()
    expect(screen.getByText(/journal = \{NeurIPS\},/)).toBeTruthy()

    const copyBtn = screen.getAllByRole('button', { name: t('copy') })[0]!
    await act(async () => {
      fireEvent.click(copyBtn)
    })
    expect(writeClipboard).toHaveBeenCalledWith(
      expect.stringContaining('@article{zotero_ITEMKEY1,'),
    )
  })

  it('uses existing export artifact text for BibTeX when available', () => {
    const customBibtex = '@article{custom2023,\n  title = {Custom Title}\n}'
    const item = sourceOf({
      key: 'zotero://user/0/item/ITEMKEY2',
      ref: 'zotero://user/0/item/ITEMKEY2',
      exports: [
        artifactOf({
          format: 'bibtex',
          text: customBibtex,
        }),
      ],
    })

    const { container } = render(<SourceAuditPanel item={item} t={t} />)
    expect(container.querySelector('code')?.textContent).toBe(customBibtex)
  })

  it('switches to GB/T 7714 citation format and handles fallbacks', async () => {
    const item = sourceOf({
      key: 'zotero://user/0/item/ITEMKEY3',
      ref: 'zotero://user/0/item/ITEMKEY3',
      title: '深度学习研究',
      creators: '张三和李四',
      year: 2021,
      venue: '计算机学报',
    })

    render(<SourceAuditPanel item={item} t={t} />)

    const gbtTab = screen.getByRole('tab', { name: t('gbt7714Format') })
    await act(async () => {
      fireEvent.click(gbtTab)
    })

    expect(screen.getByText(/张三和李四\. 深度学习研究\[J\/OL\]\. 计算机学报, 2021\./)).toBeTruthy()

    // Test fallback with missing fields
    const minimalItem = sourceOf({
      key: 'zotero://user/0/item/ITEMKEY4',
      ref: 'zotero://user/0/item/ITEMKEY4',
      title: undefined,
      creators: undefined,
      year: undefined,
      venue: undefined,
    })

    cleanup()
    render(<SourceAuditPanel item={minimalItem} t={t} />)
    const gbtTab2 = screen.getByRole('tab', { name: t('gbt7714Format') })
    await act(async () => {
      fireEvent.click(gbtTab2)
    })
    expect(screen.getByText(/佚名\. 无题\[J\/OL\]\./)).toBeTruthy()
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
