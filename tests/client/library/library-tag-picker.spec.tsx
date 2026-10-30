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

// The visual primitives are stubbed; the positioning and dismiss hooks stay
// real, because this spec is what proves the popover's placement and closing.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return { ...actual, ...primitivesStub() }
})

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
  const onError = vi.fn()
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
        onError={onError}
      />
    )
  }
  const view = render(<Picker library={{ type: 'user', id: 0 }} />)
  return {
    ...view,
    onError,
    change,
    selectLibrary: (library: SupportedLocalLibrary) => view.rerender(<Picker library={library} />),
    toggle: () => fireEvent.click(screen.getByRole('button', { name: zh.libraryFilterTags })),
  }
}

describe('tag picker request lifetime', () => {
  it('toggles a selected tag without losing the other filters', async () => {
    const picker = mountPicker(vi.fn().mockResolvedValue(tagPage('alpha')), { yearFrom: 2020 })
    picker.toggle()
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
    const picker = mountPicker(browse)
    await act(async () => picker.toggle())
    await act(async () => fireEvent.click(screen.getByRole('button', { name: zh.libraryLoadMore })))
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'beta' })).toBeTruthy()
    expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' fil ' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' filtered ' } })
    expect(browse).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'filtered', match: 'contains', offset: 0 }),
    )
    expect(screen.queryByRole('option', { name: 'alpha' })).toBeNull()
    expect(screen.getByRole('option', { name: 'filtered' })).toBeTruthy()
  })

  it('reports failed and rejected wire requests without caching their rows', async () => {
    const browse = vi
      .fn<LibraryFeedFace['browse']>()
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('zotero/domain', 'tag failure', { code: 'ZOTERO_UNEXPECTED' }),
      })
      .mockRejectedValueOnce(new Error('disconnected'))
    const picker = mountPicker(browse)
    await act(async () => picker.toggle())
    expect(picker.onError).toHaveBeenLastCalledWith('tag failure')
    picker.toggle()
    await act(async () => picker.toggle())
    expect(picker.onError).toHaveBeenLastCalledWith('disconnected')
    expect(screen.queryByText(zh.libraryLoading)).toBeNull()
  })

  it('does not request tags or schedule searches while disabled', async () => {
    vi.useFakeTimers()
    const browse = vi.fn()
    const picker = mountPicker(browse, {}, false)
    picker.toggle()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'disabled' } })
    await act(async () => vi.runAllTimersAsync())
    expect(browse).not.toHaveBeenCalled()
  })

  it('ignores the first library response after switching and queries the new library on reopen', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryBrowseResultView>>()
    const browse = vi.fn<LibraryFeedFace['browse']>().mockReturnValueOnce(pending.promise)
    browse.mockResolvedValue(tagPage('group-tag'))
    const picker = mountPicker(browse)
    picker.toggle()
    picker.selectLibrary({ type: 'group', id: 123 })
    await act(async () => pending.resolve(tagPage('old-tag')))
    expect(screen.queryByRole('option', { name: 'old-tag' })).toBeNull()
    expect(screen.queryByText(zh.libraryLoading)).toBeNull()

    picker.toggle()
    picker.toggle()
    expect(await screen.findByRole('option', { name: 'group-tag' })).toBeTruthy()
    expect(browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ library: { type: 'group', id: 123 } }),
    )
  })

  it('keeps loaded tags when an equivalent library object is recreated', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('user-tag'))
    const picker = mountPicker(browse)
    picker.toggle()
    await screen.findByRole('option', { name: 'user-tag' })
    picker.selectLibrary({ type: 'user', id: 0 })
    expect(screen.getByRole('option', { name: 'user-tag' })).toBeTruthy()
    picker.toggle()
    picker.toggle()
    expect(browse).toHaveBeenCalledTimes(1)
  })

  it('cancels a queued search when switching libraries', async () => {
    vi.useFakeTimers()
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('user-tag'))
    const picker = mountPicker(browse)
    await act(async () => picker.toggle())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'queued' } })
    picker.selectLibrary({ type: 'group', id: 123 })
    await act(async () => vi.runAllTimersAsync())
    expect(browse).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
  })

  it('ignores a late rejection after unmount', async () => {
    const pending = deferred<RemoteResult<ZoteroLibraryBrowseResultView>>()
    const picker = mountPicker(() => pending.promise)
    picker.toggle()
    picker.unmount()
    await act(async () => pending.reject(new Error('old request')))
    expect(picker.onError).not.toHaveBeenCalled()
  })
})

describe('tag picker popover', () => {
  it('dismisses on outside pointerdown and keeps open on inside pointerdown', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('alpha'))
    const picker = mountPicker(browse)
    picker.toggle()
    const input = await screen.findByRole('searchbox')
    fireEvent.pointerDown(input)
    expect(screen.getByRole('searchbox')).toBeTruthy()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('dismisses on Escape key, ignores other keys, and returns focus to the trigger', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('alpha'))
    const picker = mountPicker(browse)
    picker.toggle()
    const input = await screen.findByRole('searchbox')
    input.focus()

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('searchbox')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.libraryFilterTags }))
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
    const picker = mountPicker(browse)
    picker.toggle()
    expect(await screen.findByText(zh.libraryEmptyList)).toBeTruthy()
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
    const picker = mountPicker(browse)
    picker.toggle()
    expect(await screen.findByText(zh.libraryEmptyList)).toBeTruthy()
  })

  it('closes on Escape without stealing focus from outside the panel', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('alpha'))
    const picker = mountPicker(browse)
    picker.toggle()
    await screen.findByRole('searchbox')
    const trigger = screen.getByRole('button', { name: zh.libraryFilterTags })
    ;(document.activeElement as HTMLElement | null)?.blur()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).not.toBe(trigger)
  })

  it('returns focus to the trigger when Escape is pressed from the trigger', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('alpha'))
    const picker = mountPicker(browse)
    picker.toggle()
    await screen.findByRole('searchbox')
    const trigger = screen.getByRole('button', { name: zh.libraryFilterTags })
    trigger.focus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('updates position on resize and scroll, clamping to viewport right edge', async () => {
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('alpha'))
    const picker = mountPicker(browse)
    const trigger = screen.getByRole('button', { name: zh.libraryFilterTags })
    const parent = trigger.parentElement as HTMLElement
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 40,
      left: 800,
      right: 900,
      width: 100,
      height: 30,
      x: 800,
      y: 10,
      toJSON: () => {},
    })
    Object.defineProperty(window, 'innerWidth', { value: 900, writable: true, configurable: true })
    // jsdom lays nothing out: give the panel a measured box so the shared
    // hook's right-edge clamp actually runs (900 - 240 - 8 = 652).
    vi.spyOn(HTMLDivElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    vi.spyOn(HTMLDivElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)

    picker.toggle()
    await screen.findByRole('searchbox')
    const group = screen.getByRole('group', { name: zh.libraryFilterTags })
    expect(group.style.left).toBe('652px')
    expect(group.style.top).toBe('44px')

    fireEvent(window, new Event('resize'))
    fireEvent(window, new Event('scroll'))
    expect(group.style.left).toBe('652px')
  })

  it('cancels a queued search when the panel closes before the debounce fires', async () => {
    vi.useFakeTimers()
    const browse = vi.fn<LibraryFeedFace['browse']>().mockResolvedValue(tagPage('user-tag'))
    const picker = mountPicker(browse)
    await act(async () => picker.toggle())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'queued' } })
    picker.toggle()
    await act(async () => vi.runAllTimersAsync())
    expect(browse).toHaveBeenCalledTimes(1)
  })
})
