/** The same deadline covers retries, redirects and retry-after waits. No sockets are opened. */
import { afterEach, expect, it, vi } from 'vitest'
import { createScholarlyHttp, type ScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { abortableSleep, HostPacer } from '../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from '../helpers/scholarly-runtime.js'

const clients: ScholarlyHttp[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(clients.splice(0).map((client) => client.dispose()))
})
it('cuts off a retry/redirect chain at the original six-attempt time budget', async () => {
  vi.useFakeTimers()
  let requests = 0
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    requests++
    await abortableSleep(900, init?.signal ?? undefined)
    return requests <= 2
      ? new Response(null, { status: 503 })
      : new Response(null, {
          status: 302,
          headers: { location: `https://api.openalex.org/works?hop=${requests}` },
        })
  })
  const http = createScholarlyHttp({
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({ 'api.openalex.org': 0 }),
    fetchImpl,
  })
  clients.push(http)
  const refused = expect(
    http.text('https://api.openalex.org/works', { timeoutMs: 1000, retries: 2 }),
  ).rejects.toThrow('HTTP 504 from api.openalex.org')
  await vi.advanceTimersByTimeAsync(6000)
  await refused
  expect(requests).toBe(4)
  expect(vi.getTimerCount()).toBe(0)
})

it('includes retry-after backoff in the original budget', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi.fn(
    async () => new Response(null, { status: 429, headers: { 'retry-after': '10' } }),
  )
  const http = createScholarlyHttp({
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({ 'api.openalex.org': 0 }),
    fetchImpl,
  })
  clients.push(http)
  const refused = expect(
    http.text('https://api.openalex.org/works', { timeoutMs: 1000 }),
  ).rejects.toThrow('HTTP 504 from api.openalex.org')
  await vi.advanceTimersByTimeAsync(6000)
  await refused
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
