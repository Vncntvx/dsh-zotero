// @vitest-environment jsdom
/**
 * The feed's defensive seams: a retried tree lane, a listing that fails, and
 * the post-write refresh that touches only its lanes.
 * @module tests/client/library/library-feed.seams
 */

import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ROOT_COLLECTIONS } from '../helpers/library-panel-harness.tsx'
import { setupLibraryFeed as setup } from '../helpers/library-feed-harness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('unguarded seams', () => {
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
