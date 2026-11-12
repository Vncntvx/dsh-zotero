/**
 * Shared client-lane test setup.
 *
 * The harness seam the card consumes (`@deepseek-ai/dsh-client-store`) is a
 * shell-shared platform module (harness `platform.ts` + `seed.ts`), so the
 * suite drives the card against the real snapshot store; no module mock is
 * needed. What remains here is the jsdom gaps: the environment stubs below
 * stand in for layout primitives jsdom does not implement. The library view
 * cache needs no reset — it is created per registration, and a spec that wants
 * one creates its own store. `scripts/build-client.mjs` still proves the client
 * bundle resolves its loader externals.
 * @module tests/client/setup
 */

import { beforeEach, vi } from 'vitest'

/**
 * jsdom has no clipboard at all. The real `writeClipboard` primitive prefers
 * `navigator.clipboard.writeText` and only falls back to `execCommand` (which
 * jsdom also omits), so the platform seam is what a spec stubs — not the
 * primitive.
 */
export const clipboardWrites = vi.fn(async (_text: string): Promise<void> => {})
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: (text: string) => clipboardWrites(text) },
})

beforeEach(() => {
  clipboardWrites.mockClear()
  clipboardWrites.mockImplementation(async () => {})
})

/**
 * jsdom has no layout and therefore no ResizeObserver; the filter bar's
 * overflow probe degrades gracefully without it, but a minimal stub lets the
 * suite exercise the observer branch. It fires the callback on observe (so
 * the probe re-reads the metrics, which stay equal in jsdom), and records
 * nothing: the observers never disconnect in practice.
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
 * globals: the node-lane specs skip the shim entirely.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollBy !== 'function') {
  Element.prototype.scrollBy = function scrollBy(this: Element, options: ScrollToOptions): void {
    this.scrollLeft += options.left ?? 0
    this.dispatchEvent(new Event('scroll'))
  } as unknown as typeof Element.prototype.scrollBy
}
