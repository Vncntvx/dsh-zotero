import { describe, expect, it, vi } from 'vitest'
import {
  CircuitBreaker,
  ScholarlyCircuitOpenError,
} from '../../../src/scholarly/transport/circuit-breaker.js'
import { createScholarlyHttp } from '../../../src/scholarly/transport/http.js'
import { stubPublicAccess } from '../fixtures.js'
import { HostPacer } from '../../../src/scholarly/transport/pacing.js'

describe('scholarly transport resilience: circuit breaker', () => {
  it('manages CLOSED, OPEN, and HALF_OPEN state transitions', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 50,
      windowMs: 1000,
    })

    const host = 'api.semanticscholar.org'
    expect(breaker.getState(host)).toBe('CLOSED')

    breaker.recordFailure(host)
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('CLOSED')
    expect(() => breaker.beforeRequest(host)).not.toThrow()

    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('OPEN')
    expect(() => breaker.beforeRequest(host)).toThrow(ScholarlyCircuitOpenError)

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(65)
      expect(breaker.getState(host)).toBe('HALF_OPEN')
      breaker.recordSuccess(host)
      expect(breaker.getState(host)).toBe('CLOSED')
      expect(() => breaker.beforeRequest(host)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('admits only one half-open recovery probe', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 50, windowMs: 1000 })
    const host = 'api.semanticscholar.org'
    breaker.recordFailure(host)

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(55)
      expect(breaker.getState(host)).toBe('HALF_OPEN')
      expect(() => breaker.beforeRequest(host)).not.toThrow()
      expect(() => breaker.beforeRequest(host)).toThrow(ScholarlyCircuitOpenError)
      expect(() => breaker.beforeRequest(host)).toThrow(/recovery probe is in flight/)
      breaker.recordSuccess(host)
      expect(() => breaker.beforeRequest(host)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a half-open probe when its caller aborts during fetch', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
    const host = 'api.openalex.org'
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('HALF_OPEN')

    const caller = new AbortController()
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      circuitBreaker: breaker,
      pacer: new HostPacer({ [host]: 0 }),
      fetchImpl: async (_url, init) => {
        resolveStarted()
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')), {
            once: true,
          })
        })
      },
    })
    const request = http.bytes(`https://${host}/works`, { signal: caller.signal })
    await started
    caller.abort(new Error('user cancelled'))
    await expect(request).rejects.toThrow()
    expect(() => breaker.beforeRequest(host)).not.toThrow()
    breaker.recordSuccess(host)
  })

  it('treats a failed half-open probe as one failure without retrying it', async () => {
    vi.useFakeTimers()
    try {
      const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 })
      const host = 'api.openalex.org'
      breaker.recordFailure(host)
      vi.advanceTimersByTime(11)
      expect(breaker.getState(host)).toBe('HALF_OPEN')
      const fetchImpl = vi.fn(async () => {
        throw new Error('probe failed')
      })
      const http = createScholarlyHttp({
        publicAccess: stubPublicAccess,
        circuitBreaker: breaker,
        pacer: new HostPacer({ [host]: 0 }),
        fetchImpl,
      })
      await expect(http.bytes(`https://${host}/works`, { retries: 3 })).rejects.toThrow(
        'probe failed',
      )
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(breaker.getState(host)).toBe('OPEN')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps one half-open probe across a same-host redirect', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
    const host = 'api.openalex.org'
    breaker.recordFailure(host)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://${host}/works/redirected` },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      circuitBreaker: breaker,
      pacer: new HostPacer({ [host]: 0 }),
      fetchImpl,
    })
    await expect(http.text(`https://${host}/works/start`)).resolves.toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(breaker.getState(host)).toBe('CLOSED')
  })
})

describe('dynamic circuit pruning at the tracked-capacity ceiling', () => {
  /** The otherwise-private circuit map, read to observe pruning. */
  function circuitMap(breaker: CircuitBreaker): Map<string, unknown> {
    return (breaker as unknown as { circuits: Map<string, unknown> }).circuits
  }

  it('drops a healthy dynamic circuit but keeps a failing one inside its window', () => {
    const breaker = new CircuitBreaker({ maxTrackedCircuits: 2 })
    breaker.beforeRequest('api.openalex.org')
    breaker.beforeRequest('adhoc-healthy.org')
    breaker.beforeRequest('adhoc-failing.org')
    breaker.recordFailure('adhoc-failing.org')

    // The fourth host pushes the map over its ceiling and triggers the sweep.
    breaker.beforeRequest('adhoc-new.org')

    const circuits = circuitMap(breaker)
    expect(circuits.has('api.openalex.org')).toBe(true)
    expect(circuits.has('adhoc-healthy.org')).toBe(false)
    expect(circuits.has('adhoc-failing.org')).toBe(true)
    expect(circuits.has('adhoc-new.org')).toBe(true)
  })

  it('evicts the oldest dynamic circuit first when the sweep frees too little room', () => {
    vi.useFakeTimers()
    try {
      const breaker = new CircuitBreaker({ maxTrackedCircuits: 3 })
      breaker.beforeRequest('api.openalex.org')
      breaker.beforeRequest('api.crossref.org')
      breaker.beforeRequest('adhoc-old.org')
      breaker.recordFailure('adhoc-old.org')
      vi.advanceTimersByTime(1_000)
      breaker.beforeRequest('adhoc-newer.org')
      breaker.recordFailure('adhoc-newer.org')

      breaker.beforeRequest('adhoc-trigger.org')

      const circuits = circuitMap(breaker)
      expect(circuits.has('adhoc-old.org')).toBe(false)
      expect(circuits.has('adhoc-newer.org')).toBe(true)
      expect(circuits.has('api.openalex.org')).toBe(true)
      expect(circuits.has('api.crossref.org')).toBe(true)
      expect(circuits.has('adhoc-trigger.org')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops evicting once no dynamic circuit remains', () => {
    const breaker = new CircuitBreaker({ maxTrackedCircuits: 1 })
    breaker.beforeRequest('api.openalex.org')
    breaker.beforeRequest('api.crossref.org')
    breaker.beforeRequest('adhoc-one.org')
    breaker.recordFailure('adhoc-one.org')

    // Two scholarly circuits keep the map over capacity after the only dynamic
    // entry is evicted, so the second iteration has nothing left to delete.
    breaker.beforeRequest('adhoc-trigger.org')

    const circuits = circuitMap(breaker)
    expect(circuits.has('adhoc-one.org')).toBe(false)
    expect(circuits.has('api.openalex.org')).toBe(true)
    expect(circuits.has('api.crossref.org')).toBe(true)
    expect(circuits.has('adhoc-trigger.org')).toBe(true)
  })
})
