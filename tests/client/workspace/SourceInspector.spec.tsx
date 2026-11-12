// @vitest-environment jsdom
/**
 * The SourceInspector component: unified grounding feed for selected sources,
 * empty selection note, PDF reading capability, database mismatch warnings,
 * prompt and export drafts, collection & tag metadata chips, and child feeds.
 * @module tests/client/workspace/SourceInspector
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceInspector } from '../../../src/client/components/workspace/SourceInspector.tsx'
import { askDraftOf, exportDraftOf } from '../../../src/client/actions/source-actions.ts'
import {
  artifactOf,
  passageOf,
  searchOf,
  sourceOf,
  workspaceOf,
} from '../helpers/source-fixtures.ts'

import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourceInspector component', () => {
  it('renders empty note when no item is selected', () => {
    const workspace = workspaceOf([])
    render(
      <SourceInspector
        workspace={workspace}
        selectedKey={undefined}
        selectionHidden={false}
        setMobilePane={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText(t('inspectorEmptyNote'))).toBeTruthy()
  })

  it('renders selected source with back button, draft actions, collections, and tags', async () => {
    const setMobilePane = vi.fn()
    const setDraft = vi.fn()

    const item = sourceOf({
      key: 'zotero://user/0/item/SEL1',
      ref: 'zotero://user/0/item/SEL1',
      title: 'Attention Is All You Need',
      creators: 'Vaswani',
      year: 2017,
      venue: 'NeurIPS',
      searches: [
        searchOf({
          callId: 's1',
          scope: { kind: 'collection', name: 'Deep Learning' },
          tags: ['transformer', 'nlp'],
        }),
      ],
      retrievalFacts: {
        truncated: false,
        sourceAvailability: {},
      },
      evidence: [
        passageOf({
          source: 'PDF',
          text: 'Passage one',
        }),
      ],
      exports: [
        artifactOf({
          format: 'bibtex',
          text: '@article{sel1,\n  title = {A}\n}',
        }),
      ],
    })

    const workspace = workspaceOf([item])

    render(
      <SourceInspector
        workspace={workspace}
        selectedKey="zotero://user/0/item/SEL1"
        selectionHidden={false}
        setMobilePane={setMobilePane}
        setDraft={setDraft}
        t={t}
      />,
    )

    expect(screen.getByText('Attention Is All You Need')).toBeTruthy()
    expect(screen.getByText(/Vaswani · 2017 · NeurIPS/)).toBeTruthy()

    // Back to list button
    const backBtn = screen.getByRole('button', { name: t('backToList') })
    await act(async () => {
      fireEvent.click(backBtn)
    })
    expect(setMobilePane).toHaveBeenCalledWith('list')

    // Draft buttons
    const askBtn = screen.getByRole('button', { name: t('askAboutItem') })
    await act(async () => {
      fireEvent.click(askBtn)
    })
    expect(setDraft).toHaveBeenCalledWith(askDraftOf(item.ref, t))

    const exportBtn = screen.getByRole('button', { name: t('exportCitation') })
    await act(async () => {
      fireEvent.click(exportBtn)
    })
    expect(setDraft).toHaveBeenCalledWith(exportDraftOf(item.ref, t))

    // Collection chip and tag chips
    expect(screen.getByText('Deep Learning')).toBeTruthy()
    expect(screen.getByText('#transformer')).toBeTruthy()
    expect(screen.getByText('#nlp')).toBeTruthy()

    // Passages and exports counts
    expect(screen.getByText(/Passage one/)).toBeTruthy()
  })

  it('renders mismatch and hidden selection warnings', () => {
    const item = sourceOf({
      key: 'zotero://user/0/item/MISMATCH1',
      ref: 'zotero://user/0/item/MISMATCH1',
      title: 'Mismatch Item',
      evidenceMatch: 'mismatch',
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/item/ATT1',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/sample.pdf',
      },
    })
    const workspace = workspaceOf([item])

    render(
      <SourceInspector
        workspace={workspace}
        selectedKey="zotero://user/0/item/MISMATCH1"
        selectionHidden={true}
        setMobilePane={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByText(t('databaseMismatch'))).toBeTruthy()
    expect(screen.getByText(t('selectionHiddenNote'))).toBeTruthy()
  })

  it('renders fallback ref when title is missing, filters empty tags, and handles scope without collection', () => {
    const item = sourceOf({
      key: 'zotero://user/0/item/NO_TITLE',
      ref: 'zotero://user/0/item/NO_TITLE',
      title: undefined,
      creators: undefined,
      year: undefined,
      venue: undefined,
      searches: [
        searchOf({
          callId: 's2',
          scope: { kind: 'library', library: { type: 'user', id: 0 } },
          tags: ['', 'valid-tag'],
        }),
      ],
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/item/ATT_VERIFIED',
        title: 'verified.pdf',
        contentType: 'application/pdf',
        location: '/storage/verified.pdf',
      },
      evidenceMatch: 'verified',
    })
    const workspace = workspaceOf([item])

    render(
      <SourceInspector
        workspace={workspace}
        selectedKey="zotero://user/0/item/NO_TITLE"
        selectionHidden={false}
        setMobilePane={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByText('zotero://user/0/item/NO_TITLE')).toBeTruthy()
    expect(screen.getByText('#valid-tag')).toBeTruthy()
  })
})
