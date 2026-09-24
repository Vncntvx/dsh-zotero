/**
 * Bounded-concurrency task pooling shared by the graph walk and export, plus
 * the process-wide request gate the HTTP client holds every data request in.
 * @module dsh-zotero/concurrency
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { TOOL_ABORTED_MESSAGE } from './errors.js'

/**
 * Map `items` through `worker` with at most `concurrency` calls in flight,
 * preserving the input order in the results. A worker rejection propagates
 * immediately and stops the pool from starting further items; workers
 * already in flight keep running to completion.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(
      `mapWithConcurrency requires a positive integer concurrency, got ${concurrency}`,
    )
  }
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const run = async (): Promise<void> => {
    for (;;) {
      if (failed) return
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

/** Thrown when a queued holder is aborted before it ever takes its slot. */
export class GateAbortedError extends Error {
  constructor() {
    super('aborted while waiting for a slot')
    this.name = 'GateAbortedError'
  }
}

interface GateWaiter {
  readonly take: () => void
  readonly giveUp: (error: unknown) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
}

/**
 * A counted gate: at most `limit` holders at a time, everyone else queues in
 * arrival order.
 *
 * Each pool bounds its own fan-out, but pools multiply — several concurrent
 * tool calls each start one — so the client that every request flows through
 * holds one gate as well, and the load on Zotero is bounded by that number
 * rather than by how many calls happen to run at once.
 *
 * The queue is abortable in both directions: a holder whose signal is already
 * aborted never takes a slot, and a queued one leaves the queue on abort
 * without consuming a slot nobody is going to use. An aborted waiter rejects
 * with {@link GateAbortedError}; the caller translates that into its own
 * cancellation error, because only the caller knows what "aborted" means for
 * its layer.
 */
export class ConcurrencyGate {
  private active = 0
  private readonly waiting: GateWaiter[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`ConcurrencyGate requires a positive integer limit, got ${limit}`)
    }
  }

  /**
   * Take a slot.
   * @param signal - the caller's cancellation; aborting it while queued
   *   rejects instead of waiting for a slot.
   * @returns the release function; calling it more than once is a no-op, so
   *   a `finally` release cannot hand out a second slot.
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new GateAbortedError()
    if (this.active < this.limit) {
      this.active += 1
      return this.releaseOf()
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: GateWaiter = {
        take: () => {
          this.detach(waiter)
          resolve(this.releaseOf())
        },
        giveUp: (error) => {
          this.detach(waiter)
          reject(error)
        },
        signal,
        onAbort:
          signal === undefined
            ? undefined
            : () => {
                waiter.giveUp(new GateAbortedError())
              },
      }
      this.waiting.push(waiter)
      if (waiter.onAbort !== undefined) {
        waiter.signal?.addEventListener('abort', waiter.onAbort, { once: true })
        // The signal may have aborted between the check above and this
        // listener, and an aborted signal never replays its event — a waiter
        // left queued that way would wait for a slot it no longer wants.
        if (waiter.signal?.aborted === true) waiter.giveUp(new GateAbortedError())
      }
    })
  }

  /** Stop listening for a waiter's abort; safe to call for a waiter that never listened. */
  private detach(waiter: GateWaiter): void {
    const index = this.waiting.indexOf(waiter)
    if (index >= 0) this.waiting.splice(index, 1)
    if (waiter.onAbort !== undefined) waiter.signal?.removeEventListener('abort', waiter.onAbort)
  }

  /** The idempotent release handed to one holder. */
  private releaseOf(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const next = this.waiting.shift()
      if (next === undefined) return
      this.active += 1
      next.take()
    }
  }
}

/**
 * Take one gate slot, translating a queued abort into the same cancellation
 * error a request aborted mid-flight produces — the caller cancelled, and
 * how far the request had got is not part of the contract. `acquire` rejects
 * in exactly one case (a queued holder whose signal was aborted), so the
 * rejection is reported as that cancellation and carried along as its cause:
 * a gate that ever failed for another reason stays visible there rather than
 * being silently reclassified.
 * @param gate - the gate to take the slot from.
 * @param signal - the caller's cancellation.
 * @returns the release function.
 */
export async function acquireSlot(
  gate: ConcurrencyGate,
  signal: AbortSignal | undefined,
): Promise<() => void> {
  try {
    return await gate.acquire(signal)
  } catch (error) {
    throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED, { cause: error })
  }
}
