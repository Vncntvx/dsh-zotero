// @vitest-environment jsdom
/** Filter controls commit coherent queries and render the panel's type vocabulary. */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroLibraryBrowseResultView } from '../../../src/contract.ts'
import { LibraryFilters } from '../../../src/client/components/library/LibraryFilters.tsx'
import type { LibraryFilters as Filters } from '../../../src/client/components/library/library-model.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type { ItemTypeVocabulary } from '../../../src/client/components/library/use-item-type-labels.ts'
import { zh } from '../../../src/client/locales.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const types: ZoteroLibraryBrowseResultView = {
  kind: 'itemTypes',
  items: [
    { kind: 'itemType', itemType: 'book', localized: 'Books' },
    { kind: 'itemType', itemType: 'journalArticle' },
    { kind: 'itemType', itemType: 'customThing', localized: 'Custom Thing' },
  ],
  total: 3,
  offset: 0,
  returned: 3,
  limit: 50,
}

/** The vocabulary the panel-level read publishes for this listing. */
function vocabularyOf(overrides: Partial<ItemTypeVocabulary> = {}): ItemTypeVocabulary {
  const rows = types.items.flatMap((row) =>
    row.kind === 'itemType'
      ? [
          {
            itemType: row.itemType,
            ...(row.localized !== undefined ? { localized: row.localized } : {}),
          },
        ]
      : [],
  )
  const localized: Record<string, string> = {}
  for (const row of rows) {
    if (row.localized !== undefined) localized[row.itemType] = row.localized
  }
  return { rows, localized, retry: vi.fn(), ...overrides }
}

function mountFilters(initial: Filters = {}, vocabulary = vocabularyOf(), enabled = true) {
  const change = vi.fn()
  const browse = vi.fn<LibraryFeedFace['browse']>()
  const face: LibraryFeedFace = {
    collectionPath: vi.fn(),
    browse,
    search: vi.fn(),
    item: vi.fn(),
    childPage: vi.fn(),
  }
  function Controlled() {
    const [value, setValue] = useState(initial)
    return (
      <LibraryFilters
        t={mockT}
        face={face}
        library={{ type: 'user', id: 0 }}
        value={value}
        enabled={enabled}
        itemTypes={vocabulary}
        change={(next) => {
          change(next)
          setValue(next)
        }}
      />
    )
  }
  return { ...render(<Controlled />), browse, change }
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}
function editYear(side: 'from' | 'to', value: string) {
  const input = screen.getByRole('spinbutton', {
    name: side === 'from' ? zh.libraryYearFrom : zh.libraryYearTo,
  })
  fireEvent.change(input, { target: { value } })
  return input
}

