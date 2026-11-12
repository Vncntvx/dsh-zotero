/** Accepted settings source; draft form models never feed runtime behaviour. */
import { createContext, useContext, useSyncExternalStore, useLayoutEffect, useRef } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  LIBRARY_DEFAULTS,
  libraryPreferencesOf,
  type LibraryPreferences,
} from '../library-preferences.ts'
import type { LibraryViewMemory } from './components/library/library-view-store.ts'

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
export const LibraryPreferencesContext = createContext<
  LibraryPreferenceSnapshot & { memory?: LibraryViewMemory }
>(DEFAULT_SNAPSHOT)
export const useLibraryPreferences = () => useContext(LibraryPreferencesContext)

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
