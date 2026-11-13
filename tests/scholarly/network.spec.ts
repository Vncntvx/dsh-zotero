/**
 * The resolved-address safety gates of the scholarly transport: the literal
 * ranges every DNS answer must pass, the resolve-and-pin seam the public-PDF
 * arm runs through, and the fact that a rate-limited host pays its backoff
 * outside the in-flight gate.
 *
 * The DNS seam is stubbed, so no test here opens a socket or resolves a real
 * name; the transport spec's lexical cases stay beside `allowlist.ts`.
 * @module tests/scholarly/network
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isPublicIpAddress,
  pinnedLookup,
  resolvePublicAddresses,
  validatingLookup,
  type AddressResolver,
  type ResolvedAddress,
} from '../../src/transport/network.js'
import { ScholarlySecurityError } from '../../src/scholarly/transport/allowlist.js'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { stubPublicAccess, resolverOf } from './fixtures.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import { deferred } from '../helpers/sync.js'

const PUBLIC_V4: ResolvedAddress = { address: '93.184.216.34', family: 4 }

describe('isPublicIpAddress: IPv4 ranges', () => {
  it.each([
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['93.184.216.34', true],
    ['0.1.2.3', false],
    ['10.0.0.1', false],
    ['100.64.0.1', false],
    ['100.127.255.254', false],
    ['100.128.0.1', true],
    ['127.0.0.1', false],
    ['169.254.1.1', false],
    ['172.15.255.255', true],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['172.32.0.1', true],
    ['192.0.0.1', false],
    ['192.0.2.1', false],
    ['192.88.99.1', false],
    ['192.168.1.1', false],
    ['198.18.0.1', false],
    ['198.19.255.255', false],
    ['198.51.100.1', false],
    ['203.0.113.1', false],
    ['224.0.0.1', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
  ])('%s', (ip, expected) => {
    expect(isPublicIpAddress(ip), ip).toBe(expected)
  })

  it('refuses anything that is not a literal address', () => {
    expect(isPublicIpAddress('localtest.me')).toBe(false)
    expect(isPublicIpAddress('not an ip')).toBe(false)
    expect(isPublicIpAddress('')).toBe(false)
    expect(isPublicIpAddress('999.1.1.1')).toBe(false)
  })
})

describe('isPublicIpAddress: IPv6 spellings', () => {
  it.each([
    ['2606:4700:4700::1111', true],
    ['2001:4860:4860::8888', true],
    ['1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2000::1', true],
    ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    ['2001::1', false],
    ['2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:200::1', true],
    ['2001:2::1', false],
    ['2001:2:0:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:3::1', false],
    ['2001:4:111:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:4:112::1', false],
    ['2001:4:112:0:ffff:ffff:ffff:ffff', false],
    ['2001:4:113::1', false],
    ['2001:f:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:10::1', false],
    ['2001:1f:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:20::1', false],
    ['2001:2f:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:30::1', false],
    ['2001:3f:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:40::1', false],
    ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', true],
    ['2001:db8::1', false],
    ['2001:db9::1', true],
    ['2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    ['2002::1', false],
    ['2003::1', true],
    ['261f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    ['2620:4f:7fff:ffff:ffff:ffff:ffff:ffff', true],
    ['2620:4f:8000::1', false],
    ['2620:4f:8000:0:ffff:ffff:ffff:ffff', false],
    ['2620:4f:8001::1', true],
    ['3ffd:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    ['3ffe::1', false],
    ['3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['3fff::1', false],
    ['3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['3fff:1000::1', true],
    ['4000::1', false],
    ['::', false],
    ['::1', false],
    ['0:0:0:0:0:0:0:1', false],
    ['::0.0.0.1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:8.8.8.8', true],
    ['::10.0.0.1', false],
    ['2001:0000:1234:5678:9abc:def0:127.0.0.1', false],
    ['64:ff9b::127.0.0.1', false],
    ['64:ff9b::8.8.8.8', true],
    ['64:ff9b:0:0:0:1:808:808', false],
    ['64:ff9b:1::8.8.8.8', false],
    ['100::1', false],
    ['fc00::1', false],
    ['fd12:3456::1', false],
    ['fe80::1', false],
    ['febf::1', false],
    ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['fec0::1', false],
    ['fec3:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['fec4::1', false],
    ['feff::1', false],
    ['ff02::1', false],
    ['5f00::1', false],
  ])('%s', (ip, expected) => {
    expect(isPublicIpAddress(ip), ip).toBe(expected)
  })

  it.each([
    ['a repeated compression', '1::2::3', false],
    ['an oversized hex group', '12345::', false],
    ['a non-hex group', 'zz::1', false],
    ['nine groups', '1:2:3:4:5:6:7:8:9', false],
    ['a dotted tail with three octets', '::ffff:1.2.3', false],
    ['an out-of-range dotted octet', '::ffff:1.2.3.999', false],
    ['a leading single colon', ':1:2', false],
    ['an empty group before the compression', '1:::2', false],
    ['a non-hex group after the compression', '::zz', false],
    ['a compression that stands for no group', '1:2:3:4:5:6:7:8::', false],
  ])('refuses %s instead of guessing', (_name, ip, expected) => {
    expect(isPublicIpAddress(ip), ip).toBe(expected)
  })

  it('expands a fully spelled-out eight-group literal', () => {
    // No `::`, so the expander takes its uncompressed arm; this is a public
    // address and must not be refused for lacking a compression.
    expect(isPublicIpAddress('2606:4700:4700:0:0:0:0:1111')).toBe(true)
  })
})

describe('resolvePublicAddresses', () => {
  it('answers the validated set when every address is public', async () => {
    const addresses = await resolvePublicAddresses(
      'example.com',
      resolverOf([PUBLIC_V4, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]),
    )
    expect(addresses).toEqual([
      PUBLIC_V4,
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])
  })

  it('refuses a name with no answers', async () => {
    await expect(resolvePublicAddresses('example.com', resolverOf([]))).rejects.toThrow(
      /did not resolve to any address/,
    )
  })

  it('refuses a name whose resolution itself fails, naming the host only', async () => {
    const resolver: AddressResolver = async () => {
      throw new Error('resolver exploded with a secret query string')
    }
    await expect(resolvePublicAddresses('example.com', resolver)).rejects.toThrow(
      /"example\.com" did not resolve \(resolver exploded with a secret query string\)/,
    )
    await expect(resolvePublicAddresses('example.com', resolver)).rejects.toThrow(
      expect.not.stringContaining('https://'),
    )
  })

  it('refuses one private answer among public ones', async () => {
    await expect(
      resolvePublicAddresses(
        'example.com',
        resolverOf([PUBLIC_V4, { address: '10.0.0.7', family: 4 }]),
      ),
    ).rejects.toThrow(/resolves to a non-public address \(10\.0\.0\.7\)/)
  })
})

describe('pinnedLookup', () => {
  const addresses: readonly ResolvedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]

  it('answers the single-address node:dns form', () => {
    const lookup = pinnedLookup(addresses)
    lookup('example.com', {}, (error, address, family) => {
      expect(error).toBeNull()
      expect(address).toBe('93.184.216.34')
      expect(family).toBe(4)
    })
  })

  it('honors the requested family in both spellings', () => {
    const lookup = pinnedLookup(addresses)
    lookup('example.com', { family: 6 }, (error, address) => {
      expect(error).toBeNull()
      expect(address).toBe('2606:2800:220:1:248:1893:25c8:1946')
    })
    lookup('example.com', { family: 'IPv4' }, (error, address) => {
      expect(error).toBeNull()
      expect(address).toBe('93.184.216.34')
    })
  })

  it('answers the all form with a mutable copy', () => {
    const lookup = pinnedLookup(addresses)
    lookup('example.com', { all: true }, (error, answer) => {
      expect(error).toBeNull()
      expect(answer).toEqual(addresses)
    })
  })

  it('errs when the requested family has no pinned answer', () => {
    const lookup = pinnedLookup([{ address: '93.184.216.34', family: 4 }])
    lookup('example.com', { family: 6 }, (error) => {
      expect(error).toBeInstanceOf(Error)
    })
  })
})

describe('the public-PDF arm inside the transport', () => {
  it('stops waiting on DNS cancellation and never dispatches a fetch', async () => {
    const resolverGate = deferred<readonly ResolvedAddress[]>()
    const resolverStarted = deferred<void>()
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.4 body', { status: 200 }))
    const controller = new AbortController()
    const http = createScholarlyHttp({
      fetchImpl,
      publicAccess: {
        resolver: async () => {
          resolverStarted.resolve()
          return resolverGate.promise
        },
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
      pacer: new HostPacer({}),
    })
    const request = http.bytes('https://example.com/paper.pdf', {
      allowPublicPdf: true,
      signal: controller.signal,
    })
    await resolverStarted.promise
    controller.abort(new Error('caller canceled'))
    await expect(request).rejects.toThrow('caller canceled')
    resolverGate.resolve([PUBLIC_V4])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a DNS bypass name before any fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.4 body', { status: 200 }))
    const http = createScholarlyHttp({
      fetchImpl,
      publicAccess: {
        resolver: resolverOf([{ address: '127.0.0.1', family: 4 }]),
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
      pacer: new HostPacer({}),
    })
    // The name is lexically public; only the resolved answer sees the loopback.
    await expect(
      http.bytes('https://localtest.me/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toThrow(ScholarlySecurityError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes the pinned dispatcher into the fetch init', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response('%PDF-1.4 ' + 'x'.repeat(600), { status: 200 }),
    )
    const dispatcher = {}
    const http = createScholarlyHttp({
      fetchImpl,
      publicAccess: {
        resolver: resolverOf([PUBLIC_V4]),
        createDispatcher: () => ({ dispatcher, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
      pacer: new HostPacer({}),
    })
    await http.bytes('https://example.com/paper.pdf', { allowPublicPdf: true })
    const init = fetchImpl.mock.calls[0]![1] as { dispatcher?: unknown }
    expect(init.dispatcher).toBe(dispatcher)
  })

  it('fails loud when the arm runs without wired seams', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.4', { status: 200 }))
    const http = createScholarlyHttp({ fetchImpl, pacer: new HostPacer({}) })
    await expect(
      http.bytes('https://example.com/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toThrow(ScholarlySecurityError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('re-resolves and re-pins every redirect hop', async () => {
    const resolvers: string[][] = []
    let hop = 0
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      hop += 1
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.org/paper.pdf' },
        })
      }
      return new Response('%PDF-1.4 ' + 'x'.repeat(600), { status: 200 })
    })
    const http = createScholarlyHttp({
      fetchImpl,
      publicAccess: {
        resolver: async (hostname) => {
          resolvers.push([hostname])
          return [PUBLIC_V4]
        },
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
      pacer: new HostPacer({}),
    })
    await http.bytes('https://example.com/paper.pdf', { allowPublicPdf: true })
    expect(resolvers).toEqual([['example.com'], ['example.org']])
  })

  it('refuses a redirect hop that resolves private', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.org/paper.pdf' },
      })
    })
    const http = createScholarlyHttp({
      fetchImpl,
      publicAccess: {
        resolver: async (hostname) =>
          hostname === 'example.org' ? [{ address: '192.168.0.9', family: 4 }] : [PUBLIC_V4],
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
      pacer: new HostPacer({}),
    })
    await expect(
      http.bytes('https://example.com/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toThrow(ScholarlySecurityError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-standard port before resolving', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.4', { status: 200 }))
    const http = createScholarlyHttp({
      fetchImpl,
      publicAccess: {
        resolver: resolverOf([PUBLIC_V4]),
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
      pacer: new HostPacer({}),
    })
    await expect(
      http.bytes('https://example.com:8443/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toThrow(/not a valid public HTTP/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('validatingLookup', () => {
  it('answers the connector with the addresses it just validated', () => {
    const resolver = vi.fn(async (_hostname: string) => [PUBLIC_V4])
    const lookup = validatingLookup(resolver)
    lookup('example.com', { all: true }, (error, addresses) => {
      expect(error).toBeNull()
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
    })
    expect(resolver).toHaveBeenCalledWith('example.com')
  })

  it('refuses a private answer before the connector sees an address', () => {
    const lookup = validatingLookup(
      vi.fn(async (_hostname: string): Promise<ResolvedAddress[]> => [
        { address: '10.0.0.7', family: 4 },
      ]),
    )
    lookup('example.com', { all: true }, (error) => {
      expect(error).toBeInstanceOf(ScholarlySecurityError)
      expect((error as Error).message).toContain('non-public address (10.0.0.7)')
    })
  })

  it('refuses a name that does not resolve, naming the host', () => {
    const lookup = validatingLookup(
      vi.fn(async () => {
        throw new Error('NXDOMAIN')
      }),
    )
    lookup('example.com', { all: true }, (error) => {
      expect(error).toBeInstanceOf(ScholarlySecurityError)
      expect((error as Error).message).toContain('"example.com" did not resolve')
    })
  })

  it('wraps a non-Error rejection into the connector’s Error contract', () => {
    // A resolver seam may reject with anything; node:http's lookup callback
    // promises an Error, so the raw value must be wrapped, not forwarded.
    const lookup = validatingLookup(
      vi.fn(async () => {
        throw 'resolver exploded'
      }) as unknown as AddressResolver,
    )
    lookup('example.com', {}, (error) => {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('resolver exploded')
    })
  })

  it('honors the requested family and errors when none matches', () => {
    const answers: ResolvedAddress[] = [
      PUBLIC_V4,
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]
    const lookup = validatingLookup(vi.fn(async (_hostname: string) => answers))
    lookup('example.com', { family: 6, all: true }, (error, addresses) => {
      expect(error).toBeNull()
      expect(addresses).toEqual([{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }])
    })
    lookup('example.com', { family: 6 }, (error, address, family) => {
      expect(error).toBeNull()
      expect(address).toBe('2606:2800:220:1:248:1893:25c8:1946')
      expect(family).toBe(6)
    })
    lookup('example.com', { family: 4 }, (error) => {
      expect(error).toBeNull()
    })
  })
})

describe('the allowlist arm inside the transport', () => {
  it('passes the shared validating dispatcher into the fetch init', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    )
    const validatingDispatcher = {}
    const http = createScholarlyHttp({
      fetchImpl,
      pacer: new HostPacer({}),
      publicAccess: {
        resolver: resolverOf([PUBLIC_V4]),
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({
          dispatcher: validatingDispatcher,
          close: async () => {},
        }),
      },
    })
    await http.json('https://api.crossref.org/works?query=attention')
    const init = fetchImpl.mock.calls[0]![1] as { dispatcher?: unknown }
    expect(init.dispatcher).toBe(validatingDispatcher)
  })

  it('reuses one pool across requests and redirect hops', async () => {
    let hop = 0
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      hop += 1
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://doi.org/10.1/x' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })
    let built = 0
    const http = createScholarlyHttp({
      fetchImpl,
      pacer: new HostPacer({}),
      publicAccess: {
        resolver: resolverOf([PUBLIC_V4]),
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => {
          built += 1
          return { dispatcher: { shared: true }, close: async () => {} }
        },
      },
    })
    await http.json('https://api.crossref.org/works?query=attention')
    expect(built).toBe(1)
    const first = fetchImpl.mock.calls[0]![1] as { dispatcher?: unknown }
    const second = fetchImpl.mock.calls[1]![1] as { dispatcher?: unknown }
    expect(first.dispatcher).toBe(second.dispatcher)
  })

  it('closes the shared pool on dispose', async () => {
    let closed = 0
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    )
    const http = createScholarlyHttp({
      fetchImpl,
      pacer: new HostPacer({}),
      publicAccess: {
        resolver: resolverOf([PUBLIC_V4]),
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({
          dispatcher: {},
          close: async () => {
            closed += 1
          },
        }),
      },
    })
    await http.json('https://api.crossref.org/works?query=attention')
    await http.dispose()
    expect(closed).toBe(1)
  })

  it('fails loud on the allowlist arm when the seams are not wired', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    )
    const http = createScholarlyHttp({ fetchImpl, pacer: new HostPacer({}) })
    await expect(http.json('https://api.crossref.org/works')).rejects.toThrow(
      ScholarlySecurityError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
describe('retry backoff happens outside the in-flight gate', () => {
  it('serves another host while the first pays its rate-limit wait', async () => {
    const gateLimit = 1
    let releaseSleep: (() => void) | undefined
    const sleepGate = new Promise<void>((resolve) => {
      releaseSleep = resolve
    })
    const slept: number[] = []
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      maxInFlight: gateLimit,
      fetchImpl: async (url) => {
        if (String(url).includes('api.openalex.org')) {
          return new Response('{}', { status: 429, headers: { 'retry-after': '20' } })
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      },
      pacer: new HostPacer({}),
      // The seam stands in for the real wait: the backoff holds until this
      // test releases it, so the second host's completion proves the slot
      // was already free.
      sleep: async (ms) => {
        slept.push(ms)
        await sleepGate
      },
    })
    const slow = http.json('https://api.openalex.org/works', { retries: 2 }).catch(() => undefined)
    // Let the first attempt reach its 429 and enter the backoff.
    await vi.waitFor(() => expect(slept).toHaveLength(1))
    const fast = await http.json('https://api.crossref.org/works', { retries: 0 })
    expect(fast).toEqual({})
    releaseSleep!()
    await slow
    expect(slept[0]).toBe(20_000)
  })
})
