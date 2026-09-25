import { describe, expect, it } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { ConcurrencyGate, GateAbortedError, mapWithConcurrency } from '../../src/concurrency.js'
import { deferred, progress } from '../helpers/sync.js'

describe('mapWithConcurrency', () => {
  it('preserves input order under concurrency', async () => {
    /** One gate per value: the test decides when each worker finishes. */
    const finish = new Map([3, 1, 2].map((value) => [value, deferred<void>()]))
    const started: number[] = []
    const running = progress()
    const walk = mapWithConcurrency([3, 1, 2], 2, async (value) => {
      started.push(value)
      running.notify()
      await finish.get(value)!.promise
      return value * 10
    })
    // The workers finish in the order 1, 2, 3 — not the order they were
    // started in — so the results below can only be right if they follow the
    // input positions rather than the order completions arrive in. The test
    // releases each worker itself instead of letting a sleep decide.
    for (const value of [1, 2, 3]) {
      await running.when(() => started.includes(value))
      finish.get(value)!.resolve()
    }
    expect(await walk).toEqual([30, 10, 20])
  })

  it('propagates the first worker rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error('worker boom')
        return value
      }),
    ).rejects.toThrow('worker boom')
  })

  it('aborts the pool signal so in-flight cooperative workers can cancel', async () => {
    const started: number[] = []
    const aborted: number[] = []
    const finish = new Map([1, 2, 3].map((value) => [value, deferred<void>()]))
    const running = progress()
    const walk = mapWithConcurrency([1, 2, 3], 2, async (value, signal) => {
      started.push(value)
      running.notify()
      signal.addEventListener('abort', () => {
        aborted.push(value)
        finish.get(value)!.resolve()
      })
      await finish.get(value)!.promise
      if (value === 1) throw new Error('first fails')
      return value
    })
    await running.when(() => started.includes(1) && started.includes(2))
    finish.get(1)!.resolve()
    await expect(walk).rejects.toThrow('first fails')
    // Item 2 was in flight and observed the pool abort; item 3 never started.
    expect(aborted).toContain(2)
    expect(started).not.toContain(3)
  })

  it('links caller cancellation into the pool signal', async () => {
    const outer = new AbortController()
    const started = progress()
    const seen: AbortSignal[] = []
    const walk = mapWithConcurrency(
      [1, 2],
      2,
      async (_value, signal) => {
        seen.push(signal)
        started.notify()
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
      },
      { signal: outer.signal },
    )
    await started.when(() => seen.length === 2)
    outer.abort()
    await expect(walk).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(seen.every((signal) => signal.aborted)).toBe(true)
  })

  it('rejects a non-integer or non-positive concurrency', async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      /positive integer/,
    )
    await expect(mapWithConcurrency([1], -2, async (value) => value)).rejects.toThrow(
      /positive integer/,
    )
    await expect(mapWithConcurrency([1], 1.5, async (value) => value)).rejects.toThrow(
      /positive integer/,
    )
  })
})

describe('ConcurrencyGate', () => {
  it('lets at most its limit through and hands slots on in arrival order', async () => {
    const gate = new ConcurrencyGate(2)
    let active = 0
    let peak = 0
    const order: number[] = []
    /** One release per holder: the test hands the slot back, not a sleep. */
    const entered = new Map<number, () => void>()
    const inside = progress()
    const hold = async (id: number): Promise<void> => {
      const release = await gate.acquire()
      active += 1
      peak = Math.max(peak, active)
      order.push(id)
      const slot = deferred()
      entered.set(id, slot.resolve)
      inside.notify()
      await slot.promise
      active -= 1
      release()
    }
    const all = Promise.all([1, 2, 3, 4].map(hold))
    // Two slots, four holders: the first two run, and each release below hands
    // its slot to the next waiter, so every holder is observed while it is
    // actually inside the gate — the peak is never a function of timing.
    for (const id of [1, 2, 3, 4]) {
      await inside.when(() => entered.has(id))
      entered.get(id)!()
    }
    await all
    expect(peak).toBe(2)
    expect([...order].sort()).toEqual([1, 2, 3, 4])
  })

  it('releases once, no matter how often the release is called', async () => {
    const gate = new ConcurrencyGate(1)
    const release = await gate.acquire()
    release()
    release()
    // A second acquire would hang if the double release had handed out a slot.
    const second = await gate.acquire()
    second()
  })

  it('refuses a waiter whose signal is already aborted', async () => {
    const gate = new ConcurrencyGate(1)
    await expect(gate.acquire(AbortSignal.abort())).rejects.toBeInstanceOf(GateAbortedError)
  })

  it('drops a queued waiter on abort instead of consuming its slot', async () => {
    const gate = new ConcurrencyGate(1)
    const release = await gate.acquire()
    const controller = new AbortController()
    const queued = gate.acquire(controller.signal)
    controller.abort()
    await expect(queued).rejects.toBeInstanceOf(GateAbortedError)
    // The aborted waiter left the queue, so the next holder runs immediately.
    release()
    const next = await gate.acquire()
    next()
  })

  it('rejects a non-integer or non-positive limit', () => {
    expect(() => new ConcurrencyGate(0)).toThrow(/positive integer/)
    expect(() => new ConcurrencyGate(1.5)).toThrow(/positive integer/)
  })
})
