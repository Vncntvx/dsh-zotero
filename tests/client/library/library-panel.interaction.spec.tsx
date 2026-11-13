// @vitest-environment jsdom
/**
 * The library panel's interactions: scope selection, the debounced search box,
 * the paginator, the mode and sort controls, collection expansion, and
 * attachment reading through a session-anchored file address.
 * @module tests/client/library/library-panel.interaction
 */

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  mountPanel,
  searchPage,
} from '../helpers/library-panel-harness.tsx'
import type { ZoteroLibraryBrowseRequestView } from '../../../src/client/remote.ts'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  // Fake timers defeat the automatic cleanup scheduling; drop the tree now.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('scope selection drives the list request', () => {
  it('lists the library scope on open and a collection ref on click', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    expect(face.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: { kind: 'library' } }),
      expect.anything(),
    )
    await screen.findByText('LLM Papers')
    act(() => {
      screen.getByText('LLM Papers').click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: { kind: 'collection', refOrName: 'zotero://user/0/collection/COLL0001' },
        }),
        expect.anything(),
      )
    })
    // The list header carries the name the tree row already knew.
    expect(screen.getByRole('heading', { name: 'LLM Papers' })).toBeTruthy()
  })

  it('lists the trash by its selection', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    act(() => {
      screen.getByText(zh.libraryTrash).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { kind: 'trash' } }),
        expect.anything(),
      )
    })
    // The list header carries the trash's own label.
    expect(screen.getByRole('heading', { name: zh.libraryTrash })).toBeTruthy()
  })

  it('lists my publications by its selection', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    act(() => {
      screen.getByText(zh.libraryPublications).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { kind: 'publications' } }),
        expect.anything(),
      )
    })
    expect(screen.getByRole('heading', { name: zh.libraryPublications })).toBeTruthy()
  })
})

describe('the paginator walks both ways and refresh reruns every lane', () => {
  it('pages forward, back, and refreshes all lanes', async () => {
    const { face } = mountPanel({
      search: vi.fn(async (request: { offset: number }) => ({
        ok: true,
        value: searchPage({ offset: request.offset, total: 120, nextOffset: request.offset + 2 }),
      })),
    })
    await screen.findByText('FlashAttention-2')
    act(() => {
      screen.getByRole('button', { name: zh.libraryPageNext }).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 2 }),
        expect.anything(),
      )
    })
    act(() => {
      screen.getByRole('button', { name: zh.libraryPagePrev }).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0 }),
        expect.anything(),
      )
    })
    const browseCalls = face.browse.mock.calls.length
    const searchCalls = face.search.mock.calls.length
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    await waitFor(() => {
      expect(face.browse.mock.calls.length).toBeGreaterThan(browseCalls)
      expect(face.search.mock.calls.length).toBeGreaterThan(searchCalls)
    })
  })

  it('clears the inspector when the selected row is clicked again', async () => {
    const { face } = mountPanel()
    const rowButton = (await screen.findAllByText('FlashAttention-2'))[0]!.closest('button')!
    act(() => {
      rowButton.click()
    })
    await waitFor(() => {
      expect(face.item).toHaveBeenCalledTimes(1)
    })
    // The same title also names the inspector heading; the list row is first.
    act(() => {
      screen.getAllByText('FlashAttention-2')[0]!.closest('button')!.click()
    })
    await waitFor(() => {
      expect(screen.getByText(zh.libraryNoSelection)).toBeTruthy()
    })
    // The cleared selection makes no further detail request.
    expect(face.item).toHaveBeenCalledTimes(1)
  })
})

describe('the search box debounces into the request', () => {
  it('waits for the debounce and sends the settled query', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    const input = screen.getByPlaceholderText(zh.librarySearchPlaceholder)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'attention' } })
      // Before the debounce elapses the raw keystroke has not left yet.
      expect(face.search).not.toHaveBeenCalledWith(
        expect.objectContaining({ q: 'attention' }),
        expect.anything(),
      )
      await vi.advanceTimersByTimeAsync(350)
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'attention' }),
        expect.anything(),
      )
    })
  })
})

