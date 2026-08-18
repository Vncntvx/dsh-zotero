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

/**
 * jsdom has no layout and therefore no ResizeObserver; the filter bar's
 * overflow probe degrades gracefully without it, but a minimal stub lets the
 * suite exercise the observer branch. It fires the callback on observe (so
 * the probe re-reads the metrics, which stay equal in jsdom) and records
 * nothing — the observers never disconnect in practice.
 */
class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback([], this)
    void target
  }
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

/**
 * jsdom implements no element scrolling, so the filter strip's paging arrows
 * would throw on `scrollBy`; a minimal shim honors the left option the way
 * the engine would and dispatches the scroll event that recomputes the edge
 * arrows, so clicks move the strip in tests too. Only the jsdom lane has DOM
 * globals — the node-lane specs skip the shim entirely.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollBy !== 'function') {
  Element.prototype.scrollBy = function scrollBy(this: Element, options: ScrollToOptions): void {
    this.scrollLeft += options.left ?? 0
    this.dispatchEvent(new Event('scroll'))
  } as unknown as typeof Element.prototype.scrollBy
}
