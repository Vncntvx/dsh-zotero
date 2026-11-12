/**
 * The model-facing failure text carries the transport's own code.
 *
 * A bare `fetch failed` cannot say whether the network, the TLS path, or a
 * dispatcher from the wrong undici copy broke a request. `failureTextOf` reads
 * the errno-style code from the cause chain and appends it once, so a local
 * composition error is recognizable from the tool result alone.
 * @module tests/scholarly/transport/failure-detail
 */

import { describe, expect, it, vi } from 'vitest'
import { failureTextOf } from '../../../src/scholarly/tools/failure.js'
import {
  createScholarlyHttp,
  ScholarlyTransportError,
} from '../../../src/scholarly/transport/http.js'
import { CircuitBreaker } from '../../../src/scholarly/transport/circuit-breaker.js'
import { HostPacer } from '../../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from '../fixtures.js'

const HOST = 'api.openalex.org'
const WORKS_URL = `https://${HOST}/works`

function codedFailure(message: string, code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) })
}

function transportWith(overrides: {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
  breaker?: CircuitBreaker
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}) {
  return createScholarlyHttp({
    fetchImpl: overrides.fetchImpl,
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({ [HOST]: 0 }),
    ...(overrides.breaker === undefined ? {} : { circuitBreaker: overrides.breaker }),
    ...(overrides.sleep === undefined ? {} : { sleep: overrides.sleep }),
  })
}

describe('failureTextOf', () => {
  it('appends the underlying transport code to a bare fetch failure', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'UND_ERR_INVALID_ARG' } })
    expect(failureTextOf(error)).toBe('fetch failed (UND_ERR_INVALID_ARG)')
  })

  it('keeps the status prefix and the code together', () => {
    const error = Object.assign(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }), {
      status: 503,
    })
    expect(failureTextOf(error)).toBe('HTTP 503 — fetch failed (ECONNRESET)')
  })

  it('does not duplicate a code the message already spells', () => {
    const error = new TypeError('fetch failed (ECONNRESET)', {
      cause: { code: 'ECONNRESET' },
    })
    expect(failureTextOf(error)).toBe('fetch failed (ECONNRESET)')
  })
})

describe('ScholarlyTransportError', () => {
  it('fails once without retrying or opening the breaker for a dispatcher mismatch', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 })
    const fetchImpl = vi.fn(async () => {
      throw codedFailure('invalid onRequestStart method', 'UND_ERR_INVALID_ARG')
    })
    const sleep = vi.fn(async () => {})
    const http = transportWith({ fetchImpl, breaker, sleep })

    const failure = await http.bytes(WORKS_URL).catch((error: unknown) => error)
    if (!(failure instanceof ScholarlyTransportError)) throw failure

    expect(failure).toMatchObject({
      host: HOST,
      code: 'UND_ERR_INVALID_ARG',
      message: 'fetch failed (UND_ERR_INVALID_ARG)',
    })
    expect(failure.cause).toBeInstanceOf(TypeError)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
    expect(breaker.getState(HOST)).toBe('CLOSED')
    await http.dispose()
  })

  it('retries a coded network failure and reports the code after exhaustion', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 })
    const fetchImpl = vi.fn(async () => {
      throw codedFailure('socket hang up', 'ECONNRESET')
    })
    const sleep = vi.fn(async () => {})
    const http = transportWith({ fetchImpl, breaker, sleep })

    const failure = await http.bytes(WORKS_URL).catch((error: unknown) => error)
    if (!(failure instanceof ScholarlyTransportError)) throw failure

    expect(failure.code).toBe('ECONNRESET')
    expect(failure.message).toBe('fetch failed (ECONNRESET)')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(breaker.getState(HOST)).toBe('OPEN')
    await http.dispose()
  })

  it('leaves a half-open circuit half-open when the failure is a local mismatch', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })
    breaker.recordFailure(HOST)
    expect(breaker.getState(HOST)).toBe('HALF_OPEN')
    const fetchImpl = vi.fn(async () => {
      throw codedFailure('invalid onRequestStart method', 'UND_ERR_INVALID_ARG')
    })
    const http = transportWith({ fetchImpl, breaker, sleep: async () => {} })

    const failure = await http.bytes(WORKS_URL).catch((error: unknown) => error)
    if (!(failure instanceof ScholarlyTransportError)) throw failure

    expect(failure.code).toBe('UND_ERR_INVALID_ARG')
    expect(breaker.getState(HOST)).toBe('HALF_OPEN')
    const probe = breaker.beforeRequest(HOST)
    breaker.releaseProbe(HOST, probe)
    await http.dispose()
  })

  it('keeps a codeless half-open failure unchanged and reopens the circuit', async () => {
    vi.useFakeTimers()
    try {
      const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 })
      breaker.recordFailure(HOST)
      vi.advanceTimersByTime(11)
      expect(breaker.getState(HOST)).toBe('HALF_OPEN')
      const http = transportWith({
        fetchImpl: vi.fn(async () => {
          throw new Error('probe failed')
        }),
        breaker,
        sleep: async () => {},
      })

      const failure = await http.bytes(WORKS_URL).catch((error: unknown) => error)

      expect(failure).not.toBeInstanceOf(ScholarlyTransportError)
      expect((failure as Error).message).toBe('probe failed')
      expect(breaker.getState(HOST)).toBe('OPEN')
      await http.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
