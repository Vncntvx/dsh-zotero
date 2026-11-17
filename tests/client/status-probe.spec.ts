/** A stalled shared status request releases its single-flight slot and aborts its transport. */
import { afterEach, expect, it, vi } from 'vitest'
import { createStatusProbe } from '../../src/client/status-probe.ts'
import { deferred } from '../helpers/sync.ts'
import type { ZoteroStatusView } from '../../src/contract.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

afterEach(() => vi.useRealTimers())

it('clears the deadline after a successful status read and permits the next probe', async () => {
  vi.useFakeTimers()
  const result = { ok: true as const, value: { connected: true } as ZoteroStatusView }
  const read = vi.fn(async () => result)
  const source = createStatusProbe(read, 100)
  expect(await source.probe()).toBe(result)
  expect(vi.getTimerCount()).toBe(0)
  expect(await source.probe()).toBe(result)
  expect(read).toHaveBeenCalledTimes(2)
  source.dispose()
})

it('reports synchronous transport failure without retaining its timer or in-flight slot', async () => {
  vi.useFakeTimers()
  const source = createStatusProbe(() => {
    throw new Error('remote disconnected')
  }, 100)
  await expect(source.probe()).rejects.toThrow('remote disconnected')
  expect(vi.getTimerCount()).toBe(0)
  source.dispose()
})

it('times out even an uncooperative transport and allows an independent retry', async () => {
  vi.useFakeTimers()
  const pending = deferred<RemoteResult<ZoteroStatusView>>()
  const read = vi.fn(() => pending.promise)
  const source = createStatusProbe(read, 100)
  const first = source.probe()
  expect(source.probe()).toBe(first)
  const failure = expect(first).rejects.toThrow('timed out after 100ms')
  await vi.advanceTimersByTimeAsync(100)
  await failure
  const second = source.probe()
  expect(second).not.toBe(first)
  expect(read).toHaveBeenCalledTimes(2)
  source.dispose()
  await expect(second).rejects.toThrow('stopped')
  await expect(source.probe()).rejects.toThrow('stopped')
})

it('passes cancellation to the transport and clears an early-settlement timer', async () => {
  vi.useFakeTimers()
  const pending = deferred<RemoteResult<ZoteroStatusView>>()
  let signal: AbortSignal | undefined
  const source = createStatusProbe((next) => {
    signal = next
    return pending.promise
  }, 100)
  const task = source.probe()
  expect(signal?.aborted).toBe(false)
  source.dispose()
  await expect(task).rejects.toThrow('stopped')
  expect(signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
