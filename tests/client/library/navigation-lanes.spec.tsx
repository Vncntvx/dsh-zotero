// @vitest-environment jsdom
/** Independent request lanes, restoration and inspector lifetime. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type { ZoteroLibraryBrowseRequestView } from '../../../src/contract.ts'
import {
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import { deferred } from '../../helpers/sync.ts'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('navigation lanes', () => {
  it('pages two expanded collections independently when responses arrive in reverse order', async () => {
    const pending = [deferred<any>(), deferred<any>()]
    const browse = vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
      if (request.offset === 2) return pending[request.parentRef?.endsWith('1') ? 0 : 1]!.promise
      return {
        ok: true,
        value: request.parentRef
          ? { ...ROOT_COLLECTIONS, total: 4, nextOffset: 2 }
          : ROOT_COLLECTIONS,
      }
    }) as LibraryFeedFace['browse']
    const { result } = setup({ browse })
    await waitFor(() => expect(result.current.flatTree).toHaveLength(2))
    const refs = ROOT_COLLECTIONS.items.map((row) => ('ref' in row ? row.ref : ''))
    act(() => {
      result.current.toggleCollection(refs[0]!)
      result.current.toggleCollection(refs[1]!)
    })
    await waitFor(() => expect(result.current.treeLane(refs[1])?.phase).toBe('ready'))
    act(() => {
      result.current.loadMoreTree(refs[0])
      result.current.loadMoreTree(refs[1])
    })
    await act(async () =>
      pending[1]!.resolve({
        ok: true,
        value: {
          ...ROOT_COLLECTIONS,
          items: ROOT_COLLECTIONS.items.map((row) =>
            'ref' in row ? { ...row, ref: row.ref.replace('COLL', 'NEXT') } : row,
          ),
          total: 4,
          offset: 2,
          returned: 2,
        },
      }),
    )
    await act(async () =>
      pending[0]!.resolve({
        ok: true,
        value: {
          ...ROOT_COLLECTIONS,
          items: ROOT_COLLECTIONS.items.map((row) =>
            'ref' in row ? { ...row, ref: row.ref.replace('COLL', 'LAST') } : row,
          ),
          total: 4,
          offset: 2,
          nextOffset: undefined,
        },
      }),
    )
    expect(result.current.treeLane(refs[0])).toMatchObject({
      phase: 'ready',
      offset: 0,
      total: 4,
    })
    expect(result.current.treeLane(refs[1])).toMatchObject({ phase: 'ready', offset: 0, total: 4 })
    expect(result.current.expanded.size).toBe(2)
  })

  it('retries only the failed root and retains the successful child lane', async () => {
    let fail = true
    const browse = vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
      if (!request.parentRef && fail)
        return { ok: false, error: new RemoteError('gateway/internal', 'root down', {}) }
      return { ok: true, value: ROOT_COLLECTIONS }
    }) as LibraryFeedFace['browse']
    const { result } = setup({ browse })
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('error'))
    act(() => result.current.loadMoreTree('child'))
    await waitFor(() => expect(result.current.treeLane('child')?.phase).toBe('ready'))
    fail = false
    act(() => result.current.retryTree(undefined))
    await waitFor(() => expect(result.current.treeLane(undefined)?.phase).toBe('ready'))
    expect(result.current.treeLane('child')?.phase).toBe('ready')
    expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('makes saved searches after the first fifty reachable and retries the same page', async () => {
    const browse = vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches')
        return {
          ok: true,
          value: {
            ...SAVED_SEARCHES,
            items:
              request.offset === 0
                ? SAVED_SEARCHES.items
                : SAVED_SEARCHES.items.map((row) =>
                    'ref' in row ? { ...row, ref: row.ref.replace('SEARCH01', 'SEARCH02') } : row,
                  ),
            total: 2,
            offset: request.offset,
            ...(request.offset === 0 ? { nextOffset: 1 } : {}),
          },
        }
      return { ok: true, value: ROOT_COLLECTIONS }
    }) as LibraryFeedFace['browse']
    const { result } = setup({ browse })
    await waitFor(() => expect(result.current.savedSearches).toMatchObject({ nextOffset: 1 }))
    act(() => result.current.loadMoreSavedSearches())
    await waitFor(() => expect(result.current.savedSearches).toMatchObject({ offset: 0, total: 2 }))
    act(() => result.current.retrySavedSearches())
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'savedSearches', offset: 1 }),
      ),
    )
  })
})
