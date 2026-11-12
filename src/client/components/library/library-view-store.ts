/**
 * The literature panel's in-memory view cache, owned by the client registration.
 *
 * Two lifetimes meet here and neither belongs to a module:
 *
 * - **A tab occurrence.** `viewMemory` returns the state that must survive a
 *   temporarily unmounted React body — the disclosure overrides, the child
 *   pagination offsets, the scroll position — keyed by the tab's own abort
 *   signal, so closing the tab releases it.
 * - **A session and Zotero instance.** The last ready detail payload and the
 *   probe snapshot are cached once, so a remount paints before the first wire
 *   answer. Both live under `(serverId, sessionId)`: two Zotero instances must
 *   never hand each other's item payload to an inspector, and the browsing
 *   position in `localStorage` is keyed the same way.
 *
 * The cache used to be module-scoped, which made it outlive the plugin, leak
 * across test cases, and key the session view by session id alone. The client
 * registration now creates one store and disposes it with the registration.
 * @module dsh-zotero/client/components/library/library-view-store
 */

import type { ZoteroStatusView } from '../../../contract.ts'
import type { LibrarySection } from '../../../library-preferences.ts'
import type { LibraryItemState } from './library-model.ts'
import type { LibraryStoredState } from './library-storage.ts'

/** What a session keeps across a pane remount: the payload the durable record does not carry. */
export interface LibrarySessionView {
  readonly inspector?: LibraryItemState
  readonly lastProbeData?: ZoteroStatusView
}

/** How one view's scroll position is scheduled for saving. */
export type LibraryScrollScheduler = (callback: () => void, delayMs: number) => () => void

/** The delay the scroll save waits for, so a scroll gesture writes once. */
export const SCROLL_SAVE_DELAY_MS = 100

/** The default scheduler: a timer the memory can cancel. */
export const scheduleScrollSave: LibraryScrollScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}

/** One tab occurrence's retained view state. */
export interface LibraryViewMemory {
  readonly serverId: string
  readonly sessionId: string
  resetPending?: boolean
  childPages?: {
    ref: string
    offsets: Partial<Record<'attachments' | 'notes' | 'annotations', number>>
  }
  snapshot?: LibraryStoredState
  scroll: Record<string, number>
  saveScroll?: (flush?: boolean) => void
  saveScrollKey?: string
  scheduleScrollSave: () => void
  flushScrollSave: () => void
  cancelScrollSave: () => void
  disclosure?: { ref: string; overrides: Partial<Record<LibrarySection, boolean>> }
}

/** The panel's in-memory cache: one instance per client registration. */
export interface LibraryViewStore {
  /**
   * The retained state of one tab occurrence. Keyed by the tab's abort signal,
   * so closing the tab releases it.
   * @param signal - the tab occurrence's signal.
   * @param serverId - the connected instance, or `''` before the probe settled.
   * @param sessionId - the conversation the tab belongs to.
   * @param scheduler - how a scroll position schedules its save.
   * @returns the occurrence's memory, created on first use.
   */
  viewMemory(
    signal: AbortSignal,
    serverId: string,
    sessionId?: string,
    scheduler?: LibraryScrollScheduler,
  ): LibraryViewMemory
  /** Forget one instance's view state: the user asked to reset the browsing position. */
  clearView(serverId: string, sessionId: string): void
  /** Forget every instance's view state for one conversation (a deleted conversation). */
  clearConversation(sessionId: string): void
  /**
   * The cached payload for one session, or `undefined`.
   * @param serverId - the connected instance; omitted before the probe settled,
   *   which only answers when the cache is unambiguous.
   * @param sessionId - the conversation.
   * @returns the cached payload.
   */
  sessionView(serverId: string | undefined, sessionId: string): LibrarySessionView | undefined
  /** Replace one session's cached payload. A whole-object write, so clearing is explicit. */
  writeSessionView(serverId: string, sessionId: string, view: LibrarySessionView): void
  /**
   * Drop one session's payload. An omitted key clears everything; an empty
   * server id (the pre-probe spelling) clears that session on every instance,
   * which is what a panel with nothing to cache owes the previous mount.
   */
  clearSessionView(serverId?: string, sessionId?: string): void
  /** Drop everything this store holds. */
  dispose(): void
}

/** Live sessions retained per store; the oldest view is dropped past this bound. */
const MAX_SESSION_VIEW_ENTRIES = 8

/**
 * One session's key. The spelling matches `LibraryViewMemory.saveScrollKey`,
 * which the feed writes, so the abort-time flush decision compares equal.
 */
const sessionKey = (serverId: string, sessionId: string): string =>
  JSON.stringify([serverId, sessionId])

