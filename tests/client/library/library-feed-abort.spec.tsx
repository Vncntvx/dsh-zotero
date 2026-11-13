// @vitest-environment jsdom
/** Independent request lanes, restoration and inspector lifetime. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ITEM_DETAIL, searchPage } from '../helpers/library-panel-harness.tsx'
import { deferred } from '../../helpers/sync.ts'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('feed read cancellation', () => {
  it('debounces a changed query at offset zero and rejects the old list response', async () => {
    vi.useFakeTimers()
    const stale = deferred<any>()
    const search = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: searchPage() })
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue({ ok: true, value: searchPage({ items: [], total: 0, returned: 0 }) })
    const { result } = setup({ search })
    await act(async () => {})
    act(() => result.current.gotoOffset(50))
    await act(async () => {})
    act(() => result.current.setQ('updated'))
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'updated', offset: 0 }),
      expect.anything(),
    )
    await act(async () => stale.resolve({ ok: true, value: searchPage({ offset: 50 }) }))
    expect(result.current.list).toMatchObject({ phase: 'ready', items: [] })
  })

  it('aborts the previous list read whenever the listing changes', async () => {
    // The sequence ticket drops a stale answer only after it arrives; the
    // abort signal is what stops the host from answering a listing the user
    // already left.
    const signals: Array<AbortSignal | undefined> = []
    const search = vi.fn(async (_request: unknown, signal?: AbortSignal) => {
      signals.push(signal)
      return { ok: true as const, value: searchPage() }
    })
    const { result } = setup({ search })
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.setMode('everything'))
    await waitFor(() => expect(signals).toHaveLength(2))
    act(() => result.current.setSort('title', 'asc'))
    await waitFor(() => expect(signals).toHaveLength(3))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(true)
    expect(signals[2]?.aborted).toBe(false)
  })

  it('aborts the previous detail read when another row is selected', async () => {
    const signals: Array<AbortSignal | undefined> = []
    const item = vi.fn(async (_request: unknown, signal?: AbortSignal) => {
      signals.push(signal)
      return { ok: true as const, value: ITEM_DETAIL }
    })
    const { result } = setup({ item })
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    await waitFor(() => expect(signals).toHaveLength(1))
    act(() => result.current.selectItem('zotero://user/0/item/OTHER123'))
    await waitFor(() => expect(signals).toHaveLength(2))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })
})
