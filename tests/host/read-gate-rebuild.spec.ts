/** Accepted reads and replacement transports share one dynamically sized service gate. */
import { afterEach, expect, it, vi } from 'vitest'
import { commitLive, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { deferred } from '../helpers/sync.js'
import { paperItem } from '../helpers/server/objects.js'
import { ConcurrencyGate } from '../../src/concurrency.js'

let lane: HostLane | undefined
afterEach(async () => {
  await lane?.teardown()
  lane = undefined
  vi.restoreAllMocks()
})

it('keeps a replacement transport behind an accepted request until the shared slot is free', async () => {
  lane = await setupHostLane({ maxInFlightRequests: 1 })
  const entered = deferred()
  const queued = deferred()
  const release = deferred()
  const gates: ConcurrencyGate[] = []
  const acquire = ConcurrencyGate.prototype.acquire
  vi.spyOn(ConcurrencyGate.prototype, 'acquire').mockImplementation(function (
    this: ConcurrencyGate,
    signal,
  ) {
    gates.push(this)
    const pending = acquire.call(this, signal)
    if (gates.length === 2) queued.resolve()
    return pending
  })
  let reads = 0
  lane.mock.route('GET', '/api/users/0/items/ABCD1234', async (_req, _res, h) => {
    reads++
    if (reads === 1) {
      entered.resolve()
      await release.promise
    }
    h.json(paperItem({ key: 'ABCD1234' }), { 'Zotero-Server-ID': 'server' })
  })
  const request = {
    ref: { library: { type: 'user', id: 0 }, kind: 'item', key: 'ABCD1234' },
    include: new Set<never>(),
  } as const
  const first = lane.ctx.zotero.get(request)
  await entered.promise
  await commitLive(lane, { timeoutMs: 7000 })
  const second = lane.ctx.zotero.get(request)
  await queued.promise
  // Observe the shared gate's accepted queue through release, not a delay.
  expect(reads).toBe(1)
  expect(gates[0]).toBe(gates[1])
  release.resolve()
  await Promise.all([first, second])
  expect(reads).toBe(2)
})
