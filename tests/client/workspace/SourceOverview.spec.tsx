// @vitest-environment jsdom
/**
 * The SourceOverview component: actions row, PDF reading (file & web),
 * locate actions, the blocked mismatch read, the search audit record it shows
 * in the first screen, and the ref-only technical disclosure.
 * @module tests/client/workspace/SourceOverview
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SourceOverview,
  filterLineOf,
  modeLabelOf,
  scopeLabelOf,
} from '../../../src/client/components/workspace/SourceOverview.tsx'
import { searchOf, sourceOf } from '../helpers/source-fixtures.ts'

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

  it('copies ref to clipboard when copy button clicked', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
    })

    render(<SourceOverview item={item} t={t} />)

    fireEvent.click(screen.getByLabelText(mockT('copyRef')))
    expect(writeClipboard).toHaveBeenCalledWith(item.ref)
  })
})

describe('SourceOverview search audit record', () => {
  it('shows query, scope, mode, filters, and hits without expanding anything', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [
        searchOf({
          query: 'transformer attention',
          scope: { kind: 'publications' },
          mode: 'everything',
          itemTypes: ['journalArticle'],
          tags: ['ml'],
          returned: 3,
          total: 42,
        }),
      ],
    })

    render(<SourceOverview item={item} t={t} />)

    // First screen: the full audit line, the active filters, and the counts.
    expect(
      screen.getByText(
        mockT('searchEpisodeQueryLine', {
          query: 'transformer attention',
          scope: mockT('overviewScopePublications'),
          mode: mockT('modeEverything'),
        }),
      ),
    ).toBeDefined()
    expect(
      screen.getByText(mockT('searchEpisodeFilterLine', { filters: 'journalArticle · ml' })),
    ).toBeDefined()
    expect(
      screen.getByText(mockT('searchEpisodeHitsLine', { returned: 3, total: 42 })),
    ).toBeDefined()
    // The disclosure was never opened, so the developer ref stays hidden.
    expect(screen.queryByText(`${mockT('refLine')} ${item.ref}`)).toBeNull()
  })

  it('shows the browse line for an episode without a query', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [searchOf({ query: undefined })],
    })

    render(<SourceOverview item={item} t={t} />)

    expect(
      screen.getByText(
        mockT('searchEpisodeNoQueryLine', {
          scope: mockT('overviewScopeLibrary'),
          mode: mockT('modeEverything'),
        }),
      ),
    ).toBeDefined()
  })

  it('renders the returned-only line when Zotero reported no total', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [searchOf({ returned: 2, total: undefined, noteMatches: undefined })],
    })

    render(<SourceOverview item={item} t={t} />)

    expect(screen.getByText(mockT('searchEpisodeHitsNoTotal', { returned: 2 }))).toBeDefined()
    // The of-total variant stays absent: an unreported total is not rendered as one.
    expect(
      screen.queryByText(
        new RegExp(
          mockT('searchEpisodeHitsLine')
            .replace('{returned}', String.raw`\d+`)
            .replace('{total}', String.raw`\d+`),
        ),
      ),
    ).toBeNull()
  })

  it('appends the note-match count, including a reported zero', () => {
    const hitItem = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [searchOf({ returned: 2, total: 5, noteMatches: 3 })],
    })
    const hits = mockT('searchEpisodeHitsLine', { returned: 2, total: 5 })
    render(<SourceOverview item={hitItem} t={t} />)
    expect(
      screen.getByText(`${hits} · ${mockT('searchEpisodeNoteHits', { noteMatches: 3 })}`),
    ).toBeDefined()
    cleanup()

    // Zero means the note scan ran and matched nothing: the field must not be
    // mistaken for an absent scan.
    const zeroItem = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [searchOf({ returned: 1, total: 1, noteMatches: 0 })],
    })
    render(<SourceOverview item={zeroItem} t={t} />)
    expect(
      screen.getByText(
        `${mockT('searchEpisodeHitsLine', { returned: 1, total: 1 })} · ${mockT(
          'searchEpisodeNoteHits',
          { noteMatches: 0 },
        )}`,
      ),
    ).toBeDefined()
  })

  it('keeps the technical details disclosure to the ref alone', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/ITEMKEY1',
      searches: [searchOf({ itemTypes: ['journalArticle'], tags: ['ml'] })],
    })

    render(<SourceOverview item={item} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: mockT('searchDetailOpen') }))
    // The disclosure section is the button's next sibling; it carries the raw
    // ref and nothing else: scope, filters, and mode stay in the first screen.
    const disclosure = screen.getByText(mockT('searchDetailClose')).nextElementSibling
    expect(disclosure?.textContent).toBe(`${mockT('refLine')} ${item.ref}`)

    fireEvent.click(screen.getByText(mockT('searchDetailClose')))
    expect(screen.queryByText(`${mockT('refLine')} ${item.ref}`)).toBeNull()
  })
})