describe('the toolbar rewinds to the first page on change', () => {
  it('resets the offset when the mode toggles and the sort changes', async () => {
    const { face } = mountPanel({
      search: vi.fn(async (request: { offset: number }) => ({
        ok: true,
        value: searchPage({
          offset: request.offset,
          total: 120,
          nextOffset: request.offset + 2,
        }),
      })),
    })
    await screen.findByText('FlashAttention-2')
    act(() => {
      screen.getByRole('button', { name: zh.libraryPageNext }).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 2 }),
        expect.anything(),
      )
    })
    // A mode toggle rewinds to page zero rather than reloading page two.
    act(() => {
      screen.getByRole('tab', { name: zh.librarySearchModeEverything }).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, mode: 'everything' }),
        expect.anything(),
      )
    })
  })

  it('sends the chosen sort and direction', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    const sortBtn = screen.getByLabelText(zh.librarySortLabel)
    await act(async () => {
      sortBtn.click()
    })
    const targetOption = await screen.findByText(`${zh.librarySortTitle} · ${zh.librarySortAsc}`)
    await act(async () => {
      targetOption.click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'title', direction: 'asc' }),
        expect.anything(),
      )
    })
  })

  it('only presents declared sort and library options', async () => {
    const { face } = mountPanel()
    await screen.findByText('FlashAttention-2')
    const sortBtn = screen.getByLabelText(zh.librarySortLabel)
    await act(async () => {
      sortBtn.click()
    })
    expect(screen.queryByText(/bogus/)).toBeNull()
    expect(face.search).not.toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'title' }),
      expect.anything(),
    )
    expect(face.browse).not.toHaveBeenCalledWith(
      expect.objectContaining({ library: { type: 'group', id: 999 } }),
    )
  })
})

describe('the tree loads one level per expand', () => {
  it('requests the children listing when a collection expands', async () => {
    const { face } = mountPanel()
    await screen.findByText('LLM Papers')
    const browseCallsBefore = face.browse.mock.calls.length
    act(() => {
      screen.getByRole('button', { name: 'LLM Papers', expanded: false }).click()
    })
    await screen.findByText('Attention')
    const childCall = face.browse.mock.calls.find(
      ([request]) =>
        (request as ZoteroLibraryBrowseRequestView).parentRef ===
        'zotero://user/0/collection/COLL0001',
    )
    expect(childCall).toBeDefined()
    expect(face.browse.mock.calls.length).toBe(browseCallsBefore + 1)
    // A re-expand of the loaded level is served from the cache.
    act(() => {
      screen.getByRole('button', { name: 'LLM Papers', expanded: true }).click()
    })
    act(() => {
      screen.getByRole('button', { name: 'LLM Papers', expanded: false }).click()
    })
    await screen.findByText('Attention')
    expect(face.browse.mock.calls.length).toBe(browseCallsBefore + 1)
  })

  it('refetches the expanded levels on refresh and keeps them rendered', async () => {
    const { face } = mountPanel()
    await screen.findByText('LLM Papers')
    act(() => {
      screen.getByRole('button', { name: 'LLM Papers', expanded: false }).click()
    })
    await screen.findByText('Attention')
    const childCallsOf = (): number =>
      face.browse.mock.calls.filter(
        ([request]) => (request as ZoteroLibraryBrowseRequestView).parentRef !== undefined,
      ).length
    const before = childCallsOf()
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    await waitFor(() => {
      expect(childCallsOf()).toBe(before + 1)
    })
    // The expanded level stays open with its children refilled.
    expect(screen.getByText('Attention')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LLM Papers', expanded: true })).toBeTruthy()
  })
})

describe('the library selector switches libraries', () => {
  it('reloads the tree and the saved searches for the chosen library', async () => {
    const { face } = mountPanel()
    await screen.findByText('LLM Papers')
    const libraryBtn = screen.getByLabelText(zh.librarySelectLibrary)
    await act(async () => {
      libraryBtn.click()
    })
    const labOption = await screen.findByText('Lab Reading')
    await act(async () => {
      labOption.click()
    })
    await waitFor(() => {
      expect(face.browse).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'collections',
          library: { type: 'group', id: 123 },
        }),
      )
    })
    expect(face.browse).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'savedSearches', library: { type: 'group', id: 123 } }),
    )
    // Switching back to the personal library re-runs both lanes for user/0.
    // The first change re-rendered the toolbar, so re-query the button.
    const libraryBtn2 = screen.getByLabelText(zh.librarySelectLibrary)
    await act(async () => {
      libraryBtn2.click()
    })
    const myLibOption = await screen.findByText('My Library')
    await act(async () => {
      myLibOption.click()
    })
    await waitFor(() => {
      expect(face.browse).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'collections', library: { type: 'user', id: 0 } }),
      )
    })
    // The scope resets to the library view, not the previous collection, and
    // the reset applies to the library now selected (user/0 after the switch
    // back).
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: { kind: 'library' },
          library: { type: 'user', id: 0 },
        }),
        expect.anything(),
      )
    })
  })
})

