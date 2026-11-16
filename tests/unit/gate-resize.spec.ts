/** Changing capacity admits existing waiters immediately and never preempts holders. */
import { expect, it } from 'vitest'
import { ConcurrencyGate } from '../../src/concurrency.js'

it('admits queued holders in order when the limit grows', async () => {
  const gate = new ConcurrencyGate(1)
  const releaseFirst = await gate.acquire()
  const order: string[] = []
  const second = gate.acquire().then((release) => {
    order.push('second')
    return release
  })
  const third = gate.acquire().then((release) => {
    order.push('third')
    return release
  })
  gate.setLimit(3)
  const releases = await Promise.all([second, third])
  expect(order).toEqual(['second', 'third'])
  releaseFirst()
  for (const release of releases) release()
})

it('drains holders after a shrink before admitting another request', async () => {
  const gate = new ConcurrencyGate(2)
  const releaseFirst = await gate.acquire()
  const releaseSecond = await gate.acquire()
  gate.setLimit(1)
  let entered = false
  const queued = gate.acquire().then((release) => {
    entered = true
    return release
  })
  releaseFirst()
  await Promise.resolve()
  expect(entered).toBe(false)
  releaseSecond()
  const release = await queued
  expect(entered).toBe(true)
  release()
  expect(() => gate.setLimit(0)).toThrow('positive integer')
})
