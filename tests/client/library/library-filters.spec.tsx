// @vitest-environment jsdom
/** Filter controls commit coherent queries and retain recoverable listing errors. */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroLibraryBrowseResultView } from '../../../src/contract.ts'
import { LibraryFilters } from '../../../src/client/components/library/LibraryFilters.tsx'
import type { LibraryFilters as Filters } from '../../../src/client/components/library/library-model.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { zh } from '../../../src/client/locales.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const types: ZoteroLibraryBrowseResultView = {
  kind: 'itemTypes',
  items: [
    { kind: 'itemType', itemType: 'book', localized: 'Books' },
    { kind: 'itemType', itemType: 'journalArticle' },
  ],
  total: 2,
  offset: 0,
  returned: 2,
  limit: 50,
}

function mountFilters(
  initial: Filters = {},
  browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue({ ok: true, value: types }),
  enabled = true,
) {
  const change = vi.fn()
  const face: LibraryFeedFace = { browse, search: vi.fn(), item: vi.fn(), childPage: vi.fn() }
  function Controlled() {
    const [value, setValue] = useState(initial)
    return (
      <LibraryFilters
        t={mockT}
        face={face}
        library={{ type: 'user', id: 0 }}
        value={value}
        enabled={enabled}
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
  it('ignores a rejected item-type request after unmount', async () => {
    const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const view = mountFilters(
      {},
      vi.fn(() => pending.promise),
    )
    view.unmount()
    await act(async () => pending.reject(new Error('stale schema failure')))
    expect(screen.queryByRole('alert')).toBeNull()
  })

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
  it('selects and unselects item types through the host menu contract', async () => {
    const { change } = mountFilters()
    await screen.findByRole('button', { name: zh.libraryFilterTypes })
    click(zh.libraryFilterTypes)
    fireEvent.click(screen.getByText('Books'))
    expect(change).toHaveBeenLastCalledWith({ itemTypes: ['book'] })
    fireEvent.click(within(screen.getByRole('menu')).getByText('Books'))
    expect(change).toHaveBeenLastCalledWith({ itemTypes: [] })
    fireEvent.keyDown(screen.getByText('journalArticle'), { key: 'Escape' })
    expect(screen.queryByText('Books')).toBeNull()
  })

  it('removes selected type and tag chips and switches tag matching', async () => {
    const { change } = mountFilters({ itemTypes: ['book', 'unknownType'], tags: ['alpha', 'beta'] })
    await screen.findByRole('button', { name: mockT('libraryFilterRemove', { label: 'Books' }) })
    click(mockT('libraryFilterRemove', { label: 'Books' }))
    expect(change).toHaveBeenLastCalledWith({ itemTypes: ['unknownType'], tags: ['alpha', 'beta'] })
    click(zh.libraryTagAll)
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ tagMatch: 'any' }))
    click(zh.libraryTagAny)
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ tagMatch: 'all' }))
    click(mockT('libraryTagRemove', { tag: 'alpha' }))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ['beta'] }))
  })

  it('cycles attachment presence and clears every filter', () => {
    const { change } = mountFilters()
    click(zh.libraryAttachmentFilter)
    expect(change).toHaveBeenLastCalledWith({ hasAttachment: true })
    click(zh.libraryHasAttachment)
    expect(change).toHaveBeenLastCalledWith({ hasAttachment: false })
    click(zh.libraryNoAttachment)
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
    await act(async () => vi.advanceTimersByTimeAsync(300))
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

  it('walks item-type pages and recovers from a wire failure on retry', async () => {
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('zotero/domain', 'listing failed', { code: 'ZOTERO_UNEXPECTED' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...types, items: [types.items[0]!], nextOffset: 1 },
      })
      .mockResolvedValueOnce({ ok: true, value: { ...types, items: [types.items[1]!], offset: 1 } })
    mountFilters({}, browse)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('listing failed'),
    )
    click(zh.libraryRetry)
    await screen.findByRole('button', { name: zh.libraryFilterTypes })
    expect(browse).toHaveBeenLastCalledWith({ kind: 'itemTypes', offset: 1, limit: 50 })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('refuses a non-advancing item-type cursor', async () => {
    mountFilters(
      {},
      vi
        .fn<LibraryFeedFace['browse']>()
        .mockResolvedValue({ ok: true, value: { ...types, nextOffset: 0 } }),
    )
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining(zh.libraryInvalidPage),
    )
  })

  it('ignores a type listing that resolves after unmount and makes no request while disabled', async () => {
    const pending = deferred<Awaited<ReturnType<LibraryFeedFace['browse']>>>()
    const first = mountFilters(
      {},
      vi.fn(() => pending.promise),
    )
    first.unmount()
    await act(async () => pending.resolve({ ok: true, value: types }))
    const second = mountFilters({}, vi.fn(), false)
    expect(second.browse).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: zh.libraryFilterTypes })).toBeNull()
  })
})