describe('the inspector chat actions ride the session input face', () => {
  it('asks in chat by inserting citation quote without submitting', async () => {
    const { inputActions } = mountPanel()
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const ask = await screen.findByRole('button', { name: zh.libraryAskInChat })
    act(() => {
      ask.click()
    })
    expect(inputActions.insertQuote).toHaveBeenCalledTimes(1)
    const [quote] = inputActions.insertQuote.mock.calls[0] as unknown as [string]
    expect(quote).toContain('FlashAttention-2')
    expect(quote).toContain('zotero://user/0/item/ITEM0001')
    expect(inputActions.submit).not.toHaveBeenCalled()
  })
})

describe('the inspector requests the full child set', () => {
  it('asks for notes, attachments, and annotations in one call', async () => {
    const { face } = mountPanel()
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    await waitFor(() => {
      expect(face.item).toHaveBeenCalledWith(
        {
          ref: 'zotero://user/0/item/ITEM0001',
          include: ['notes', 'attachments', 'annotations'],
          childPages: {
            notes: { offset: 0, limit: 20 },
            attachments: { offset: 0, limit: 20 },
            annotations: { offset: 0, limit: 20 },
          },
        },
        expect.anything(),
      )
    })
    expect(ITEM_DETAIL.title).toBe('FlashAttention-2')
  })
})

describe('a rejecting wire face surfaces its lane error, then recovers', () => {
  it('shows the selector error when the libraries listing rejects', async () => {
    let librariesCalls = 0
    mountPanel({
      browse: vi.fn(async (request: { kind: string }) => {
        if (request.kind === 'libraries') {
          librariesCalls += 1
          if (librariesCalls === 1) throw new Error('libraries blew up')
          return { ok: true, value: LIBRARY_ROWS }
        }
        if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
        return { ok: true, value: ROOT_COLLECTIONS }
      }),
    })
    expect(await screen.findByText('libraries blew up')).toBeTruthy()
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    expect(await screen.findByText('My Library')).toBeTruthy()
  })

  it('shows the tree error when the root listing rejects and recovers on refresh', async () => {
    let rootCalls = 0
    mountPanel({
      browse: vi.fn(async (request: { kind: string }) => {
        if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
        if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
        rootCalls += 1
        if (rootCalls === 1) throw new Error('root blew up')
        return { ok: true, value: ROOT_COLLECTIONS }
      }),
    })
    expect(await screen.findByText('root blew up')).toBeTruthy()
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    expect(await screen.findByText('LLM Papers')).toBeTruthy()
  })

  it('shows the list error when search rejects and recovers on the next page', async () => {
    let searchCalls = 0
    mountPanel({
      search: vi.fn(async (request: { offset: number }) => {
        searchCalls += 1
        if (searchCalls === 1) throw new Error('search blew up')
        return { ok: true, value: searchPage({ offset: request.offset }) }
      }),
    })
    expect(await screen.findByText('search blew up')).toBeTruthy()
    // The paginator hides on error, so recovery goes through a toolbar change.
    act(() => {
      screen.getByRole('tab', { name: zh.librarySearchModeEverything }).click()
    })
    expect(await screen.findByText('FlashAttention-2')).toBeTruthy()
  })

  it('shows the inspector error when the detail rejects and recovers on reselect', async () => {
    let itemCalls = 0
    mountPanel({
      item: vi.fn(async () => {
        itemCalls += 1
        if (itemCalls === 1) throw new Error('item blew up')
        return { ok: true, value: ITEM_DETAIL }
      }),
    })
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    expect(await screen.findByText('item blew up')).toBeTruthy()
    act(() => {
      row.click()
    })
    await screen.findByText(zh.libraryNoSelection)
    act(() => {
      row.click()
    })
    expect(await screen.findByText('NeurIPS')).toBeTruthy()
  })
})
