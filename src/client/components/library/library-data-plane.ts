/**
 * The library panel's shared data plane: one deduplicating, short-TTL face
 * over the wire reads. Identical in-flight requests collapse into one, and a
 * settled read answers an identical request within its TTL window. The cache
 * is pinned to one Zotero instance: `setInstance` re-keys the cache when the
 * confirmed `serverId` changes, so a restart can never answer from the
 * previous instance. `invalidate()` drops the cache and bumps the key
 * generation; the feed calls it on every refresh and after a write.
 *
 * Callers may abandon a read. Interest in one shared in-flight request is
 * reference-counted, and the wire call is aborted only when its last waiter
 * leaves: one surface's cleanup never cancels a request another surface is
 * still waiting for, and an abandoned read frees the host instead of running
 * to completion for an answer nobody reads.
 *
 * Only successful reads are cached; a failed or aborted read is not, so a retry
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
import { awaitSharedWaiter } from '../../../waiter-flight.ts'

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

/** One in-flight wire read, shared by every caller asking for the same thing. */
interface Flight {
  /** Aborts the wire call when the last interested caller leaves. */
  readonly controller: AbortController
  /** Cancellable callers still waiting for the answer. */
  cancelWaiters: number
  /**
   * Whether a caller that cannot be cancelled waits for it. Such a caller holds
   * the flight until the wire answers, so it also blocks the abort.
   */
  pinned: boolean
  /** Whether the wire call settled; a settled flight never aborts. */
  readonly isSettled: () => boolean
  readonly promise: Promise<RemoteResult<unknown>>
}

/**
 * Wait for one shared flight, giving up when the caller's own signal aborts.
 *
 * Interest is reference-counted: a caller that goes away stops waiting, and
 * the wire call aborts only when nobody is left to use its answer. The last
 * waiter rejects with its own abort reason; the shared rejection is kept
 * observed so it is never reported as an unhandled rejection.
 * @param flight - the shared wire read.
 * @param signal - the caller's cancellation, when it has one.
 * @param abandon - called once the flight is aborted, so a later read starts a
 *   fresh wire call instead of joining the abandoned one.
 * @returns the shared result, or a rejection with the caller's abort reason.
 */
function joinFlight<R>(
  flight: Flight,
  signal: AbortSignal | undefined,
  abandon: () => void,
): Promise<RemoteResult<R>> {
  if (signal === undefined) {
    // A caller that cannot be cancelled pins the flight and gets the shared
    // promise itself, so two such callers observe one promise.
    flight.pinned = true
    return flight.promise as Promise<RemoteResult<R>>
  }
  return awaitSharedWaiter(flight.promise as Promise<RemoteResult<R>>, signal, {
    onJoin: () => {
      flight.cancelWaiters += 1
    },
    onLeave: (aborted) => {
      flight.cancelWaiters -= 1
      if (!aborted || flight.isSettled() || flight.pinned || flight.cancelWaiters > 0) return
      abandon()
      flight.controller.abort()
      void flight.promise.catch(() => undefined)
    },
  })
}

export interface LibraryDataPlane extends LibraryPanelWireFace {
  /** Drop every cached read; later requests re-fetch. */
  invalidate: () => void
  /** Re-key the cache to one Zotero instance; a change clears it. */
  setInstance: (serverId: string | undefined) => void
}

export function createLibraryDataPlane(face: LibraryPanelWireFace): LibraryDataPlane {
  let generation = 0
  let instance: string | undefined
  const inflight = new Map<string, Flight>()
  const settled = new Map<string, { at: number; ttlMs: number; result: RemoteResult<unknown> }>()

  const pruneExpired = (now: number): void => {
    for (const [key, entry] of settled) {
      if (now - entry.at >= entry.ttlMs) settled.delete(key)
    }
  }

  const call = <R>(
    method: PlaneMethod,
    request: unknown,
    signal: AbortSignal | undefined,
    send: (wire: AbortSignal | undefined) => Promise<RemoteResult<R>>,
  ): Promise<RemoteResult<R>> => {
    if (signal?.aborted === true) return Promise.reject(signal.reason)
    const requestGeneration = generation
    const key = `${instance ?? ''}:${requestGeneration}:${method}:${JSON.stringify(request)}`
    const now = Date.now()
    pruneExpired(now)
    const cached = settled.get(key)
    if (cached !== undefined && now - cached.at < cached.ttlMs) {
      return Promise.resolve(cached.result) as Promise<RemoteResult<R>>
    }
    let flight = inflight.get(key)
    if (flight === undefined) {
      const controller = new AbortController()
      // The wire call carries a signal only when the caller that started this
      // flight had one: a flight nobody can cancel must not pretend otherwise,
      // and a read created without one keeps the one-argument call shape.
      const wire = signal === undefined ? undefined : controller.signal
      let done = false
      const promise = send(wire).then(
        (result) => {
          done = true
          if (inflight.get(key) === created) inflight.delete(key)
          // An abandoned read (every caller left) is never cached: its answer
          // belongs to nobody, and a later read must re-request.
          if (
            result.ok &&
            requestGeneration === generation &&
            TTL_MS[method] > 0 &&
            !controller.signal.aborted
          ) {
            const at = Date.now()
            pruneExpired(at)
            settled.set(key, { at, ttlMs: TTL_MS[method], result })
            while (settled.size > MAX_SETTLED_ENTRIES) {
              const oldest = settled.keys().next().value
              if (oldest === undefined) break
              settled.delete(oldest)
            }
          }
          return result as RemoteResult<unknown>
        },
        (cause: unknown) => {
          done = true
          if (inflight.get(key) === created) inflight.delete(key)
          throw cause
        },
      )
      const created: Flight = {
        controller,
        cancelWaiters: 0,
        pinned: false,
        isSettled: () => done,
        promise,
      }
      inflight.set(key, created)
      flight = created
    }
    return joinFlight(flight, signal, () => {
      if (inflight.get(key) === flight) inflight.delete(key)
    })
  }

  return {
    collectionPath: (request, signal) =>
      call('collectionPath', request, signal, (wire) =>
        wire === undefined ? face.collectionPath(request) : face.collectionPath(request, wire),
      ),
    browse: (request: ZoteroLibraryBrowseRequestView, signal?: AbortSignal) =>
      call('browse', request, signal, (wire) =>
        wire === undefined ? face.browse(request) : face.browse(request, wire),
      ),
    search: (request: ZoteroLibrarySearchRequestView, signal?: AbortSignal) => {
      const query = { ...request, cacheGeneration: generation }
      return call('search', query, signal, (wire) =>
        wire === undefined ? face.search(query) : face.search(query, wire),
      )
    },
    item: (request: ZoteroLibraryItemRequestView, signal?: AbortSignal) =>
      call('item', request, signal, (wire) =>
        wire === undefined ? face.item(request) : face.item(request, wire),
      ),
    childPage: (request: ZoteroLibraryChildPageRequestView, signal?: AbortSignal) =>
      call('childPage', request, signal, (wire) =>
        wire === undefined ? face.childPage(request) : face.childPage(request, wire),
      ),
    export: (request: ZoteroLibraryExportRequestView, signal?: AbortSignal) =>
      call('export', request, signal, (wire) =>
        wire === undefined ? face.export(request) : face.export(request, wire),
      ),
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
