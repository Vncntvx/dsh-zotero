// @vitest-environment jsdom
/**
 * The feed's defensive seams: calls made before their precondition holds, a
 * listing that fails, and the post-write refresh that touches only its lanes.
 * @module tests/client/library/library-feed.seams
 */

import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ITEM_DETAIL, ROOT_COLLECTIONS } from '../helpers/library-panel-harness.tsx'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'
import { deferred } from '../../helpers/sync.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('unguarded seams', () => {
  it('ignores child paging before a row is selected', () => {
    const { result, face } = setup()
    result.current.pageChild('notes', 0)
    expect(face.childPage).not.toHaveBeenCalled()
  })

  it('retries a tree lane from offset 0 when nothing was recorded', async () => {
    const { result, face } = setup()
    await waitFor(() => expect(result.current.libraries.phase).toBe('ready'))
    vi.mocked(face.browse).mockClear()
    act(() => result.current.retryTree(undefined))
    await waitFor(() =>
      expect(face.browse).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 })),
    )
  })

  it('surfaces a libraries listing failure instead of retrying forever', async () => {
    const { result } = setup({
      browse: vi.fn(async (request: { kind: string }) =>
        request.kind === 'libraries'
          ? {
              ok: false as const,
              error: new RemoteError('zotero/domain', 'listing down', {
                code: 'ZOTERO_UNEXPECTED',
              }),
            }
          : { ok: true as const, value: ROOT_COLLECTIONS },
      ),
    })
    await waitFor(() =>
      expect(result.current.libraries).toEqual({ phase: 'error', message: 'listing down' }),
    )
  })

  it('keeps the detail state when a child page answers before the detail is ready', async () => {
    const item = deferred<{ ok: true; value: typeof ITEM_DETAIL }>()
    const child = deferred<never>()
    const { result } = setup({
      item: vi.fn(() => item.promise),
      childPage: vi.fn(() => child.promise),
    })
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    act(() => result.current.selectItem(ITEM_DETAIL.ref))
    expect(result.current.inspector?.phase).toBe('loading')

    act(() => result.current.pageChild('notes', 0))
    await act(async () => {
      child.resolve({
        ok: true,
        value: {
          kind: 'notes',
          page: { total: 0, returned: 0, offset: 0, limit: 50, items: [] },
        },
      } as never)
    })

    // The detail is still loading; the child answer must not fabricate one.
    expect(result.current.inspector?.phase).toBe('loading')
    expect(result.current.childStates.notes).toBeUndefined()
    await act(async () => {
      item.resolve({ ok: true, value: ITEM_DETAIL })
    })
  })

  it('refreshes only the lanes a write touched', async () => {
    const { result, face } = setup()
    await waitFor(() => expect(result.current.libraries.phase).toBe('ready'))
    await waitFor(() => expect(result.current.list.phase).toBe('ready'))
    vi.mocked(face.search).mockClear()
    vi.mocked(face.item).mockClear()

    act(() => result.current.refreshAffected('items'))
    await waitFor(() => expect(face.search).toHaveBeenCalledTimes(1))
    // No row is selected, so the inspector lane stays idle.
    expect(face.item).not.toHaveBeenCalled()
  })
})
