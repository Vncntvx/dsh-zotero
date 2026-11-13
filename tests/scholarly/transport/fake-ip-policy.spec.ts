/**
 * The fake-IP policy: where a local proxy's placeholder is acceptable, and
 * how the transport classifies the two kinds of address rejection.
 *
 * A reviewed allowlist hostname and an HTTPS open-access PDF target may bind
 * the peer's identity by TLS, so both accept the 198.18.0.0/15 placeholder the
 * proxy answers. Everything else keeps the public-address gate: plain HTTP, IP
 * literals, other private ranges, and non-allowlist names. A deterministic
 * refusal is final — one fetch, no sleep, no circuit penalty — and its message
 * survives undici's `fetch failed` wrapper; a transient resolution failure is
 * retried and counted against the circuit like any other transport failure.
 * @module tests/scholarly/transport/fake-ip-policy
 */

import { describe, expect, it, vi } from 'vitest'
import {
  isFakeIpAddress,
  isPublicIpAddress,
  resolvePublicAddresses,
  validatingLookup,
  type AddressResolver,
  type HostnamePredicate,
  type ResolvedAddress,
} from '../../../src/transport/network.js'
import { PublicAddressError } from '../../../src/transport/public-url.js'
import { isAllowedScholarlyHost } from '../../../src/scholarly/transport/allowlist.js'
import { createScholarlyHttp } from '../../../src/scholarly/transport/http.js'
import { CircuitBreaker } from '../../../src/scholarly/transport/circuit-breaker.js'
import { HostPacer } from '../../../src/scholarly/transport/pacing.js'
import { failureTextOf } from '../../../src/scholarly/tools/failure.js'
import { resolverOf, stubPublicAccessWith } from '../fixtures.js'

const HOST = 'api.openalex.org'
const WORKS_URL = `https://${HOST}/works`
const PDF_URL = 'https://publisher.example/paper.pdf'
const PUBLIC_V4: ResolvedAddress = { address: '93.184.216.34', family: 4 }
const PUBLIC_V6: ResolvedAddress = { address: '2606:4700:4700::1111', family: 6 }
const FAKE_IP_V4: ResolvedAddress = { address: '198.18.4.25', family: 4 }
const PRIVATE_V4: ResolvedAddress = { address: '10.0.0.7', family: 4 }

