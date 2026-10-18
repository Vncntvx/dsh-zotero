/**
 * The slot registry's crash supervision seam, faked.
 *
 * Both wiring specs that drive `ctx.slots.onEntryError` — the intake's own spec
 * and the browser-half entry spec — need the same two things: the listener the
 * entry subscribes with, and a way to fire it. Keeping one fake here means the
 * two specs cannot drift on the seam's shape (a four-argument listener, an
 * unsubscribe that removes exactly what was added), the way they drifted on the
 * reporter wiring once before.
 * @module tests/client/helpers/slot-crash-seam
 */

/** One registered supervision listener, as the fake registry holds it. */
export type EntryErrorListener = (
  key: string,
  registration: unknown,
  error: unknown,
  info: { abdicated: boolean },
) => void

/** The handle one spec drives the seam with. */
export interface FakeEntryErrorSeam {
  /** The listeners currently subscribed, in subscription order. */
  readonly listeners: EntryErrorListener[]
  /** The `ctx.slots.onEntryError` implementation to install on a fake registry. */
  readonly onEntryError: (fn: EntryErrorListener) => () => void
  /**
   * Fire one crash at the subscribed listeners, as the renderer's
   * `reportEntryError` would. Throws when nothing subscribed, so a spec that
   * expects an intake to exist fails loudly instead of passing on a no-op.
   */
  readonly crash: (
    key: string,
    registration: unknown,
    error: unknown,
    info?: { abdicated: boolean },
  ) => void
}

/**
 * Build the fake seam.
 * @returns the listeners array, the subscription stub, and the crash driver.
 */
export function fakeEntryErrorSeam(): FakeEntryErrorSeam {
  const listeners: EntryErrorListener[] = []
  return {
    listeners,
    onEntryError: (fn: EntryErrorListener) => {
      listeners.push(fn)
      return () => {
        listeners.splice(listeners.indexOf(fn), 1)
      }
    },
    crash: (key, registration, error, info = { abdicated: false }) => {
      for (const listener of [...listeners]) listener(key, registration, error, info)
    },
  }
}
