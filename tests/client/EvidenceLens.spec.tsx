// @vitest-environment jsdom
/**
 * The evidence lens: grouping by literature, passage tags and labels,
 * coverage and availability honesty, dedup provenance, the open-in-Zotero
 * verdict guard, and the copy fallback.
 * @module tests/client/EvidenceLens
 */

import { cleanup, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EvidenceCard,
  availabilityLineOf,
  coverageLineOf,
  sourceLabelKeyOf,
} from '../../src/client/components/EvidenceCard.tsx'
import { EvidenceOverview } from '../../src/client/components/workspace/EvidenceOverview.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import type { SourceItem } from '../../src/client/sources/model.ts'
import { sourceOf, workspaceOf } from './helpers/source-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    IconChevronDownOutline14: (props: Record<string, unknown>) =>
      createElement('span', { 'data-icon': 'chevron-down', ...props }),
    writeClipboard: vi.fn(async () => true),
    Tooltip: ({ children }: { children: React.ReactElement }) => children,
  }
})

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

const EVIDENCE_ITEM: SourceItem = sourceOf({
  key: 'zotero://user/0/item/ABCDEFGH',
  ref: 'zotero://user/0/item/ABCDEFGH',
  title: 'FlashAttention-2',
  creators: 'Dao',
  year: 2023,
  provenance: 'verified',
  facts: {
    inspected: false,
    evidenceCount: 2,
    reportedEvidenceCount: 2,
    attachmentResolved: false,
    exportCount: 0,
  },
  evidence: [
    {
      source: 'annotation',
      sourceRef: 'zotero://user/0/annotation/ANN00001',
      text: 'highlighted claim',
      previewTruncated: false,
      pageLabel: '7',
      callIds: ['r1'],
    },
    {
      source: 'fulltext',
      sourceRef: 'zotero://user/0/item/ABCDEFGH',
      text: 'the paper body',
      previewTruncated: true,
      callIds: ['r1', 'r2'],
    },
  ],
  retrievalFacts: {
    attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
    attachmentContentType: 'application/pdf',
    coverage: { indexedPages: 5, totalPages: 10, complete: false },
    truncated: true,
    sourceAvailability: {
      annotation: { requested: true, returnedPassages: 1, unavailable: false },
      note: { requested: true, returnedPassages: 0, unavailable: true },
      abstract: { requested: true, returnedPassages: 0, unavailable: false },
      fulltext: { requested: true, returnedPassages: 1, unavailable: false },
    },
  },
})

afterEach(cleanup)

describe('sourceLabelKeyOf', () => {
  it('maps every known source and falls back to fulltext', () => {
    expect(sourceLabelKeyOf('annotation')).toBe('sourceAnnotation')
    expect(sourceLabelKeyOf('note')).toBe('sourceNote')
    expect(sourceLabelKeyOf('abstract')).toBe('sourceAbstract')
    expect(sourceLabelKeyOf('fulltext')).toBe('sourceFulltext')
    expect(sourceLabelKeyOf('other')).toBe('sourceFulltext')
  })
})

describe('coverageLineOf', () => {
  it('reports the pages axis with the completeness suffix', () => {
    expect(coverageLineOf({ indexedPages: 5, totalPages: 10, complete: false }, t)).toBe(
      `${zh.coverageLabel} 5/10 页 · 未完整`,
    )
    expect(coverageLineOf({ indexedPages: 5, totalPages: 5, complete: true }, t)).toBe(
      `${zh.coverageLabel} 5/5 页 · 已完整`,
    )
  })

  it('reports the chars axis and stays silent without axes', () => {
    expect(coverageLineOf({ indexedChars: 100, totalChars: 200, complete: true }, t)).toBe(
      `${zh.coverageLabel} 100/200 字符 · 已完整`,
    )
    expect(coverageLineOf({ complete: false }, t)).toBe('')
  })
})

