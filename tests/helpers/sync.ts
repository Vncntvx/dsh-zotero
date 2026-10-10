/**
 * Test-owned synchronization points: a promise a spec creates and the code
 * under test settles, instead of a duration the spec guessed. A sleep only
 * approximates "the walk has two requests in flight" or "the queue is still
 * blocked"; on a loaded machine it approximates a different point entirely.
 * @module tests/helpers/sync
 */

/** A promise together with its resolvers; the pre-ES2024 shape of `Promise.withResolvers`. */
export interface Deferred<T> {
  readonly promise: Promise<T>
  /** Settle the promise successfully; a `void` deferred is resolved with no argument. */
  resolve(value: T): void
  reject(reason: unknown): void
}

/**
 * Create a deferred. The repository's `lib` is ES2022, which does not declare
 * `Promise.withResolvers`; this is that same pair of handles, built from the
 * constructor every target declares.
 * @returns the promise plus the resolvers that settle it.
 */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolved, rejected) => {
    resolve = resolved
    reject = rejected
  })
  return { promise, resolve, reject }
}

/** One test-owned synchronization point for code that reports its own progress. */
export interface Progress {
  /** Report that the observed state may have changed. */
  notify(): void
  /**
   * Resolve as soon as `state()` holds, re-checking it on every notification.
   * @param state - the state to wait for, read from what the code under test
   *   has done so far; a plain read, never a mutation.
   */
  when(state: () => boolean): Promise<void>
}

/**
 * Create a synchronization point around a state the spec describes. The code
 * under test (or the scripted server driving it) calls {@link Progress.notify}
 * whenever that state may have changed; the spec awaits {@link Progress.when}
 * with the state it wants to have reached. `when` reads the state before it
 * waits, so a notification that already happened is never lost, and the wait
 * is a promise the spec created, nothing about it depends on how long the
 * code under test takes.
 * @returns the notify/when pair.
 */
export function progress(): Progress {
  let next = deferred<void>()
  return {
    notify: () => {
      const waiter = next
      next = deferred<void>()
      waiter.resolve()
    },
    when: async (state) => {
      while (!state()) await next.promise
    },
  }
}
