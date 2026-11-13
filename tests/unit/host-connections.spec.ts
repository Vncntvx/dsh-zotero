import { Agent, fetch as undiciFetch } from 'undici'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock, agentMocks } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  agentMocks: [] as Array<{ connect?: { lookup?: unknown } }>,
}))

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  class RecordingAgent extends actual.Agent {
    constructor(options: { connect?: { lookup?: unknown } }) {
      super(options as ConstructorParameters<typeof actual.Agent>[0])
      agentMocks.push(options)
    }
  }
  return { ...actual, Agent: RecordingAgent }
})

import {
  createPinnedDispatcher,
  dnsAddressResolver,
  publicFetch,
  scholarlyPublicAccess,
} from '../../src/transport/connections.js'
import { PublicAddressError } from '../../src/transport/public-url.js'

beforeEach(() => {
  lookupMock.mockReset()
  agentMocks.length = 0
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

describe('publicFetch', () => {
  it("is the dependency's own undici fetch, not a runtime fetch or a test double", () => {
    // The dispatchers below are undici@8 Agents. Only the fetch from that
    // same copy accepts them; the runtime's global fetch ships another undici
    // and rejects the dispatcher before a socket opens.
    expect(publicFetch).toBe(undiciFetch)
    expect(publicFetch).not.toBe(vi.fn())
  })
})

describe('scholarlyPublicAccess', () => {
  it('composes the two host seams for the public-PDF arm', () => {
    expect(scholarlyPublicAccess.resolver).toBe(dnsAddressResolver)
    expect(scholarlyPublicAccess.createDispatcher).toBe(createPinnedDispatcher)
  })

  it('forwards the fake-IP predicate into the validating pool connector', async () => {
    lookupMock.mockResolvedValue([{ address: '198.18.4.25', family: 4 }])
    const validating = scholarlyPublicAccess.createValidatingDispatcher(
      (hostname) => hostname === 'api.openalex.org',
    )
    expect(validating.dispatcher).toBeInstanceOf(Agent)
    const connector = agentMocks.at(-1)?.connect
    const lookup = connector?.lookup as
      | ((
          hostname: string,
          options: object,
          callback: (error: Error | null, address: string) => void,
        ) => void)
      | undefined
    expect(lookup).toBeTypeOf('function')

    const answerFor = (hostname: string): Promise<string | Error> =>
      new Promise((resolve) => {
        lookup!(hostname, { family: 4 }, (error, address) => resolve(error ?? address))
      })

    // The predicate admits the reviewed host, so its placeholder is served.
    await expect(answerFor('api.openalex.org')).resolves.toBe('198.18.4.25')
    // A name outside the allowlist keeps the strict public-address gate.
    const refused = await answerFor('publisher.example')
    expect(refused).toBeInstanceOf(PublicAddressError)
    expect((refused as Error).message).toContain('fake-ip-filter')
    await validating.close()
  })
})
