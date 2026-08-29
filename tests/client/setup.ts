/**
 * Shared client-lane test shims.
 *
 * The harness seam the card consumes — `@deepseek-ai/dsh-client-store` — is a
 * plain library, so the suite drives the card against the real snapshot
 * store; no module mock is needed. Only the jsdom gaps remain here: the
 * environment stubs below stand in for layout primitives jsdom does not
 * implement. `scripts/build-client.mjs` still proves the client bundle
 * resolves its loader externals.
 * @module tests/client/setup
 */

import { vi } from 'vitest'

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
