/** Public PDF DNS retries preserve deterministic refusals and caller cancellation. */
import { expect, it, vi } from 'vitest'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { CircuitBreaker } from '../../src/scholarly/transport/circuit-breaker.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from '../helpers/scholarly-runtime.js'

it('retries transient public-PDF resolution and accounts the exhausted call against its circuit', async () => {
  const resolver = vi.fn(async () => {
      throw new Error('EAI_AGAIN')
    }),
    fetchImpl = vi.fn(async () => new Response('pdf'))
  const sleep = vi.fn(async (_ms: number) => {}),
    circuitBreaker = new CircuitBreaker({ failureThreshold: 1 })
  const http = createScholarlyHttp({
    fetchImpl,
    sleep,
    circuitBreaker,
    pacer: new HostPacer({ 'papers.example.org': 0 }),
    publicAccess: { ...stubPublicAccess, resolver },
  })
  try {
    await expect(
      http.bytes('https://papers.example.org/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toMatchObject({ reason: 'resolution-failed' })
    expect(resolver).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(circuitBreaker.getState('papers.example.org')).toBe('OPEN')
  } finally {
    await http.dispose()
  }
})

it('never retries a deterministic address refusal or penalizes its circuit', async () => {
  const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]),
    sleep = vi.fn(async () => {})
  const http = createScholarlyHttp({
    fetchImpl: vi.fn(),
    sleep,
    pacer: new HostPacer({ 'papers.example.org': 0 }),
    publicAccess: { ...stubPublicAccess, resolver },
  })
  try {
    await expect(
      http.bytes('https://papers.example.org/paper.pdf', { allowPublicPdf: true }),
    ).rejects.toMatchObject({ reason: 'non-public-address' })
    expect(resolver).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
    expect(http.circuitBreaker.getState('papers.example.org')).toBe('CLOSED')
  } finally {
    await http.dispose()
  }
})

it('recovers a public PDF after one transient DNS failure', async () => {
  const resolver = vi
    .fn()
    .mockRejectedValueOnce(new Error('EAI_AGAIN'))
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  const fetchImpl = vi.fn(async () => new Response('PDF result'))
  const http = createScholarlyHttp({
    fetchImpl,
    sleep: async () => {},
    pacer: new HostPacer({ 'papers.example.org': 0 }),
    publicAccess: { ...stubPublicAccess, resolver },
  })
  try {
    expect(
      new TextDecoder().decode(
        await http.bytes('https://papers.example.org/paper.pdf', { allowPublicPdf: true }),
      ),
    ).toBe('PDF result')
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(http.circuitBreaker.getState('papers.example.org')).toBe('CLOSED')
  } finally {
    await http.dispose()
  }
})