describe('library filter controls', () => {
  it('commits an upper-only year range on blur and clears a pending draft', () => {
    const { change } = mountFilters({ hasAttachment: true })
    click(zh.libraryYearLabel)
    const upper = editYear('to', '2024')
    fireEvent.keyDown(upper, { key: 'Tab' })
    fireEvent.blur(upper)
    expect(change).toHaveBeenLastCalledWith({
      hasAttachment: true,
      yearFrom: undefined,
      yearTo: 2024,
    })
    editYear('from', '2021')
    click(zh.libraryClearFilters)
    expect(change).toHaveBeenLastCalledWith({})
  })

  it('names every item type in the panel language and lets the menu pick it', () => {
    const { change } = mountFilters()
    click(zh.libraryFilterTypes)
    // The plugin dictionary wins over Zotero's own English "Books"; a type it
    // does not know keeps Zotero's localized name.
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText(zh.libraryItemTypeBook)).toBeTruthy()
    expect(within(menu).getByText(zh.libraryItemTypeJournalArticle)).toBeTruthy()
    expect(within(menu).getByText('Custom Thing')).toBeTruthy()
    fireEvent.click(within(menu).getByText(zh.libraryItemTypeBook))
    expect(change).toHaveBeenLastCalledWith({ itemTypes: ['book'] })
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.libraryItemTypeBook))
    expect(change).toHaveBeenLastCalledWith({ itemTypes: [] })
    fireEvent.keyDown(screen.getByText(zh.libraryItemTypeJournalArticle), { key: 'Escape' })
    expect(screen.queryByText(zh.libraryItemTypeBook)).toBeNull()
  })

  it('removes selected type and tag chips and switches tag matching', () => {
    const { change } = mountFilters({
      itemTypes: ['book', 'unknownType'],
      tags: ['alpha', 'beta'],
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: mockT('libraryFilterRemove', { label: zh.libraryItemTypeBook }),
      }),
    )
    expect(change).toHaveBeenLastCalledWith({ itemTypes: ['unknownType'], tags: ['alpha', 'beta'] })
    click(zh.libraryTagAll)
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ tagMatch: 'any' }))
    click(zh.libraryTagAny)
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ tagMatch: 'all' }))
    click(mockT('libraryTagRemove', { tag: 'alpha' }))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ['beta'] }))
  })

  it('picks attachment presence from a three-option menu and clears every filter', () => {
    const { change } = mountFilters()
    click(zh.libraryAttachmentFilter)
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.libraryHasAttachment))
    expect(change).toHaveBeenLastCalledWith({ hasAttachment: true })
    click(zh.libraryAttachmentFilter)
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.libraryNoAttachment))
    expect(change).toHaveBeenLastCalledWith({ hasAttachment: false })
    click(zh.libraryAttachmentFilter)
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.libraryAttachmentFilter))
    expect(change).toHaveBeenLastCalledWith({ hasAttachment: undefined })
    click(zh.libraryYearLabel)
    fireEvent.blur(editYear('from', '2020'))
    click(zh.libraryClearFilters)
    expect(change).toHaveBeenLastCalledWith({})
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('commits a year range once after typing and rejects a crossed range', async () => {
    vi.useFakeTimers()
    const { change } = mountFilters()
    click(zh.libraryYearLabel)
    for (const year of ['2', '20', '202', '2020']) editYear('from', year)
    expect(change).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenLastCalledWith({ yearFrom: 2020, yearTo: undefined })
    fireEvent.keyDown(editYear('to', '2019'), { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe(zh.libraryYearRangeInvalid)
    expect(change).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(editYear('to', '2024'), { key: 'Enter' })
    expect(change).toHaveBeenLastCalledWith({ yearFrom: 2020, yearTo: 2024 })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: zh.libraryYearTo }), { key: 'Tab' })
    fireEvent.blur(screen.getByRole('spinbutton', { name: zh.libraryYearTo }))
    expect(change).toHaveBeenCalledTimes(2)
  })

  it('restores the year draft and commits on close or blur without duplicate changes', () => {
    const { change } = mountFilters({ yearFrom: 2020, yearTo: 2024 })
    fireEvent.click(screen.getByText(zh.libraryYearLabel))
    expect(
      (screen.getByRole('spinbutton', { name: zh.libraryYearFrom }) as HTMLInputElement).value,
    ).toBe('2020')
    fireEvent.keyDown(editYear('from', ''), { key: 'Enter' })
    expect(change).toHaveBeenLastCalledWith({ yearFrom: undefined, yearTo: 2024 })
    editYear('to', '')
    fireEvent.click(screen.getByText(zh.libraryYearLabel))
    expect(change).toHaveBeenLastCalledWith({ yearFrom: undefined, yearTo: undefined })
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('surfaces the vocabulary failure with the vocabulary retry, not a new walk', () => {
    const retry = vi.fn()
    mountFilters({}, vocabularyOf({ error: 'listing failed', retry }))
    expect(screen.getByRole('alert').textContent).toContain('listing failed')
    click(zh.libraryRetry)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('renders no type menu while the vocabulary is empty and never reads the wire itself', () => {
    const { browse } = mountFilters({}, vocabularyOf({ rows: [], localized: {} }))
    expect(screen.queryByRole('button', { name: zh.libraryFilterTypes })).toBeNull()
    expect(browse).not.toHaveBeenCalled()
  })
})
