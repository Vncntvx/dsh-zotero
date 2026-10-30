/**
 * The library panel's shared data plane: one deduplicating, short-TTL face
 * over the wire reads. Identical in-flight requests collapse into one, and a
 * settled read answers an identical request within its TTL window. The cache
 * is pinned to one Zotero instance: `setInstance` re-keys the cache when the
 * confirmed `serverId` changes, so a restart can never answer from the
 * previous instance. `invalidate()` drops the cache and bumps the key
 * generation; the feed calls it on every refresh and after a write.
 *
 * Only successful reads are cached; a failed read is not, so a retry
 * re-requests. Settled entries are pruned as they expire and the map is
 * capped, so a long session cannot retain every payload. Writes do not pass
 * through here.
 * @module dsh-zotero/client/components/library/library-data-plane
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryChildPageRequestView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryItemRequestView,
  ZoteroLibrarySearchRequestView,
} from '../../../contract.ts'
import type { LibraryPanelWireFace } from './library-feed-types.ts'

/** The wire reads the plane deduplicates. */
type PlaneMethod = 'collectionPath' | 'browse' | 'search' | 'item' | 'childPage' | 'export'

/** How long a settled read may answer a later identical request. */
const TTL_MS: Record<PlaneMethod, number> = {
  browse: 30_000,
  collectionPath: 0,
  item: 10_000,
  export: 10_000,
  search: 2_000,
  childPage: 2_000,
}

/** The most settled reads the plane retains, regardless of TTL. */
const MAX_SETTLED_ENTRIES = 128

export interface LibraryDataPlane extends LibraryPanelWireFace {
  /** Drop every cached read; later requests re-fetch. */
  invalidate: () => void
  /** Re-key the cache to one Zotero instance; a change clears it. */
  setInstance: (serverId: string | undefined) => void
}

export function createLibraryDataPlane(face: LibraryPanelWireFace): LibraryDataPlane {
  let generation = 0
  let instance: string | undefined
  const inflight = new Map<string, Promise<RemoteResult<unknown>>>()
  const settled = new Map<string, { at: number; ttlMs: number; result: RemoteResult<unknown> }>()

  const pruneExpired = (now: number): void => {
    for (const [key, entry] of settled) {
      if (now - entry.at >= entry.ttlMs) settled.delete(key)
    }
  }

  const call = <R>(
    method: PlaneMethod,
    request: unknown,
    send: () => Promise<RemoteResult<R>>,
  ): Promise<RemoteResult<R>> => {
    const requestGeneration = generation
    const key = `${instance ?? ''}:${requestGeneration}:${method}:${JSON.stringify(request)}`
    const now = Date.now()
    pruneExpired(now)
    const cached = settled.get(key)
    if (cached !== undefined && now - cached.at < cached.ttlMs) {
      return Promise.resolve(cached.result) as Promise<RemoteResult<R>>
    }
    const running = inflight.get(key)
    if (running !== undefined) return running as Promise<RemoteResult<R>>
    const task = send().then(
      (result) => {
        inflight.delete(key)
        if (result.ok && requestGeneration === generation && TTL_MS[method] > 0) {
          const at = Date.now()
          pruneExpired(at)
          settled.set(key, { at, ttlMs: TTL_MS[method], result })
          while (settled.size > MAX_SETTLED_ENTRIES) {
            const oldest = settled.keys().next().value
            if (oldest === undefined) break
            settled.delete(oldest)
          }
        }
        return result
      },
      (cause: unknown) => {
        inflight.delete(key)
        throw cause
      },
    )
    inflight.set(key, task)
    return task
  }

  return {
    collectionPath: (request) =>
      call('collectionPath', request, () => face.collectionPath(request)),
    browse: (request: ZoteroLibraryBrowseRequestView) =>
      call('browse', request, () => face.browse(request)),
    search: (request: ZoteroLibrarySearchRequestView) => {
      const query = { ...request, cacheGeneration: generation }
      return call('search', query, () => face.search(query))
    },
    item: (request: ZoteroLibraryItemRequestView) =>
      call('item', request, () => face.item(request)),
    childPage: (request: ZoteroLibraryChildPageRequestView) =>
      call('childPage', request, () => face.childPage(request)),
    export: (request: ZoteroLibraryExportRequestView) =>
      call('export', request, () => face.export(request)),
    invalidate: () => {
      generation += 1
      settled.clear()
    },
    setInstance: (serverId: string | undefined) => {
      if (serverId === instance) return
      instance = serverId
      generation += 1
      settled.clear()
    },
  }
}
