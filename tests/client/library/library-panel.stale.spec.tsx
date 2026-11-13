// @vitest-environment jsdom
/**
 * The library panel's interactions: scope selection, the debounced search box,
 * the paginator, the mode and sort controls, collection expansion, and
 * attachment reading through a session-anchored file address.
 * @module tests/client/library/library-panel.interaction
 */

import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHILD_COLLECTIONS,
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  mountPanel,
  searchPage,
} from '../helpers/library-panel-harness.tsx'
import type { ZoteroSearchResultView } from '../../../src/client/remote.ts'
import { deferred } from '../../helpers/sync.ts'
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
    await waitFor(() => expect(childCalls).toBe(2))
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
