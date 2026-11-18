import { expect, it, vi } from 'vitest'
import {
  CircuitBreaker,
  ScholarlyCircuitOpenError,
} from '../../../src/scholarly/transport/circuit-breaker.js'
import { createScholarlyHttp } from '../../../src/scholarly/transport/http.js'
import { HostPacer } from '../../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from '../../helpers/scholarly-runtime.js'

const host = 'api.openalex.org'
const url = `https://${host}/works`

it('cannot release a recovery probe without its current token', () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
  breaker.recordFailure(host)
  const owner = breaker.beforeRequest(host)
  breaker.releaseProbe(host)
  breaker.releaseProbe(host, Symbol('unrelated'))
  expect(() => breaker.beforeRequest(host)).toThrow(ScholarlyCircuitOpenError)
  breaker.releaseProbe(host, owner)
  const next = breaker.beforeRequest(host)
  breaker.releaseProbe(host, owner)
  expect(() => breaker.beforeRequest(host)).toThrow(ScholarlyCircuitOpenError)
  breaker.releaseProbe(host, next)
  expect(breaker.beforeRequest(host)).toBeDefined()
})

it('uses the same retry budget after three redirects', async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.redirect(`${url}/first`))
    .mockResolvedValueOnce(Response.redirect(`${url}/second`))
    .mockResolvedValueOnce(Response.redirect(`${url}/last`))
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response('Recovered'))
  const sleep = vi.fn(async (_ms: number) => {})
  const http = createScholarlyHttp({
    fetchImpl,
    sleep,
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({ [host]: 0 }),
  })
  try {
    await expect(http.text(url)).resolves.toBe('Recovered')
    expect(fetchImpl.mock.calls.map(([target]) => target)).toEqual([
      url,
      `${url}/first`,
      `${url}/second`,
      `${url}/last`,
      `${url}/last`,
      `${url}/last`,
    ])
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000])
  } finally {
    await http.dispose()
  }
})

it('does not retry a throttled half-open probe even with retry budget left', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
  breaker.recordFailure(host)
  const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }))
  const http = createScholarlyHttp({
    fetchImpl,
    circuitBreaker: breaker,
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({ [host]: 0 }),
  })
  try {
    await expect(http.text(url)).rejects.toMatchObject({ status: 429 })
    expect(fetchImpl).toHaveBeenCalledOnce()
  } finally {
    await http.dispose()
  }
})
