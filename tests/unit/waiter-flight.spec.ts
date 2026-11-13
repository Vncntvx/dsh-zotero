/**
 * The shared waiter wiring: one caller's cancellation leaves the shared
 * promise alone, a settlement runs the bookkeeping once, and a caller without
 * a signal waits uncancellably.
 * @module tests/unit/waiter-flight
 */

import { describe, expect, it } from 'vitest'
import { awaitSharedWaiter } from '../../src/waiter-flight.ts'
import { deferred } from '../helpers/sync.ts'

describe('awaitSharedWaiter', () => {
  it('resolves with the shared value and runs the leave hook once on settlement', async () => {
    const done = deferred<number>()
    let joins = 0
    let leaves: boolean[] = []
    const waiting = awaitSharedWaiter(done.promise, new AbortController().signal, {
      onJoin: () => {
        joins += 1
      },
      onLeave: (aborted) => leaves.push(aborted),
    })
    done.resolve(7)
    await expect(waiting).resolves.toBe(7)
    expect(joins).toBe(1)
    expect(leaves).toEqual([false])
  })

  it('rejects with the caller reason and reports the abort to its hooks', async () => {
    const done = deferred<number>()
    const controller = new AbortController()
    const leaves: boolean[] = []
    const waiting = awaitSharedWaiter(done.promise, controller.signal, {
      onLeave: (aborted) => leaves.push(aborted),
    })
    controller.abort(new Error('caller left'))
    await expect(waiting).rejects.toThrow('caller left')
    expect(leaves).toEqual([true])
  })

  it('handles an already-aborted signal with a paired join and leave', async () => {
    const done = deferred<number>()
    const controller = new AbortController()
    controller.abort(new Error('gone'))
    let joins = 0
    const leaves: boolean[] = []
    await expect(
      awaitSharedWaiter(done.promise, controller.signal, {
        onJoin: () => {
          joins += 1
        },
        onLeave: (aborted) => leaves.push(aborted),
      }),
    ).rejects.toThrow('gone')
    expect(joins).toBe(1)
    expect(leaves).toEqual([true])
  })

  it('waits uncancellably without a signal', async () => {
    const done = deferred<number>()
    let joins = 0
    const waiting = awaitSharedWaiter(done.promise, undefined, {
      onJoin: () => {
        joins += 1
      },
    })
    done.resolve(3)
    await expect(waiting).resolves.toBe(3)
    expect(joins).toBe(0)
  })
})
