// @vitest-environment jsdom
/**
 * The SourceOverview component: actions row, PDF reading (file & web),
 * locate actions, the blocked mismatch read, search occurrences, and disclosure.
 * @module tests/client/SourceOverview
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SourceOverview,
  filterLineOf,
  modeLabelOf,
  scopeLabelOf,
} from '../../src/client/components/workspace/SourceOverview.tsx'
import { sourceOf } from './helpers/source-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from './helpers/mock-translate.ts'
import { writeClipboardSpy } from './helpers/primitives-stub.ts'

const t = mockT
const writeClipboard = await writeClipboardSpy()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourceOverview helpers', () => {
  it('covers scopeLabelOf publications branch', () => {
    expect(scopeLabelOf({ kind: 'publications' }, t)).toBe(mockT('overviewScopePublications'))
  })

  it('covers modeLabelOf everything and metadata', () => {
    expect(modeLabelOf('everything', t)).toBe(mockT('modeEverything'))
    expect(modeLabelOf('metadata', t)).toBe(mockT('modeMetadata'))
  })

  it('formats filter lines with itemTypes and tags', () => {
    expect(filterLineOf(['journalArticle'], ['ai', 'nlp'], t)).toBe('journalArticle · ai · nlp')
    expect(filterLineOf([], [], t)).toBe('')
  })
})

describe('SourceOverview component', () => {
  it('renders actions for a source with a direct file PDF', () => {
    const openFile = vi.fn()
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      title: 'Attention Is All You Need',
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/item/ATT12345',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/paper.pdf',
      },
    })

    render(<SourceOverview item={item} openFile={openFile} t={t} />)

    const readBtn = screen.getByRole('button', { name: mockT('readPdf') })
    fireEvent.click(readBtn)
    expect(openFile).toHaveBeenCalledWith('/storage/paper.pdf')

    expect(screen.getByRole('button', { name: mockT('copyTitle') })).toBeDefined()
    expect(screen.getByRole('button', { name: mockT('copyZoteroLink') })).toBeDefined()
  })

  it('renders actions for a source with a web url PDF', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      title: 'Attention Is All You Need',
      attachment: {
        kind: 'url',
        ref: 'zotero://user/0/item/ATT12345',
        title: 'web.pdf',
        contentType: 'application/pdf',
        location: 'https://arxiv.org/pdf/1706.03762.pdf',
      },
    })

    render(<SourceOverview item={item} t={t} />)

    const readBtn = screen.getByRole('button', { name: mockT('readPdf') })
    fireEvent.click(readBtn)
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://arxiv.org/pdf/1706.03762.pdf',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('blocks the PDF read but keeps copy actions active when mismatched', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      evidenceMatch: 'mismatch',
      attachment: {
        kind: 'file',
        ref: 'zotero://user/0/item/ATT12345',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        location: '/storage/paper.pdf',
      },
    })

    render(<SourceOverview item={item} t={t} />)

    const readBtn = screen.getByRole('button', { name: /阅读 PDF/ })
    expect(readBtn.getAttribute('aria-disabled')).toBe('true')
    const copyBtn = screen.getByRole('button', { name: /复制链接/ })
    expect(copyBtn.getAttribute('aria-disabled')).toBeNull()
    // The deep link is data: copying it does not touch the instance.
    fireEvent.click(copyBtn)
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining('zotero://select/'))
  })

  it('triggers setDraft for ask and export actions', () => {
    const setDraft = vi.fn()
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
    })

    render(<SourceOverview item={item} setDraft={setDraft} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: mockT('askAboutItem') }))
    expect(setDraft).toHaveBeenCalledWith(mockT('askTemplate', { ref: item.ref }))

    fireEvent.click(screen.getByRole('button', { name: mockT('exportCitation') }))
    expect(setDraft).toHaveBeenCalledWith(mockT('citeTemplate', { ref: item.ref }))
  })

  it('toggles search occurrence details disclosure', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [
        {
          callId: 'call-1',
          query: 'transformer attention',
          scope: { kind: 'publications' },
          mode: 'everything',
          itemTypes: ['journalArticle'],
          tags: ['ml'],
          excludeTags: [],
          includeTrashed: false,
        },
      ],
    })

    render(<SourceOverview item={item} t={t} />)

    expect(screen.queryByText(new RegExp(mockT('scopeLine')))).toBeNull()

    // Open disclosure
    fireEvent.click(screen.getByRole('button', { name: mockT('searchDetailOpen') }))
    expect(screen.getByText(new RegExp(mockT('scopeLine')))).toBeDefined()
    expect(screen.getByText(new RegExp(mockT('overviewScopePublications')))).toBeDefined()

    // Close disclosure
    fireEvent.click(screen.getByRole('button', { name: mockT('searchDetailClose') }))
    expect(screen.queryByText(new RegExp(mockT('scopeLine')))).toBeNull()
  })

  it('copies ref to clipboard when copy button clicked', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
    })

    render(<SourceOverview item={item} t={t} />)

    fireEvent.click(screen.getByLabelText(mockT('copyRef')))
    expect(writeClipboard).toHaveBeenCalledWith(item.ref)
  })
})
