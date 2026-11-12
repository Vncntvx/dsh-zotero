// @vitest-environment jsdom
/**
 * The trail pager: pages are appended to what the view already shows, the
 * revision the host reported fences the next request, a list identity change
 * retires the accepted pages, and a failure surfaces as a retryable error.
 * @module tests/client/workspace/useSourcePage
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  useSourcePage,
  type SourcePageCall,
} from '../../../src/client/components/workspace/useSourcePage.ts'
import type { SourceFilter } from '../../../src/sources/filters.js'
import type { ZoteroSourcePageResultView } from '../../../src/contract.ts'

afterEach(() => {
  vi.clearAllMocks()
})

/** One page the host would answer for the given offset. */
function pageOf(offset: number, total = 5): ZoteroSourcePageResultView {
  return {
    sessionId: 'session-1',
    target: { kind: 'sources', filter: 'all' },
    revision: 4,
    offset,
    limit: 2,
    total,
    workspace: {
      sources: [],
      sourceTotal: total,
      exports: [],
      exportTotal: 0,
      exportOperations: { running: 0, failed: 0, stopped: 0 },
      omittedRows: 0,
      filterCounts: {
        all: total,
        pdf: 0,
        retrieved: 0,
        evidence: 0,
        exported: 0,
        issues: 0,
      },
      evidencePassageTotal: 0,
      exportedRefCount: 0,
    },
  }
}

function okPage(page: ZoteroSourcePageResultView): RemoteResult<ZoteroSourcePageResultView> {
  return { ok: true, value: page }
}

describe('useSourcePage', () => {
  it('appends the accepted pages and reports whether rows remain', async () => {
    const call = vi
      .fn<SourcePageCall>()
      .mockImplementation(async (request) => okPage(pageOf(request.offset ?? 0)))
    const { result } = renderHook(() =>
      useSourcePage(call, {
        sessionId: 'session-1',
        target: { kind: 'sources', filter: 'all' },
        offset: 2,
        total: 5,
      }),
    )
    expect(result.current.hasMore).toBe(true)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', offset: 2 }),
      expect.anything(),
    )
    expect(result.current.shown).toBe(4)
    expect(result.current.hasMore).toBe(true)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.pages).toHaveLength(2))
    expect(result.current.shown).toBe(6)
    expect(result.current.hasMore).toBe(false)
  })

  it('fences the second request on the revision the host reported', async () => {
    const call = vi.fn<SourcePageCall>().mockResolvedValue(okPage(pageOf(2)))
    const { result } = renderHook(() =>
      useSourcePage(call, {
        sessionId: 'session-1',
        target: { kind: 'sources', filter: 'all' },
        offset: 2,
        total: 5,
      }),
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(call).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ revision: expect.anything() }),
      expect.anything(),
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2))
    expect(call).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 4, offset: 4 }),
      expect.anything(),
    )
  })

  it('retires the accepted pages when the list identity changes', async () => {
    const call = vi.fn<SourcePageCall>().mockResolvedValue(okPage(pageOf(2)))
    const { result, rerender } = renderHook(
      ({ filter }: { filter: SourceFilter }) =>
        useSourcePage(call, {
          sessionId: 'session-1',
          target: { kind: 'sources', filter },
          offset: 2,
          total: 5,
        }),
      { initialProps: { filter: 'all' as SourceFilter } },
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    rerender({ filter: 'pdf' })
    expect(result.current.pages).toHaveLength(0)
    expect(result.current.shown).toBe(2)
  })

  it('surfaces a refusal as an error and retries the same page', async () => {
    const call = vi
      .fn<SourcePageCall>()
      .mockRejectedValueOnce(
        new RemoteError('zotero/source-page-stale', 'The literature trail changed.', {
          code: 'ZOTERO_SOURCE_PAGE_STALE',
        }),
      )
      .mockResolvedValueOnce(okPage(pageOf(2)))
    const { result } = renderHook(() =>
      useSourcePage(call, {
        sessionId: 'session-1',
        target: { kind: 'sources', filter: 'all' },
        offset: 2,
        total: 5,
      }),
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.error).toContain('changed'))
    expect(result.current.pages).toHaveLength(0)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(call).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }), expect.anything())
  })

  it('does nothing without a call or a session', () => {
    const call = vi.fn<SourcePageCall>()
    const { result } = renderHook(() =>
      useSourcePage(undefined, {
        target: { kind: 'sources', filter: 'all' },
        offset: 2,
        total: 5,
      }),
    )
    act(() => result.current.loadMore())
    expect(call).not.toHaveBeenCalled()
    expect(result.current.hasMore).toBe(false)
  })

  it('rejects a page answering for another session', async () => {
    const call = vi
      .fn<SourcePageCall>()
      .mockResolvedValueOnce(okPage({ ...pageOf(2), sessionId: 'other-session' }))
    const { result } = renderHook(() =>
      useSourcePage(call, {
        sessionId: 'session-1',
        target: { kind: 'sources', filter: 'all' },
        offset: 2,
        total: 5,
      }),
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.error).toContain('belongs to another session'))
    expect(result.current.pages).toHaveLength(0)
  })

  it('handles RemoteResult failure object', async () => {
    const call = vi.fn<SourcePageCall>().mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('zotero/source-page-stale', 'Failed to retrieve source page.', {
        code: 'ZOTERO_SOURCE_PAGE_STALE',
      }),
    })
    const { result } = renderHook(() =>
      useSourcePage(call, {
        sessionId: 'session-1',
        target: { kind: 'sources', filter: 'all' },
        offset: 2,
        total: 5,
      }),
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.error).toContain('Failed to retrieve source page.'))
    expect(result.current.pages).toHaveLength(0)
  })

  it('ignores response if signal was aborted while in flight', async () => {
    let resolveCall: (result: RemoteResult<ZoteroSourcePageResultView>) => void
    const call = vi.fn<SourcePageCall>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve
        }),
    )
    const { result, rerender } = renderHook(
      ({ filter }: { filter: SourceFilter }) =>
        useSourcePage(call, {
          sessionId: 'session-1',
          target: { kind: 'sources', filter },
          offset: 2,
          total: 5,
        }),
      { initialProps: { filter: 'all' as SourceFilter } },
    )
    act(() => result.current.loadMore())
    expect(call).toHaveBeenCalledTimes(1)
    rerender({ filter: 'pdf' })
    await act(async () => {
      resolveCall!(okPage(pageOf(2)))
    })
    expect(result.current.pages).toHaveLength(0)
  })

  it('ignores rejection if signal was aborted while in flight', async () => {
    let rejectCall: (err: unknown) => void
    const call = vi.fn<SourcePageCall>().mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectCall = reject
        }),
    )
    const { result, rerender } = renderHook(
      ({ filter }: { filter: SourceFilter }) =>
        useSourcePage(call, {
          sessionId: 'session-1',
          target: { kind: 'sources', filter },
          offset: 2,
          total: 5,
        }),
      { initialProps: { filter: 'all' as SourceFilter } },
    )
    act(() => result.current.loadMore())
    expect(call).toHaveBeenCalledTimes(1)
    rerender({ filter: 'pdf' })
    await act(async () => {
      rejectCall!(new Error('network aborted'))
    })
    expect(result.current.error).toBeUndefined()
  })
})
