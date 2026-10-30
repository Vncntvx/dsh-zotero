/**
 * The library-feed specs' shared mount: a scripted wire face that answers the
 * library listing, saved searches, collection lanes, search, one item detail,
 * and empty child pages, rendered through `useLibraryFeed`.
 * @module tests/client/helpers/library-feed-harness
 */

import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { useLibraryFeed } from '../../../src/client/components/library/useLibraryFeed.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import type {
  ZoteroChildPageView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryChildPageRequestView,
} from '../../../src/contract.ts'
import {
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  searchPage,
} from './library-panel-harness.tsx'

/**
 * Mount the feed against the scripted face.
 * @param overrides - per-spec wire replacements.
 * @param serverId - the confirmed Zotero instance the feed hydrates for.
 * @returns the hook result, the face, and the render handles.
 */
export function setupLibraryFeed(overrides: Partial<LibraryFeedFace> = {}, serverId = 'S1') {
  const face = {
    collectionPath: vi.fn<LibraryFeedFace['collectionPath']>(async (request) => ({
      ok: true,
      value: { ...request, path: [] },
    })),
    browse: vi.fn(async (request: ZoteroLibraryBrowseRequestView) => ({
      ok: true as const,
      value:
        request.kind === 'libraries'
          ? LIBRARY_ROWS
          : request.kind === 'savedSearches'
            ? SAVED_SEARCHES
            : ROOT_COLLECTIONS,
    })),
    search: vi.fn(async () => ({ ok: true as const, value: searchPage() })),
    item: vi.fn(async () => ({ ok: true as const, value: ITEM_DETAIL })),
    childPage: vi.fn(
      async (
        request: ZoteroLibraryChildPageRequestView,
      ): Promise<RemoteResult<ZoteroChildPageView>> => ({
        ok: true,
        value: {
          kind: request.kind,
          page: {
            total: 0,
            returned: 0,
            offset: request.offset,
            limit: request.limit,
            items: [],
          },
        },
      }),
    ),
    ...overrides,
  }
  const hook = renderHook(({ id }) => useLibraryFeed(face, id, true, 'session-1'), {
    initialProps: { id: serverId },
  })
  return { ...hook, face }
}
