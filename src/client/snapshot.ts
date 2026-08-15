/**
 * Minimal observable value for the card: a stable snapshot plus change
 * subscription, matching the renderer's bare-source contract for the hooks
 * compartment (`getSnapshot` + `subscribe` pair). The bundle cannot import
 * the runtime package's store engine without dragging the harness's browser
 * artifact into node tests, so the card carries its own 20-line stand-in.
 * @module dsh-zotero/client/snapshot
 */

/** One bare observable source, as the renderer's `use<Name>` binding expects. */
export interface SnapshotSource<T> {
  /** @returns the current snapshot (stable reference until the next change). */
  getSnapshot(): T
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each replacement.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Create a snapshot source with a write path.
 * @param initial - the first snapshot.
 * @returns the source plus its setter.
 */
export function createSnapshot<T>(initial: T): SnapshotSource<T> & { set(next: T): void } {
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
