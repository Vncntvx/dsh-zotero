/** Whole-operation serialization includes read baselines, queueing and prompt waits. */
import { afterEach, expect, it, vi } from 'vitest'
import { ConcurrencyGate } from '../../src/concurrency.js'
import { runWriteOperation, WRITE_OPERATION_DEADLINE_MS } from '../../src/write-operation.js'
import { ZoteroWriteCommitUnknownError, ZOTERO_TIMEOUT } from '../../src/errors.js'
import { deferred } from '../helpers/sync.js'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'

afterEach(() => {
  vi.useRealTimers()
})

it('holds the operation gate across all reads and writes', async () => {
  const gate = new ConcurrencyGate(1)
  const entered = deferred()
  const finish = deferred()
  const order: string[] = []
  const first = runWriteOperation(gate, new AbortController().signal, async () => {
    order.push('read')
    entered.resolve()
    await finish.promise
    order.push('write')
  })
  await entered.promise
  const second = runWriteOperation(gate, new AbortController().signal, async () => {
    order.push('next-read')
  })
  expect(order).toEqual(['read'])
  finish.resolve()
  await Promise.all([first, second])
  expect(order).toEqual(['read', 'write', 'next-read'])
})

it('expires a queued operation without entering its provider or authorizer', async () => {
  vi.useFakeTimers()
  const gate = new ConcurrencyGate(1)
  const release = await gate.acquire()
  const provider = vi.fn(async () => 'unexpected')
  const pending = runWriteOperation(gate, new AbortController().signal, provider)
  const outcome = expect(pending).rejects.toMatchObject({
    code: ZOTERO_TIMEOUT,
    message: expect.stringContaining('15-minute'),
  })
  await vi.advanceTimersByTimeAsync(WRITE_OPERATION_DEADLINE_MS)
  await outcome
  release()
  expect(provider).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('retains commit-unknown when the whole-operation deadline aborts a dispatched write', async () => {
  vi.useFakeTimers()
  const entered = deferred()
  const unknown = new ZoteroWriteCommitUnknownError(
    'Reconcile the dispatched item.',
    ZOTERO_TIMEOUT,
  )
  const pending = runWriteOperation(
    new ConcurrencyGate(1),
    new AbortController().signal,
    async (signal) => {
      entered.resolve()
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(unknown), { once: true })
      })
    },
  )
  const outcome = expect(pending).rejects.toBe(unknown)
  await entered.promise
  await vi.advanceTimersByTimeAsync(WRITE_OPERATION_DEADLINE_MS)
  await outcome
  expect(vi.getTimerCount()).toBe(0)
})

it('removes a cancelled queued operation and still admits a later write', async () => {
  const gate = new ConcurrencyGate(1)
  const release = await gate.acquire()
  const cancelled = new AbortController()
  const pending = runWriteOperation(gate, cancelled.signal, async () => 'unexpected')
  cancelled.abort()
  await expect(pending).rejects.toMatchObject({ code: TOOL_ABORTED })
  release()
  await expect(
    runWriteOperation(gate, new AbortController().signal, async () => 'saved'),
  ).resolves.toBe('saved')
})
