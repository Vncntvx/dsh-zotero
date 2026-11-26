// @vitest-environment jsdom
/** Tag requests and pending searches stay within the selected library's lifetime. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { useState } from 'react'
import type { SupportedLocalLibrary, ZoteroLibraryBrowseResultView } from '../../../src/contract.ts'
import { LibraryTagPicker } from '../../../src/client/components/library/LibraryTagPicker.tsx'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type { LibraryFilters } from '../../../src/client/components/library/library-model.ts'
import { zh } from '../../../src/client/locales.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function tagPage(tag: string): RemoteResult<ZoteroLibraryBrowseResultView> {
  return {
    ok: true,
    value: {
      kind: 'tags',
      items: [{ kind: 'tag', tag }],
      total: 1,
      offset: 0,
      returned: 1,
      limit: 50,
    },
  }
}

function mountPicker(
  browse: LibraryFeedFace['browse'],
  initial: LibraryFilters = {},
  enabled = true,
) {
  const change = vi.fn()
  const face: LibraryFeedFace = {
    collectionPath: vi.fn(),
    browse,
    search: vi.fn(),
    item: vi.fn(),
    childPage: vi.fn(),
  }
  function Picker({ library }: { library: SupportedLocalLibrary }) {
    const [value, setValue] = useState(initial)
    return (
      <LibraryTagPicker
        t={mockT}
        face={face}
        library={library}
        value={value}
        change={(next) => {
          change(next)
          setValue(next)
        }}
        enabled={enabled}
        tagsRefresh={0}
      />
    )
  }
  const view = render(<Picker library={{ type: 'user', id: 0 }} />)
  return {
    ...view,
    change,
    selectLibrary: (library: SupportedLocalLibrary) => view.rerender(<Picker library={library} />),
  }
}

describe('tag picker request lifetime', () => {
  it.each(['switch', 'unmount'] as const)('aborts an unneeded tag page on %s', async (action) => {
    const pending = deferred<RemoteResult<ZoteroLibraryBrowseResultView>>()
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(tagPage('current'))
    const picker = mountPicker(browse)
    const signal = browse.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)
    if (action === 'switch') picker.selectLibrary({ type: 'group', id: 123 })
    else picker.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => pending.resolve(tagPage('abandoned')))
    expect(screen.queryByRole('option', { name: 'abandoned' })).toBeNull()
  })

  it('aborts the in-flight page when a new search supersedes it', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryBrowseResultView>>()
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(tagPage('fresh'))
    mountPicker(browse)
    const signal = browse.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fresh' } })
    expect(signal?.aborted).toBe(true)
    expect(await screen.findByRole('option', { name: 'fresh' })).toBeTruthy()
    await act(async () => pending.resolve(tagPage('stale')))
    expect(screen.queryByRole('option', { name: 'stale' })).toBeNull()
    expect(browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'fresh', match: 'contains' }),
      expect.any(AbortSignal),
    )
  })

  it('toggles a selected tag without losing the other filters', async () => {
    const picker = mountPicker(vi.fn().mockResolvedValue(tagPage('alpha')), { yearFrom: 2020 })
    const tag = await screen.findByRole('option', { name: 'alpha' })
    fireEvent.click(tag)
    expect(picker.change).toHaveBeenLastCalledWith({ yearFrom: 2020, tags: ['alpha'] })
    expect(tag.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tag)
    expect(picker.change).toHaveBeenLastCalledWith({ yearFrom: 2020, tags: [] })
    expect(tag.getAttribute('aria-selected')).toBe('false')
  })

  it('debounces tag searches, trims the query and appends the next page', async () => {
    vi.useFakeTimers()
    const first = tagPage('alpha')
    if (!first.ok) throw new Error('expected successful fixture')
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValueOnce({ ok: true, value: { ...first.value, total: 2, nextOffset: 1 } })
      .mockResolvedValueOnce(tagPage('beta'))
      .mockResolvedValue(tagPage('filtered'))
    await act(async () => {
      mountPicker(browse)
    })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: zh.libraryLoadMore })))
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'beta' })).toBeTruthy()
    expect(browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 1 }),
      expect.any(AbortSignal),
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' fil ' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' filtered ' } })
    expect(browse).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'filtered', match: 'contains', offset: 0 }),
      expect.any(AbortSignal),
    )
    expect(screen.queryByRole('option', { name: 'alpha' })).toBeNull()
    expect(screen.getByRole('option', { name: 'filtered' })).toBeTruthy()
  })

  it('reports failed and rejected wire requests without caching their rows', async () => {
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('zotero/unexpected', 'tag failure', { code: 'ZOTERO_UNEXPECTED' }),
      })
      .mockRejectedValueOnce(new Error('disconnected'))
    mountPicker(browse)
    expect((await screen.findByRole('alert')).textContent).toBe('tag failure')
    fireEvent.click(screen.getByRole('button', { name: zh.libraryRetry }))
    await screen.findByText('disconnected')
    expect(screen.queryByText(zh.libraryLoading)).toBeNull()
  })

  it('does not request tags or schedule searches while disabled', async () => {
    vi.useFakeTimers()
    const browse = vi.fn()
    mountPicker(browse, {}, false)
    expect(screen.getByRole<HTMLInputElement>('searchbox').disabled).toBe(true)
    await act(async () => vi.runAllTimersAsync())
    expect(browse).not.toHaveBeenCalled()
  })

  it('ignores the first library response after switching and loads the new library immediately', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryBrowseResultView>>()
    const browse = vi.fn<LibraryFeedFace['browse']>().mockReturnValueOnce(pending.promise)
    browse.mockResolvedValue(tagPage('group-tag'))
    const picker = mountPicker(browse)
    picker.selectLibrary({ type: 'group', id: 123 })
    await act(async () => pending.resolve(tagPage('old-tag')))
    expect(screen.queryByRole('option', { name: 'old-tag' })).toBeNull()
    expect(await screen.findByRole('option', { name: 'group-tag' })).toBeTruthy()
    expect(browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ library: { type: 'group', id: 123 } }),
      expect.any(AbortSignal),
    )
  })

  it('keeps loaded tags when an equivalent library object is recreated', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('user-tag'))
    const picker = mountPicker(browse)
    await screen.findByRole('option', { name: 'user-tag' })
    picker.selectLibrary({ type: 'user', id: 0 })
    expect(screen.getByRole('option', { name: 'user-tag' })).toBeTruthy()
    expect(browse).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued search when switching libraries', async () => {
    vi.useFakeTimers()
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('user-tag'))
    const picker = mountPicker(browse)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'queued' } })
    picker.selectLibrary({ type: 'group', id: 123 })
    await act(async () => vi.runAllTimersAsync())
    expect(browse).toHaveBeenCalledTimes(2)
    expect(browse.mock.calls.every(([request]) => !('q' in request))).toBe(true)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
  })

  it('ignores a late rejection after unmount', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryBrowseResultView>>()
    const picker = mountPicker(() => pending.promise)
    picker.unmount()
    await act(async () => pending.reject(new Error('old request')))
  })
})

describe('inline tags pane', () => {
  it('resizes the pane with pointer capture and keyboard bounds', async () => {
    const view = mountPicker(vi.fn().mockResolvedValue(tagPage('alpha')))
    await screen.findByRole('option', { name: 'alpha' })
    const handle = screen.getByRole('separator', { name: zh.libraryTagResize })
    const pane = screen.getByRole('region', { name: zh.libraryFilterTags })
    expect(view.container.contains(pane)).toBe(true)
    expect(pane.style.height).toBe('200px')
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() })
    const pointer = (type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientY })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      fireEvent(handle, event)
    }
    pointer('pointerdown', 350)
    pointer('pointermove', 300)
    expect(pane.style.height).toBe('250px')
    pointer('lostpointercapture', 300)
    pointer('pointermove', 280)
    expect(pane.style.height).toBe('250px')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(pane.style.height).toBe('112px')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(pane.style.height).toBe('128px')
  })

  it('keeps selected tags available even when they are outside the loaded page', async () => {
    const { change } = mountPicker(vi.fn().mockResolvedValue(tagPage('other')), {
      tags: ['alpha', 'beta'],
    })
    await screen.findByRole('option', { name: 'other' })
    expect(screen.getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([
      'alpha',
      'beta',
      'other',
    ])
    fireEvent.click(screen.getByRole('button', { name: zh.libraryTagAll }))
    expect(change).toHaveBeenLastCalledWith({ tags: ['alpha', 'beta'], tagMatch: 'any' })
    fireEvent.click(screen.getByRole('option', { name: 'alpha', selected: true }))
    expect(change).toHaveBeenLastCalledWith({ tags: ['beta'], tagMatch: 'any' })
  })

  it('renders the empty note when no tags match and loading is false', async () => {
    const emptyResult: RemoteResult<ZoteroLibraryBrowseResultView> = {
      ok: true,
      value: {
        kind: 'tags',
        items: [],
        total: 0,
        offset: 0,
        returned: 0,
        limit: 50,
      },
    }
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(emptyResult)
    mountPicker(browse)
    expect(await screen.findByText(zh.libraryNoTags)).toBeTruthy()
  })

  it('ignores rows that are not tags', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue({
      ok: true,
      value: {
        kind: 'tags',
        items: [{ kind: 'item', ref: 'zotero://user/0/item/ITEM0001' } as never],
        total: 1,
        offset: 0,
        returned: 1,
        limit: 50,
      },
    })
    mountPicker(browse)
    expect(await screen.findByText(zh.libraryNoTags)).toBeTruthy()
  })
})

it('supports roving focus, navigation, typeahead and selection', async () => {
  const page = tagPage('alpha')
  if (!page.ok) throw new Error('fixture')
  const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue({
    ok: true,
    value: {
      ...page.value,
      items: ['alpha', 'beta', 'bravo', 'gamma'].map((tag) => ({ kind: 'tag' as const, tag })),
    },
  })
  mountPicker(browse)
  const alpha = await screen.findByRole('option', { name: 'alpha' })
  const beta = screen.getByRole('option', { name: 'beta' })
  const gamma = screen.getByRole('option', { name: 'gamma' })
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(alpha)
  expect(alpha.tabIndex).toBe(0)
  expect(beta.tabIndex).toBe(-1)
  fireEvent.keyDown(alpha, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(beta)
  fireEvent.keyDown(beta, { key: ' ' })
  expect(beta.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(beta, { key: 'End' })
  expect(document.activeElement).toBe(gamma)
  fireEvent.keyDown(gamma, { key: 'Home' })
  expect(document.activeElement).toBe(alpha)
  fireEvent.keyDown(alpha, { key: 'b' })
  expect(document.activeElement).toBe(beta)
  fireEvent.keyDown(beta, { key: 'b' })
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'bravo' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
  expect(screen.getByRole('option', { name: 'bravo' }).getAttribute('aria-selected')).toBe('true')
})

it('supports upward entry and wrapping while ignoring unrelated and modified keys', async () => {
  const page = tagPage('alpha')
  if (!page.ok) throw new Error('fixture')
  const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue({
    ok: true,
    value: {
      ...page.value,
      items: ['alpha', 'beta', 'bravo'].map((tag) => ({ kind: 'tag' as const, tag })),
    },
  })
  mountPicker(browse)
  const alpha = await screen.findByRole('option', { name: 'alpha' })
  const beta = screen.getByRole('option', { name: 'beta' }),
    bravo = screen.getByRole('option', { name: 'bravo' })
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(bravo)
  fireEvent.keyDown(bravo, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(alpha)
  fireEvent.keyDown(alpha, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(bravo)
  fireEvent.keyDown(bravo, { key: 'Home' })
  fireEvent.keyDown(alpha, { key: 'b', ctrlKey: true })
  fireEvent.keyDown(alpha, { key: 'Tab' })
  expect(document.activeElement).toBe(alpha)
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(alpha)
  fireEvent.keyDown(alpha, { key: 'b' })
  fireEvent.keyDown(beta, { key: 'r' })
  expect(document.activeElement).toBe(bravo)
  fireEvent.keyDown(bravo, { key: 'z' })
  expect(document.activeElement).toBe(bravo)
})

it('leaves focus in an empty search instead of targeting a missing option', async () => {
  const page = tagPage('alpha')
  if (!page.ok) throw new Error('fixture')
  mountPicker(
    vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValue({ ok: true, value: { ...page.value, items: [] } }),
  )
  await screen.findByText(zh.libraryNoTags)
  const search = screen.getByRole('searchbox')
  search.focus()
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(search)
})
