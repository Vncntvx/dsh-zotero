import { Agent } from 'undici'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import {
  createPinnedDispatcher,
  dnsAddressResolver,
  scholarlyPublicAccess,
} from '../../src/scholarly/transport/host-connections.js'

beforeEach(() => {
  lookupMock.mockReset()
})

describe('dnsAddressResolver', () => {
  it('maps every answer in resolver order, asking for all families verbatim', async () => {
    lookupMock.mockResolvedValue([
      { address: '2001:db8::1', family: 6 },
      { address: '192.0.2.10', family: 4 },
    ])
    await expect(dnsAddressResolver('example.test')).resolves.toEqual([
      { address: '2001:db8::1', family: 6 },
      { address: '192.0.2.10', family: 4 },
    ])
    expect(lookupMock).toHaveBeenCalledWith('example.test', { all: true, verbatim: true })
  })

  it('folds answer families other than 6 down to IPv4', async () => {
    lookupMock.mockResolvedValue([{ address: '192.0.2.10', family: 1 }])
    await expect(dnsAddressResolver('example.test')).resolves.toEqual([
      { address: '192.0.2.10', family: 4 },
    ])
  })
})

describe('createPinnedDispatcher', () => {
  it('hands back an undici agent and closes its pool on demand', async () => {
    const pinned = createPinnedDispatcher([{ address: '192.0.2.10', family: 4 }])
    expect(pinned.dispatcher).toBeInstanceOf(Agent)
    // undici resolves its pool teardown with null when nothing was in flight.
    await expect(pinned.close()).resolves.toBeNull()
  })
})

describe('scholarlyPublicAccess', () => {
  it('composes the two host seams for the public-PDF arm', () => {
    expect(scholarlyPublicAccess.resolver).toBe(dnsAddressResolver)
    expect(scholarlyPublicAccess.createDispatcher).toBe(createPinnedDispatcher)
  })
})
