/**
 * One shared read awaited under a caller's own cancellation.
 *
 * The data plane and the semantic vector cache both share one wire/encoder
 * promise among callers; each caller may leave without cancelling the work
 * another caller still waits for. This module owns the join/abort wiring once:
 * the caller supplies its waiter bookkeeping, and the shared promise is
 * observed so an abandoned flight is never an unhandled rejection.
 * @module dsh-zotero/waiter-flight
 */

/** The caller's bookkeeping hooks around one shared promise. */
export interface WaiterHooks {
  /** A caller is about to wait. */
  readonly onJoin?: () => void
  /** The caller left: `aborted` distinguishes its own cancellation from settlement. */
  readonly onLeave?: (aborted: boolean) => void
}

/**
 * Await one shared promise under a caller's signal.
 * @param done - the shared promise.
 * @param signal - the caller's cancellation; absent means an uncancellable caller.
 * @param hooks - the caller's waiter bookkeeping.
 * @returns the shared value, or a rejection with the caller's abort reason.
 */
export async function awaitSharedWaiter<T>(
  done: Promise<T>,
  signal: AbortSignal | undefined,
  hooks: WaiterHooks = {},
): Promise<T> {
  if (signal === undefined) return await done
  hooks.onJoin?.()
  let left = false
  const leave = (aborted: boolean): void => {
    if (left) return
    left = true
    hooks.onLeave?.(aborted)
  }
  if (signal.aborted) {
    leave(true)
    throw signal.reason
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      leave(true)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    done.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        leave(false)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        leave(false)
        reject(error)
      },
    )
  })
}
