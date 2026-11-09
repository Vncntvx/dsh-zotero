/** Accepted settings source; draft form models never feed runtime behaviour. */
import { createContext, useContext, useSyncExternalStore, useLayoutEffect, useRef } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  LIBRARY_DEFAULTS,
  libraryPreferencesOf,
  type LibraryPreferences,
  type LibrarySection,
} from '../library-preferences.ts'
import type { LibraryStoredState } from './components/library/library-storage.ts'

export interface LibraryPreferenceSnapshot {
  readonly preferences?: LibraryPreferences
  readonly citation?: { readonly style: string; readonly locale: string }
  readonly citationPending?: boolean
  readonly error?: string
}
export interface LibraryPreferenceSource {
  readonly getSnapshot: () => LibraryPreferenceSnapshot
  readonly subscribe: (listener: () => void) => () => void
}
export function createLibraryPreferenceSource(
  form: ConfigForm<Record<string, unknown>>,
  core: ConfigForm<Record<string, unknown>>,
): LibraryPreferenceSource & { dispose: () => void } {
  const listeners = new Set<() => void>()
  let snapshot: LibraryPreferenceSnapshot = {}
  const update = () => {
    try {
      const library = form.getSnapshot()
      const root = core.getSnapshot()
      const citation =
        root.status === 'ready' &&
        typeof root.value?.defaultStyle === 'string' &&
        typeof root.value.defaultLocale === 'string'
          ? { style: root.value.defaultStyle, locale: root.value.defaultLocale }
          : undefined
      snapshot =
        library.status === 'unavailable'
          ? { error: 'library settings namespace unavailable' }
          : {
              preferences:
                library.status === 'ready' ? libraryPreferencesOf(library.value ?? {}) : undefined,
              citation,
              citationPending: citation === undefined,
            }
    } catch (error) {
      snapshot = { error: error instanceof Error ? error.message : String(error) }
    }
    for (const listener of listeners) listener()
  }
  const disposers = [form.subscribe(update), core.subscribe(update)]
  update()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      for (const dispose of disposers) dispose()
      listeners.clear()
    },
  }
}
const EMPTY_SOURCE: LibraryPreferenceSource = {
  getSnapshot: () => DEFAULT_SNAPSHOT,
  subscribe: () => () => {},
}
const DEFAULT_SNAPSHOT: LibraryPreferenceSnapshot = { preferences: LIBRARY_DEFAULTS }
export function useLibraryPreferenceSource(
  source: LibraryPreferenceSource = EMPTY_SOURCE,
): LibraryPreferenceSnapshot {
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}
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
export type LibraryScrollScheduler = (callback: () => void, delayMs: number) => () => void

const SCROLL_SAVE_DELAY_MS = 100
const scheduleScrollSave: LibraryScrollScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}
export const LibraryPreferencesContext = createContext<
  LibraryPreferenceSnapshot & { memory?: LibraryViewMemory }
>(DEFAULT_SNAPSHOT)
export const useLibraryPreferences = () => useContext(LibraryPreferencesContext)

const memories = new Map<string, Set<LibraryViewMemory>>()
export function clearLibraryViewMemory(serverId: string, sessionId: string): void {
  for (const memory of memories.get(JSON.stringify([serverId, sessionId])) ?? []) {
    memory.cancelScrollSave()
    memory.snapshot = undefined
    memory.childPages = undefined
    memory.scroll = {}
    memory.disclosure = undefined
    memory.resetPending = true
  }
}
export function clearLibraryConversationViewMemory(sessionId: string): void {
  for (const [identity] of memories) {
    const [serverId, storedSessionId] = JSON.parse(identity) as [string, string]
    if (storedSessionId === sessionId) clearLibraryViewMemory(serverId, sessionId)
  }
}

const viewOccurrences = new WeakMap<AbortSignal, Map<string, LibraryViewMemory>>()
/** View state follows a tab occurrence, not its temporarily mounted React body. */
export function libraryViewMemory(
  signal: AbortSignal,
  serverId: string,
  sessionId = '',
  scheduler: LibraryScrollScheduler = scheduleScrollSave,
): LibraryViewMemory {
  let instances = viewOccurrences.get(signal)
  if (!instances) {
    instances = new Map()
    viewOccurrences.set(signal, instances)
    signal.addEventListener(
      'abort',
      () => {
        instances?.clear()
        viewOccurrences.delete(signal)
      },
      { once: true },
    )
  }
  const instanceKey = JSON.stringify([serverId, sessionId])
  let memory = instances.get(instanceKey)
  if (!memory) {
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
    memory = created
    instances.set(instanceKey, memory)
    const key = JSON.stringify([serverId, sessionId])
    const held = memories.get(key) ?? new Set<LibraryViewMemory>()
    held.add(memory)
    memories.set(key, held)
    const heldMemory = memory
    signal.addEventListener(
      'abort',
      () => {
        if (heldMemory.saveScrollKey === JSON.stringify([serverId, sessionId]))
          heldMemory.flushScrollSave()
        else heldMemory.cancelScrollSave()
        held.delete(heldMemory)
        if (!held.size) memories.delete(key)
      },
      { once: true },
    )
  }
  return memory
}

/** Restore only after the owning content has reached its ready layout. */
export function useLibraryScroll(key: string, ready: boolean, revision?: unknown) {
  const { memory } = useLibraryPreferences()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ready && ref.current) ref.current.scrollTop = memory?.scroll[key] ?? 0
  }, [key, ready, memory, revision])
  return {
    ref,
    onScroll: (event: React.UIEvent<HTMLElement>) => {
      if (!memory) return
      memory.scroll[key] = event.currentTarget.scrollTop
      memory.scheduleScrollSave()
    },
  }
}
