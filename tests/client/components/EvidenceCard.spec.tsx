// @vitest-environment jsdom
/**
 * Tests for EvidenceCard: open in Zotero deep-linking, protocol invocation,
 * mismatch read blocking, and passage rendering.
 * @module tests/client/components/EvidenceCard
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvidenceCard } from '../../../src/client/components/EvidenceCard.tsx'
import type { SourceItem } from '../../../src/sources/model.js'
import { passageOf, sourceOf } from '../helpers/source-fixtures.ts'
import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EvidenceCard component', () => {
  it('invokes openProtocol with annotation url when openInZotero is clicked', async () => {
    const openProtocol = vi.fn(async () => true)
    const item: SourceItem = sourceOf({
      key: 'zotero://user/0/item/ABCDEF12',
      ref: 'zotero://user/0/item/ABCDEF12',
      title: 'Attention Paper',
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/paper.pdf',
      },
      evidenceMatch: 'verified',
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      evidence: [
        passageOf({
          source: 'annotation',
          sourceRef: 'zotero://user/0/annotation/ANN00001',
          attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
          text: 'Annotated sentence in PDF',
          callIds: ['c1'],
        }),
      ],
    })

    render(<EvidenceCard item={item} t={t} openProtocol={openProtocol} />)

    const passageLi = screen.getByRole('listitem')
    const openInZoteroBtn = within(passageLi).getByRole('button', { name: t('openInZotero') })
    expect(openInZoteroBtn).toBeDefined()

    await act(async () => {
      fireEvent.click(openInZoteroBtn)
    })

    expect(openProtocol).toHaveBeenCalledTimes(1)
    expect(openProtocol).toHaveBeenCalledWith(
      'zotero://open-pdf/library/items/WXYZ6789?annotation=ANN00001',
    )
  })

  it('handles openInZotero click when openProtocol is not provided', async () => {
    const item: SourceItem = sourceOf({
      key: 'zotero://user/0/item/ABCDEF12',
      ref: 'zotero://user/0/item/ABCDEF12',
      title: 'Attention Paper',
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/paper.pdf',
      },
      evidenceMatch: 'verified',
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      evidence: [
        passageOf({
          source: 'annotation',
          sourceRef: 'zotero://user/0/annotation/ANN00001',
          attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
          text: 'Annotated sentence in PDF',
          callIds: ['c1'],
        }),
      ],
    })

    render(<EvidenceCard item={item} t={t} />)

    const passageLi = screen.getByRole('listitem')
    const openInZoteroBtn = within(passageLi).getByRole('button', { name: t('openInZotero') })
    await act(async () => {
      fireEvent.click(openInZoteroBtn)
    })
    expect(openInZoteroBtn).toBeDefined()
  })

  it('renders blocked read action when evidenceMatch is mismatch', () => {
    const item: SourceItem = sourceOf({
      key: 'zotero://user/0/item/ABCDEF12',
      ref: 'zotero://user/0/item/ABCDEF12',
      title: 'Attention Paper',
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/attachment/WXYZ6789',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/paper.pdf',
      },
      evidenceMatch: 'mismatch',
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      evidence: [],
    })

    render(<EvidenceCard item={item} t={t} />)
    expect(screen.getByText(t('readPdf'))).toBeDefined()
  })
})
