// @vitest-environment jsdom
/**
 * The library panel's interactions: scope selection, the debounced search box,
 * the paginator, the mode and sort controls, collection expansion, and
 * attachment reading through a session-anchored file address.
 * @module tests/client/library-panel.interaction
 */

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHILD_COLLECTIONS,
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  mountPanel,
  searchPage,
} from './helpers/library-panel-harness.tsx'
import type {
  ZoteroLibraryBrowseRequestView,
  ZoteroSearchResultView,
} from '../../src/client/remote.ts'
import { deferred } from '../helpers/sync.ts'
import { zh } from '../../src/client/locales.ts'

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
      )
    })
    // The list header carries the name the tree row already knew.
    expect(screen.getByRole('heading', { name: 'LLM Papers' })).toBeTruthy()
  })

  it('lists a saved search and the trash by their selections', async () => {
    const { face } = mountPanel()
    await screen.findByText('Unread')
    act(() => {
      screen.getByText('Unread').click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope: { kind: 'savedSearch', refOrName: 'zotero://user/0/search/SEARCH01' },
        }),
      )
    })
    act(() => {
      screen.getByText(zh.libraryTrash).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { kind: 'trash' } }),
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
      expect(face.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }))
    })
    act(() => {
      screen.getByRole('button', { name: zh.libraryPagePrev }).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
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
      expect(face.search).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'attention' }))
      await vi.advanceTimersByTimeAsync(350)
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'attention' }))
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
      expect(face.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }))
    })
    // A mode toggle rewinds to page zero rather than reloading page two.
    act(() => {
      screen.getByRole('tab', { name: zh.librarySearchModeEverything }).click()
    })
    await waitFor(() => {
      expect(face.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, mode: 'everything' }),
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
    expect(face.search).not.toHaveBeenCalledWith(expect.objectContaining({ sort: 'title' }))
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
      )
    })
  })
})

describe('the inspector chat actions ride the session input face', () => {
  it('asks in chat by prefilling the draft without submitting', async () => {
    const { inputActions } = mountPanel()
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const ask = await screen.findByRole('button', { name: zh.libraryAskInChat })
    act(() => {
      ask.click()
    })
    expect(inputActions.setDraft).toHaveBeenCalledTimes(1)
    const [draft] = inputActions.setDraft.mock.calls[0] as unknown as [string]
    expect(draft).toContain('FlashAttention-2')
    expect(draft).toContain('zotero://user/0/item/ITEM0001')
    expect(inputActions.submit).not.toHaveBeenCalled()
  })

  it('adds the citation line at the caret without touching the rest of the draft', async () => {
    const { inputActions } = mountPanel()
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const add = await screen.findByRole('button', { name: zh.libraryAddToChat })
    act(() => {
      add.click()
    })
    expect(inputActions.captureInsertion).toHaveBeenCalledTimes(1)
    expect(inputActions.insertText).toHaveBeenCalledTimes(1)
    const [text, span] = inputActions.insertText.mock.calls[0] as unknown as [string, unknown]
    expect(text).toContain('FlashAttention-2')
    expect(text).toContain('zotero://user/0/item/ITEM0001')
    expect(span).toBe(inputActions.captureInsertion.mock.results[0]?.value)
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
      expect(face.item).toHaveBeenCalledWith({
        ref: 'zotero://user/0/item/ITEM0001',
        include: ['notes', 'attachments', 'annotations'],
        childPages: {},
      })
    })
    expect(ITEM_DETAIL.title).toBe('FlashAttention-2')
  })
})

