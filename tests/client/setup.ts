/**
 * Test double for the platform snapshot store.
 *
 * The published `@deepseek-ai/dsh-client-runtime/client` is a loader-handoff
 * bundle that resolves `window.__ModuleLoader__` at module load, which plain
 * vitest environments do not provide. The card only uses the store's
 * `getSnapshot`/`subscribe`/`set` surface, so tests drive the card against a
 * shape-compatible stand-in; the real store runs in the harness browser, and
 * `scripts/build-client.mjs` proves the client bundle resolves its externals.
 * @module tests/client/setup
 */

import { vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => {
  /** The store surface the card reads: snapshot plus subscription and a setter. */
  function createSnapshotStore<T>(initial: T): {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
    set(next: T): void
  } {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      set: (next) => {
        value = next
        for (const listener of listeners) listener()
      },
    }
  }
  return { createSnapshotStore }
})