/**
 * Create the panel's in-memory cache.
 * @returns the store; the creator owns it and must call {@link LibraryViewStore.dispose}.
 */
export function createLibraryViewStore(): LibraryViewStore {
  /** One occurrence's memories, released with the tab signal. */
  const occurrences = new WeakMap<AbortSignal, Map<string, LibraryViewMemory>>()
  /** Every live memory, so a reset can reach the ones no mounted body holds. */
  const memories = new Map<string, Set<LibraryViewMemory>>()
  /** Session payloads, oldest first for eviction. */
  const sessionViews = new Map<string, LibrarySessionView>()
  let disposed = false

  const clearView = (serverId: string, sessionId: string): void => {
    for (const memory of memories.get(sessionKey(serverId, sessionId)) ?? []) {
      memory.cancelScrollSave()
      memory.snapshot = undefined
      memory.childPages = undefined
      memory.scroll = {}
      memory.disclosure = undefined
      memory.resetPending = true
    }
  }

  return {
    viewMemory(signal, serverId, sessionId = '', scheduler = scheduleScrollSave) {
      let instances = occurrences.get(signal)
      if (instances === undefined) {
        instances = new Map()
        occurrences.set(signal, instances)
      }
      const key = sessionKey(serverId, sessionId)
      const existing = instances.get(key)
      if (existing !== undefined) return existing
      let cancelScheduled: (() => void) | undefined
      const created: LibraryViewMemory = {
        serverId,
        sessionId,
        scroll: {},
        scheduleScrollSave: () => {
          cancelScheduled?.()
          cancelScheduled = scheduler(() => {
            cancelScheduled = undefined
            created.saveScroll?.(false)
          }, SCROLL_SAVE_DELAY_MS)
        },
        flushScrollSave: () => {
          if (cancelScheduled === undefined) return
          const cancel = cancelScheduled
          cancelScheduled = undefined
          cancel()
          created.saveScroll?.(true)
        },
        cancelScrollSave: () => {
          if (cancelScheduled === undefined) return
          cancelScheduled()
          cancelScheduled = undefined
        },
      }
      instances.set(key, created)
      const held = memories.get(key) ?? new Set<LibraryViewMemory>()
      held.add(created)
      memories.set(key, held)
      signal.addEventListener(
        'abort',
        () => {
          // The closing tab saves its own position once; a superseded mount
          // drops the pending write instead of trampling the newer one.
          if (created.saveScrollKey === key) created.flushScrollSave()
          else created.cancelScrollSave()
          held.delete(created)
          if (held.size === 0) memories.delete(key)
          instances?.delete(key)
        },
        { once: true },
      )
      return created
    },
    clearView,
    clearConversation(sessionId) {
      for (const key of [...memories.keys()]) {
        const [, storedSessionId] = JSON.parse(key) as [string, string]
        if (storedSessionId === sessionId) {
          const [serverId] = JSON.parse(key) as [string, string]
          clearView(serverId, sessionId)
        }
      }
    },
    sessionView(serverId, sessionId) {
      if (serverId !== undefined) return sessionViews.get(sessionKey(serverId, sessionId))
      // Before the probe settles the instance is unknown. Answer only when the
      // session has exactly one cached payload: two instances must never hand
      // each other's item to an inspector.
      const candidates = [...sessionViews].filter(([key]) => {
        const [, storedSessionId] = JSON.parse(key) as [string, string]
        return storedSessionId === sessionId
      })
      return candidates.length === 1 ? candidates[0]![1] : undefined
    },
    writeSessionView(serverId, sessionId, view) {
      if (disposed) return
      const key = sessionKey(serverId, sessionId)
      // Re-insert so the most recent session sits last: Map order is the LRU.
      sessionViews.delete(key)
      sessionViews.set(key, view)
      const overflow = Math.max(0, sessionViews.size - MAX_SESSION_VIEW_ENTRIES)
      for (const oldest of [...sessionViews.keys()].slice(0, overflow)) {
        sessionViews.delete(oldest)
      }
    },
    clearSessionView(serverId, sessionId) {
      if (serverId === undefined || sessionId === undefined) {
        sessionViews.clear()
        return
      }
      if (serverId !== '') {
        sessionViews.delete(sessionKey(serverId, sessionId))
        return
      }
      for (const key of [...sessionViews.keys()]) {
        const [, storedSessionId] = JSON.parse(key) as [string, string]
        if (storedSessionId === sessionId) sessionViews.delete(key)
      }
    },
    dispose() {
      disposed = true
      for (const held of memories.values()) {
        for (const memory of held) memory.cancelScrollSave()
      }
      memories.clear()
      sessionViews.clear()
    },
  }
}
