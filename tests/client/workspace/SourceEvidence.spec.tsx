// @vitest-environment jsdom
/**
 * The SourceEvidence component: passages feed, retrieval summary head,
 * truncated budget limits, jump-to-sidebar PDF actions (direct and resolved),
 * grounding context hints, and empty/omitted state notes.
 * @module tests/client/workspace/SourceEvidence
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SourceEvidence,
  retrievalSummaryLineOf,
} from '../../../src/client/components/workspace/SourceEvidence.tsx'
import { passageOf, sourceOf } from '../helpers/source-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

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
})
