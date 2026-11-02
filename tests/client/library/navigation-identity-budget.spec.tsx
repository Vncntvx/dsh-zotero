// @vitest-environment jsdom
/** Loading a long prefix costs one identity parse per row, not one per page per row. */
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import { LIBRARY_ROWS, SAVED_SEARCHES } from '../helpers/library-panel-harness.tsx'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type { ZoteroLibraryBrowseResultView } from '../../../src/contract.ts'

let calls = 0
vi.mock('../../../src/client/components/library/navigation-identity.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../src/client/components/library/navigation-identity.ts')
    >()
  return {
    ...actual,
    objectIdentity: (ref: string, serverId?: string) => {
      calls++
      return actual.objectIdentity(ref, serverId)
    },
  }
})

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  calls = 0
})

const ROWS = Array.from({ length: 300 }, (_, index) => ({
  kind: 'collection' as const,
  ref: `zotero://user/0/collection/C${String(index).padStart(7, '0')}`,
  name: `Collection ${index}`,
  path: [`Collection ${index}`],
  depth: 0,
}))

it('parses one identity per row while walking a 300-row prefix', async () => {
  const browse: LibraryFeedFace['browse'] = vi.fn(async (request) => {
    if (request.kind === 'libraries') return { ok: true as const, value: LIBRARY_ROWS }
    if (request.kind === 'savedSearches') return { ok: true as const, value: SAVED_SEARCHES }
    const page: ZoteroLibraryBrowseResultView = {
      kind: 'collections',
      libraryVersion: 1,
      items: ROWS.slice(request.offset, request.offset + 100),
      total: ROWS.length,
      returned: Math.min(100, ROWS.length - request.offset),
      offset: request.offset,
      limit: 100,
      ...(request.offset + 100 < ROWS.length ? { nextOffset: request.offset + 100 } : {}),
    }
    return { ok: true as const, value: page }
  })
  const { result } = setupLibraryFeed({ browse })
  await waitFor(() => expect(result.current.flatTree).toHaveLength(100))
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() => expect(result.current.flatTree).toHaveLength(200))
  act(() => result.current.loadMoreTree(undefined))
  await waitFor(() => expect(result.current.flatTree).toHaveLength(ROWS.length))
  // Re-rendering the settled tree must not re-parse identities.
  const afterLoad = calls
  act(() => {
    result.current.loadMoreTree(undefined)
  })
  expect(calls).toBe(afterLoad)
  expect(calls).toBeLessThanOrEqual(ROWS.length + 10)
})
