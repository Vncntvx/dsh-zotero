/**
 * Recording fake for the harness `contextMenus` service. The composition fake
 * (`apply-world.ts`) and the focused menu specs share one registration ledger,
 * one toast ledger, and one disposal count.
 * @module tests/client/helpers/fake-context-menus
 */

/** One contribution as the fake received it. */
export interface FakeContextMenuRegistration {
  readonly id: string
  readonly target: string
  readonly order: number
  readonly resolve: (target: any, signal: AbortSignal) => any
}

/** The state the fake writes into; the spec owns the arrays. */
export interface FakeContextMenuSink {
  readonly contextMenuRegistrations: FakeContextMenuRegistration[]
  readonly notifications: Array<{ text: string; success: boolean }>
  contextMenuDisposes: number
}

/**
 * Build the service shape the plugin consumes.
 * @param sink - the recording state owned by the spec/fake world.
 * @returns a `contextMenus` service stub.
 */
export function createFakeContextMenus(sink: FakeContextMenuSink) {
  return {
    register: (registration: FakeContextMenuRegistration) => {
      sink.contextMenuRegistrations.push(registration)
      return () => {
        const index = sink.contextMenuRegistrations.indexOf(registration)
        if (index !== -1) sink.contextMenuRegistrations.splice(index, 1)
        sink.contextMenuDisposes += 1
      }
    },
    notify: (text: string, success = false) => {
      sink.notifications.push({ text, success })
    },
    active: { get: () => null, subscribe: () => () => {} },
    open: () => {},
    resolve: () => ({
      source: { get: () => [] },
      ready: Promise.resolve(),
      select: () => {},
      dispose: () => {},
    }),
    close: () => {},
  }
}