describe('availabilityLineOf', () => {
  it('distinguishes unavailable, returned, and no-match sources', () => {
    expect(availabilityLineOf({ requested: true, returnedPassages: 0, unavailable: true }, t)).toBe(
      zh.availUnavailable,
    )
    expect(
      availabilityLineOf({ requested: true, returnedPassages: 3, unavailable: false }, t),
    ).toBe(zh.availReturned.replace('{count}', '3'))
    expect(
      availabilityLineOf({ requested: true, returnedPassages: 0, unavailable: false }, t),
    ).toBe(zh.availNoMatch)
  })
})

describe('EvidenceCard', () => {
  it('renders the passages with source tags, page labels, and dedup provenance', () => {
    const { container } = render(<EvidenceCard item={EVIDENCE_ITEM} t={t} />)
    expect(screen.getByText(zh.sourceAnnotation)).toBeDefined()
    expect(screen.getByText(zh.pageLabel.replace('{label}', '7'))).toBeDefined()
    expect(screen.getByText(/the paper body \(截断\)/)).toBeDefined()
    expect(screen.getByText(zh.retrievedMultiple.replace('{count}', '2'))).toBeDefined()
    expect(container.querySelectorAll('[data-source]')).toHaveLength(2)
  })

  it('renders coverage, the budget note, and the availability lines', () => {
    render(<EvidenceCard item={EVIDENCE_ITEM} t={t} />)
    expect(screen.getByText(`${zh.coverageLabel} 5/10 页 · 未完整`)).toBeDefined()
    expect(screen.getByText(zh.budgetLimitedNote)).toBeDefined()
    expect(screen.getByText(/该来源不可用/)).toBeDefined()
    expect(screen.getAllByText(/返回 1 条匹配/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/没有返回匹配/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows the retrieved-but-empty summary and the per-source availability lines', () => {
    const item = sourceOf({
      title: 'Notes Only',
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {
          note: { requested: true, returnedPassages: 0, unavailable: false },
          fulltext: { requested: true, returnedPassages: 0, unavailable: false },
        },
      },
    })
    render(<EvidenceCard item={item} t={t} />)
    expect(screen.getByText(zh.evidenceRetrievedNone)).toBeDefined()
    expect(screen.getAllByText(/没有返回匹配/).length).toBeGreaterThanOrEqual(2)
  })

  it('reports reported-but-not-previewed evidence without claiming no match', () => {
    const item = sourceOf({
      title: 'Budget Dropped',
      facts: {
        inspected: false,
        evidenceCount: 0,
        reportedEvidenceCount: 25,
        attachmentResolved: false,
        exportCount: 0,
      },
      retrievalFacts: {
        truncated: true,
        sourceAvailability: {
          fulltext: { requested: true, returnedPassages: 25, unavailable: false },
        },
      },
    })
    render(<EvidenceCard item={item} t={t} />)
    expect(screen.queryByText(zh.evidenceRetrievedNone)).toBeNull()
    expect(screen.getByText(zh.evidenceReportedNoPreview.replace('{count}', '25'))).toBeDefined()
    expect(screen.getByText(zh.budgetLimitedNote)).toBeDefined()
  })

  it('renders an evidence card with no retrieval facts without crashing', () => {
    const item = sourceOf({
      title: 'No Retrieval',
      evidence: [],
    })
    render(<EvidenceCard item={item} t={t} />)
    expect(screen.getByText('No Retrieval')).toBeDefined()
  })

  it('links open actions for a verified item with an attachment ref', () => {
    const { container } = render(<EvidenceCard item={EVIDENCE_ITEM} t={t} />)
    const links = Array.from(container.querySelectorAll('a')).map((anchor) =>
      anchor.getAttribute('href'),
    )
    expect(links).toContain('zotero://select/library/items/ABCDEFGH')
    expect(links).toContain('zotero://open-pdf/library/items/WXYZ6789')
    expect(links).toContain('zotero://open-pdf/library/items/WXYZ6789?annotation=ANN00001')
  })

  it('targets the annotation jump at the annotation own PDF attachment', () => {
    const item = sourceOf({
      ...EVIDENCE_ITEM,
      evidence: EVIDENCE_ITEM.evidence.map((passage) =>
        passage.source === 'annotation'
          ? { ...passage, attachmentRef: 'zotero://user/0/attachment/XYZ99990' }
          : passage,
      ),
    })
    const { container } = render(<EvidenceCard item={item} t={t} />)
    const links = Array.from(container.querySelectorAll('a')).map((anchor) =>
      anchor.getAttribute('href'),
    )
    expect(links).toContain('zotero://open-pdf/library/items/WXYZ6789')
    expect(links).toContain('zotero://open-pdf/library/items/XYZ99990?annotation=ANN00001')
  })

  it('opens a resolved web PDF at its web location and offers no annotation jump', () => {
    const item = sourceOf({
      ...EVIDENCE_ITEM,
      retrievalFacts: undefined,
      attachment: {
        ref: 'zotero://user/0/attachment/WEBLINK1',
        kind: 'url',
        contentType: 'application/pdf',
        title: 'paper.pdf',
        location: 'https://e.org/paper.pdf',
      },
    })
    const { container } = render(<EvidenceCard item={item} t={t} />)
    const links = Array.from(container.querySelectorAll('a')).map((anchor) =>
      anchor.getAttribute('href'),
    )
    expect(links).toContain('https://e.org/paper.pdf')
    expect(links).not.toContain('zotero://open-pdf/library/items/WEBLINK1')
    expect(links.filter((url) => url !== null && url.includes('annotation'))).toHaveLength(0)
  })

  it('blocks every open link for a mismatching item and keeps the copy fallback', () => {
    const mismatch = sourceOf({
      ...EVIDENCE_ITEM,
      provenance: 'mismatch',
    })
    const { container } = render(<EvidenceCard item={mismatch} t={t} />)
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getAllByText(new RegExp(zh.provenanceMismatch)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText(zh.copyRef)).toBeDefined()
  })

  it('caves unverified items with an instance caveat', () => {
    const unverified = sourceOf({ ...EVIDENCE_ITEM, provenance: 'unknown' })
    const { container } = render(<EvidenceCard item={unverified} t={t} />)
    expect(container.querySelector('a')).not.toBeNull()
    expect(screen.getAllByText(new RegExp(zh.instanceUnverified)).length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to the ref for an item the session never titled', () => {
    const untitled = sourceOf({
      ...EVIDENCE_ITEM,
      title: undefined,
      creators: undefined,
      year: undefined,
    })
    render(<EvidenceCard item={untitled} t={t} />)
    expect(screen.getByText('zotero://user/0/item/ABCDEFGH')).toBeDefined()
  })
})

describe('EvidenceOverview', () => {
  it('shows the honest empty note without evidence and groups by literature', () => {
    const empty = render(
      <EvidenceOverview workspace={workspaceOf([sourceOf({})])} onBack={vi.fn()} t={t} />,
    )
    expect(screen.getByText(zh.evidenceEmptyNote)).toBeDefined()
    empty.unmount()

    const other = sourceOf({
      key: 'zotero://user/0/item/other',
      ref: 'zotero://user/0/item/OTHER',
      title: 'Another Paper',
      facts: {
        inspected: false,
        evidenceCount: 1,
        reportedEvidenceCount: 1,
        attachmentResolved: false,
        exportCount: 0,
      },
      evidence: [
        {
          source: 'note',
          sourceRef: 'zotero://user/0/item/NOTE1',
          text: 'a note',
          previewTruncated: false,
          callIds: ['r3'],
        },
      ],
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
    })
    const view = render(
      <EvidenceOverview workspace={workspaceOf([EVIDENCE_ITEM, other])} onBack={vi.fn()} t={t} />,
    )
    expect(screen.getByText('FlashAttention-2')).toBeDefined()
    expect(screen.getByText('Another Paper')).toBeDefined()
    // No scope note: the cards carry their own facts, so the page needs no
    // defensive disclaimer about what the passages were used for.
    expect(screen.queryByText(/不能确定这些内容被用于最终回答/)).toBeNull()
    view.unmount()
  })
})