function transportWith(options: {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
  resolver?: AddressResolver
  onPredicate?: (predicate: HostnamePredicate | undefined) => void
  breaker?: CircuitBreaker
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}) {
  return createScholarlyHttp({
    fetchImpl: options.fetchImpl,
    publicAccess: stubPublicAccessWith(
      options.resolver ?? resolverOf([PUBLIC_V4]),
      options.onPredicate,
    ),
    pacer: new HostPacer({ [HOST]: 0, 'publisher.example': 0 }),
    ...(options.breaker === undefined ? {} : { circuitBreaker: options.breaker }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  })
}

describe('the fake-IP predicate', () => {
  it('recognises the benchmarking block but keeps it non-public', () => {
    expect(isFakeIpAddress('198.18.0.1')).toBe(true)
    expect(isFakeIpAddress('198.19.255.255')).toBe(true)
    expect(isFakeIpAddress('198.20.0.1')).toBe(false)
    expect(isFakeIpAddress('93.184.216.34')).toBe(false)
    expect(isFakeIpAddress('not-an-ip')).toBe(false)
    // The bare public-address judgment is unchanged: the exception belongs to
    // the caller's policy, never to `isPublicIpAddress`.
    expect(isPublicIpAddress('198.18.0.1')).toBe(false)
  })
})

describe('resolvePublicAddresses policy', () => {
  it('refuses the placeholder by default and names the proxy remedy', async () => {
    const error = await resolvePublicAddresses(HOST, resolverOf([FAKE_IP_V4])).catch(
      (rejection: unknown) => rejection,
    )
    expect(error).toBeInstanceOf(PublicAddressError)
    expect((error as PublicAddressError).reason).toBe('non-public-address')
    expect((error as Error).message).toContain('non-public address (198.18.4.25)')
    expect((error as Error).message).toContain('fake-ip-filter')
  })

  it('accepts the placeholder when the caller takes the policy', async () => {
    await expect(
      resolvePublicAddresses(HOST, resolverOf([FAKE_IP_V4]), { acceptFakeIp: true }),
    ).resolves.toEqual([FAKE_IP_V4])
  })

  it('keeps refusing a private answer mixed into the placeholder', async () => {
    await expect(
      resolvePublicAddresses(HOST, resolverOf([FAKE_IP_V4, PRIVATE_V4]), {
        acceptFakeIp: true,
      }),
    ).rejects.toThrow(/non-public address \(10\.0\.0\.7\)/)
  })

  it('accepts a placeholder alongside a public answer', async () => {
    await expect(
      resolvePublicAddresses(HOST, resolverOf([FAKE_IP_V4, PUBLIC_V6]), {
        acceptFakeIp: true,
      }),
    ).resolves.toEqual([FAKE_IP_V4, PUBLIC_V6])
  })
})

describe('validatingLookup policy', () => {
  it('serves the placeholder only for a hostname the predicate accepts', async () => {
    const relaxed = validatingLookup(resolverOf([FAKE_IP_V4]), (hostname) => hostname === HOST)
    const address = await new Promise<string>((resolve, reject) => {
      relaxed(HOST, { family: 4 }, (error, answer) => {
        if (error !== null) reject(error)
        else resolve(String(answer))
      })
    })
    expect(address).toBe('198.18.4.25')
  })

  it('refuses the placeholder for every other hostname', async () => {
    const strict = validatingLookup(resolverOf([FAKE_IP_V4]))
    const error = await new Promise<Error>((resolve) => {
      strict(HOST, {}, (rejection) => resolve(rejection ?? new Error('unexpected success')))
    })
    expect(error).toBeInstanceOf(PublicAddressError)
    expect(error.message).toContain('fake-ip-filter')
  })
})

describe('the open-access PDF arm', () => {
  it('accepts the placeholder for an HTTPS target and fetches once', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.7'))
    const http = transportWith({ fetchImpl, resolver: resolverOf([FAKE_IP_V4]) })

    const bytes = await http.bytes(PDF_URL, { allowPublicPdf: true })

    expect(bytes.length).toBeGreaterThan(0)
    expect(fetchImpl).toHaveBeenCalledOnce()
    await http.dispose()
  })

  it('refuses the placeholder for a plain-HTTP target before fetching', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.7'))
    const http = transportWith({ fetchImpl, resolver: resolverOf([FAKE_IP_V4]) })

    await expect(
      http.bytes('http://publisher.example/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toThrow(/non-public address \(198\.18\.4\.25\)/)
    expect(fetchImpl).not.toHaveBeenCalled()
    await http.dispose()
  })

  it('refuses a URL that spells the placeholder as a literal', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.7'))
    const literalResolver: AddressResolver = async (hostname) => [{ address: hostname, family: 4 }]
    const http = transportWith({ fetchImpl, resolver: literalResolver })

    await expect(
      http.bytes('https://198.18.0.1/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toThrow(/non-public address \(198\.18\.0\.1\)/)
    expect(fetchImpl).not.toHaveBeenCalled()
    await http.dispose()
  })

  it('still refuses an ordinary private answer for an HTTPS target', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.7'))
    const http = transportWith({ fetchImpl, resolver: resolverOf([PRIVATE_V4]) })

    await expect(http.bytes(PDF_URL, { allowPublicPdf: true })).rejects.toThrow(
      /non-public address \(10\.0\.0\.7\)/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    await http.dispose()
  })
})

describe('the allowlist arm', () => {
  const rejection = new PublicAddressError(
    'Security rejection: "api.openalex.org" resolves to a non-public address (198.18.4.25). A local DNS proxy (Clash/mihomo TUN) answers with this fake-IP placeholder; add the host to its fake-ip-filter or switch the DNS mode to redir-host.',
    'non-public-address',
  )
  const resolutionFailure = new PublicAddressError(
    'Security rejection: "api.openalex.org" did not resolve (EAI_AGAIN).',
    'resolution-failed',
  )

  function wrappedFailure(cause: PublicAddressError = rejection): TypeError {
    return new TypeError('fetch failed', { cause })
  }

  it('surfaces the connector rejection without retrying or recording a host failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw wrappedFailure()
    })
    const breaker = new CircuitBreaker({ failureThreshold: 1 })
    const sleep = vi.fn(async () => {})
    const http = transportWith({ fetchImpl, breaker, sleep })

    const thrown = await http.bytes(WORKS_URL).catch((error: unknown) => error)

    expect(thrown).toBe(rejection)
    expect(failureTextOf(thrown)).toContain('fake-ip-filter')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
    expect(breaker.getState(HOST)).toBe('CLOSED')
    await http.dispose()
  })

  it('retries a transient resolution failure and records it against the circuit', async () => {
    const fetchImpl = vi.fn(async () => {
      throw wrappedFailure(resolutionFailure)
    })
    const breaker = new CircuitBreaker({ failureThreshold: 1 })
    const sleep = vi.fn(async () => {})
    const http = transportWith({ fetchImpl, breaker, sleep })

    const thrown = await http.bytes(WORKS_URL).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(TypeError)
    expect((thrown as Error).cause).toBe(resolutionFailure)
    // Two retries: the transient failure is not a deterministic refusal.
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(breaker.getState(HOST)).toBe('OPEN')
    await http.dispose()
  })

  it('leaves a half-open probe half-open instead of re-opening the circuit', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
    breaker.recordFailure(HOST)
    expect(breaker.getState(HOST)).toBe('HALF_OPEN')
    const http = transportWith({
      fetchImpl: vi.fn(async () => {
        throw wrappedFailure()
      }),
      breaker,
      sleep: async () => {},
    })

    const thrown = await http.bytes(WORKS_URL).catch((error: unknown) => error)

    expect(thrown).toBe(rejection)
    expect(breaker.getState(HOST)).toBe('HALF_OPEN')
    await http.dispose()
  })

  it('hands the reviewed-host predicate to the validating pool', async () => {
    let predicate: HostnamePredicate | undefined
    const http = transportWith({
      fetchImpl: vi.fn(async () => new Response('{}')),
      onPredicate: (received) => {
        predicate = received
      },
    })

    await http.bytes(WORKS_URL)

    expect(predicate).toBe(isAllowedScholarlyHost)
    expect(predicate?.(HOST)).toBe(true)
    expect(predicate?.('publisher.example')).toBe(false)
    await http.dispose()
  })

  it('refuses a plain-HTTP allowlist URL before fetching', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'))
    const http = transportWith({ fetchImpl })

    await expect(http.bytes(`http://${HOST}/works`)).rejects.toThrow(/must use HTTPS/)
    expect(fetchImpl).not.toHaveBeenCalled()
    await http.dispose()
  })

  it('releases a same-host half-open probe when a redirect downgrades to HTTP', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
    breaker.recordFailure(HOST)
    expect(breaker.getState(HOST)).toBe('HALF_OPEN')
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `http://${HOST}/works` },
        }),
    )
    const http = transportWith({ fetchImpl, breaker })

    await expect(http.bytes(WORKS_URL)).rejects.toThrow(/must use HTTPS/)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(breaker.getState(HOST)).toBe('HALF_OPEN')
    // The probe token was released, not leaked: the next request may probe.
    const probe = breaker.beforeRequest(HOST)
    expect(probe).toBeDefined()
    breaker.releaseProbe(HOST, probe)
    await http.dispose()
  })
})
