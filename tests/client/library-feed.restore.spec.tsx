// @vitest-environment jsdom
/**
 * The view pins an instance reopens with: the selected row and the narrow pane
 * come from the durable record, and the detail refetch follows the restored row.
 * @module tests/client/library-feed.restore
 */

import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  writeLibrarySessionView,
  writeLibraryState,
} from '../../src/client/components/library/library-storage.ts'
import type { LibraryStoredState } from '../../src/client/components/library/library-storage.ts'
import { ITEM_DETAIL } from './helpers/library-panel-harness.tsx'
import { setupLibraryFeed as setup } from './helpers/library-feed-harness.ts'

const SELECTED = 'zotero://user/0/item/ITEM0001?server=S1'

/** The durable record with everything at its default but the view pins. */
function stored(overrides: Partial<LibraryStoredState> = {}): LibraryStoredState {
  return {
    version: 1,
    library: { type: 'user', id: 0 },
    selection: { kind: 'library' },
    q: '',
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
    filters: {},
    ...overrides,
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('restored view pins', () => {
  it('restores the selected row and the narrow pane from the instance record', async () => {
    writeLibraryState('S1', stored({ selectedRef: SELECTED, narrowPane: 'inspector' }))
    const { result, face } = setup()
    await waitFor(() => expect(result.current.selectedRef).toBe(SELECTED))
    expect(result.current.narrowPane).toBe('inspector')
    await waitFor(() =>
      expect(face.item).toHaveBeenCalledWith(expect.objectContaining({ ref: SELECTED })),
    )
  })

  it('falls back to the inspector pane when only the row was stored', async () => {
    writeLibraryState('S1', stored({ selectedRef: SELECTED }))
    const { result } = setup()
    await waitFor(() => expect(result.current.narrowPane).toBe('inspector'))
  })

  it('drops a cached detail that names another row and refetches the restored one', async () => {
    writeLibrarySessionView('session-1', {
      inspector: {
        phase: 'ready',
        detail: { ...ITEM_DETAIL, ref: 'zotero://user/0/item/ITEM0002?server=S1' },
      },
    })
    writeLibraryState('S1', stored({ selectedRef: SELECTED }))
    const { result, face } = setup()

    await waitFor(() =>
      expect(face.item).toHaveBeenCalledWith(expect.objectContaining({ ref: SELECTED })),
    )
    await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
    const inspector = result.current.inspector
    // The stale payload named ITEM0002; the restored row's answer replaced it.
    expect(inspector?.phase === 'ready' ? inspector.detail.ref : undefined).toBe(ITEM_DETAIL.ref)
  })
})
