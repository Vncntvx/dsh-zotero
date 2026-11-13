/** The transport's deadline, retry and in-flight gate arms. */
import { describe, expect, it } from 'vitest'
import { CircuitBreaker } from '../../../src/scholarly/transport/circuit-breaker.js'
import { createScholarlyHttp } from '../../../src/scholarly/transport/http.js'
import { stubPublicAccess } from '../fixtures.js'
import { HostPacer } from '../../../src/scholarly/transport/pacing.js'
import { deferred } from '../../helpers/sync.js'

describe('scholarly transport deadline and gate behavior', () => {
  /** A fetch that never resolves until its abort signal fires. */
  const hangingFetch = (init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })

  it('reports a provider deadline as a gateway timeout without retrying it', async () => {
    // A host that will not answer within the budget will not answer on the
    // next attempt either; spending the retry budget on it delays the caller
    // by the whole budget for the same outcome.
    let calls = 0
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      fetchImpl: async (_url, init) => {
        calls += 1
        return await hangingFetch(init)
      },
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })

    await expect(
      http.bytes('https://api.openalex.org/works', { timeoutMs: 10, retries: 3 }),
    ).rejects.toThrow(/HTTP 504 from api\.openalex\.org/)
    expect(calls).toBe(1)
  })

  it('never retries after the caller aborts', async () => {
    let calls = 0
    const caller = new AbortController()
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      fetchImpl: async (_url, init) => {
        calls += 1
        queueMicrotask(() => caller.abort(new Error('user cancelled')))
        return await hangingFetch(init)
      },
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })

    await expect(
      http.bytes('https://api.openalex.org/works', { signal: caller.signal, retries: 3 }),
    ).rejects.toThrow()
    // One attempt: a cancelled call is final, not a transient failure.
    expect(calls).toBe(1)
  })

  it('bounds in-flight requests to the configured ceiling', async () => {
    let inFlight = 0
    let peak = 0
    // A barrier, not a sleep: every request parks until all twelve have been
    // admitted or the ceiling is reached, so the peak is a fact about the gate
    // rather than about how fast a timer fired.
    const waiters: Array<() => void> = []
    let open = false
    const arrived = deferred<void>()
    // Opening the barrier is sticky: the queued three and every later arrival
    // pass without parking, so the test cannot stall behind its own release.
    const release = (): void => {
      open = true
      for (const wake of waiters.splice(0)) wake()
    }
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      maxInFlight: 3,
      fetchImpl: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        if (inFlight === 3) arrived.resolve()
        if (!open) {
          await new Promise<void>((wake) => {
            // The first three never resolve until the test releases them; the
            // rest cannot even start, which is the property under test.
            waiters.push(wake)
          })
        }
        inFlight -= 1
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      },
      // No per-host spacing: without it the pacer would start only one request
      // every 100 ms, and an over-admitting gate could never be observed.
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })

    const requests = Array.from({ length: 12 }, (_, i) =>
      http.json(`https://api.openalex.org/works/${i}`),
    )
    await arrived.promise
    // Nothing beyond the ceiling may be in flight even though nine callers are
    // queued behind the gate.
    expect(peak).toBe(3)
    expect(inFlight).toBe(3)
    release()
    await Promise.all(requests)
    // The released requests run three at a time: an unbounded gate would have
    // started all twelve and peaked at twelve.
    expect(peak).toBe(3)
    expect(inFlight).toBe(0)
  })

  it('reports an open circuit as its own failure', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 60_000,
      windowMs: 60_000,
    })
    breaker.recordFailure('api.crossref.org')
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      circuitBreaker: breaker,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      pacer: new HostPacer({ 'api.crossref.org': 0 }),
    })

    await expect(http.bytes('https://api.crossref.org/works/1')).rejects.toThrow(
      /temporarily unavailable after repeated failures/,
    )
  })

  it('reopens circuit when probe fails in HALF_OPEN state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 5,
      windowMs: 60_000,
    })
    const host = 'api.crossref.org'
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('OPEN')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The cooldown elapsed: the gate read probes the host (HALF_OPEN).
    expect(breaker.getState(host)).toBe('HALF_OPEN')
    // A failed probe reopens immediately, with a fresh cooldown.
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('OPEN')
  })

  it('prunes healthy ad-hoc circuits and expired pacer request timestamps', async () => {
    const breaker = new CircuitBreaker({ maxTrackedCircuits: 2, cooldownMs: 10, windowMs: 10 })
    breaker.beforeRequest('adhoc-1.org')
    breaker.recordFailure('adhoc-1.org')
    breaker.beforeRequest('adhoc-2.org')
    breaker.recordFailure('adhoc-2.org')
    // Wait for failure window & cooldown to elapse
    await new Promise((resolve) => setTimeout(resolve, 15))
    // Trigger prune on next new host
    breaker.beforeRequest('adhoc-3.org')
  })
})