describe('a stale answer never overwrites a newer one', () => {
  it('drops the stale list page when a newer request already answered', async () => {
    const first = deferred<{ ok: true; value: ZoteroSearchResultView }>()
    const { face } = mountPanel({
      search: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementation(async (request: { offset: number }) => ({
          ok: true,
          value: searchPage({ offset: request.offset, total: 77, nextOffset: undefined }),
        })),
    })
    await act(async () => {
      await Promise.resolve()
    })
    // A second toolbar change answers while the first page is still out.
    act(() => {
      screen.getByRole('tab', { name: zh.librarySearchModeEverything }).click()
    })
    await screen.findByText('FlashAttention-2')
    expect(screen.getByText('第 1–2 条，共 77 条')).toBeTruthy()
    await act(async () => {
      first.resolve({
        ok: true,
        value: searchPage({ total: 1, items: [searchPage().items[0]!] }),
      })
    })
    // The stale answer must not pull the older total back.
    expect(screen.getByText('第 1–2 条，共 77 条')).toBeTruthy()
    expect(face.search).toHaveBeenCalledTimes(2)
  })

  it('drops the stale detail when a newer selection already answered', async () => {
    const stale = deferred<{ ok: true; value: unknown }>()
    mountPanel({
      item: vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async () => ({
          ok: true,
          value: { ...ITEM_DETAIL, title: 'Newer detail' },
        })),
    })
    await act(async () => {
      await Promise.resolve()
    })
    const row = (await screen.findAllByText('FlashAttention-2'))[0]!.closest('button')!
    // Select (the request hangs), deselect (advancing the sequence), then
    // select again: the second request answers 'Newer detail'.
    act(() => {
      row.click()
    })
    act(() => {
      row.click()
    })
    await screen.findByText(zh.libraryNoSelection)
    act(() => {
      row.click()
    })
    await screen.findByText('Newer detail')
    await act(async () => {
      stale.resolve({ ok: true, value: ITEM_DETAIL })
    })
    // The stale detail must not take the inspector back.
    expect(screen.getByText('Newer detail')).toBeTruthy()
  })

  it('drops the stale tree lane when a refresh already answered', async () => {
    const staleRoot = deferred<{ ok: true; value: unknown }>()
    let calls = 0
    mountPanel({
      browse: vi.fn(async (request: { kind: string; parentRef?: string }) => {
        if (request.kind === 'collections' && request.parentRef === undefined) {
          calls += 1
          if (calls === 1) return staleRoot.promise
          return { ok: true, value: ROOT_COLLECTIONS }
        }
        if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
        return { ok: true, value: SAVED_SEARCHES }
      }),
    })
    await act(async () => {
      await Promise.resolve()
    })
    // The refresh re-requests the root lane and answers while the first
    // listing is still out.
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    await screen.findByText('LLM Papers')
    await act(async () => {
      staleRoot.resolve({ ok: true, value: { ...ROOT_COLLECTIONS, items: [] } })
    })
    // The stale empty root must not clear the tree.
    expect(screen.getByText('LLM Papers')).toBeTruthy()
  })

  it('answers two concurrent level loads without dropping either', async () => {
    const first = deferred<{ ok: true; value: unknown }>()
    const second = deferred<{ ok: true; value: unknown }>()
    let childCalls = 0
    const reasoningChildren = {
      ...CHILD_COLLECTIONS,
      items: [
        {
          kind: 'collection',
          ref: 'zotero://user/0/collection/COLL0021',
          name: 'Chains',
          parentRef: 'zotero://user/0/collection/COLL0002',
          path: ['Reasoning', 'Chains'],
          depth: 1,
        },
      ],
    }
    mountPanel({
      browse: vi.fn(async (request: { kind: string; parentRef?: string }) => {
        if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
        if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
        if (request.parentRef !== undefined) {
          childCalls += 1
          return childCalls === 1 ? first.promise : second.promise
        }
        return { ok: true, value: ROOT_COLLECTIONS }
      }),
    })
    await screen.findByText('LLM Papers')
    // Two levels expand while both of their listings are still out: the tree
    // lanes ticket per key, so neither answer invalidates the other's.
    act(() => {
      screen.getByRole('button', { name: 'LLM Papers', expanded: false }).click()
    })
    act(() => {
      screen.getByRole('button', { name: 'Reasoning', expanded: false }).click()
    })
    expect(childCalls).toBe(2)
    // The newer answer lands first; the older one must still take its lane.
    await act(async () => {
      second.resolve({ ok: true, value: reasoningChildren })
    })
    await act(async () => {
      first.resolve({ ok: true, value: CHILD_COLLECTIONS })
    })
    expect(await screen.findByText('Attention')).toBeTruthy()
    expect(screen.getByText('Chains')).toBeTruthy()
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

  it('shows the saved-searches error when its listing rejects and recovers on refresh', async () => {
    let savedCalls = 0
    mountPanel({
      browse: vi.fn(async (request: { kind: string }) => {
        if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
        if (request.kind === 'savedSearches') {
          savedCalls += 1
          if (savedCalls === 1) throw new Error('saved blew up')
          return { ok: true, value: SAVED_SEARCHES }
        }
        return { ok: true, value: ROOT_COLLECTIONS }
      }),
    })
    expect(await screen.findByText('saved blew up')).toBeTruthy()
    act(() => {
      screen.getByRole('button', { name: zh.refresh }).click()
    })
    expect(await screen.findByText('Unread')).toBeTruthy()
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
