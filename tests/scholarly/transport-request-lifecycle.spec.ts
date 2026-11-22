/**
 * The scholarly transport's request lifecycle: the status a foreign error
 * carries, a caller cancellation before dispatch or between redirect hops, and
 * a provider deadline that expires while the request waits on the pacer, on
 * DNS, or on the in-flight gate.
 *
 * Every network seam is scripted; no test opens a socket or resolves a name.
 * @module tests/scholarly/transport-request-lifecycle
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createScholarlyHttp,
  httpStatusOf,
  ScholarlyHttpError,
  type ScholarlyPublicAccess,
} from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from '../helpers/scholarly-runtime.js'
import { deferred } from '../helpers/sync.js'

describe('scholarly HTTP status extraction', () => {
  it('reads a numeric status from an error that is not a ScholarlyHttpError', () => {
    expect(httpStatusOf(new ScholarlyHttpError(503, 'api.openalex.org'))).toBe(503)
    expect(httpStatusOf({ status: 429 })).toBe(429)
    expect(httpStatusOf({ status: '429' })).toBeUndefined()
    expect(httpStatusOf(undefined)).toBeUndefined()
  })
})

describe('caller cancellation in the scholarly transport', () => {
  it('rejects a pre-aborted call with the caller reason before dispatching', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      pacer: new HostPacer({}),
      fetchImpl,
    })
    const reason = new Error('caller stopped before dispatch')
    const controller = new AbortController()
    controller.abort(reason)

    await expect(
      http.text('https://api.openalex.org/works', { signal: controller.signal }),
    ).rejects.toBe(reason)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('honours a caller abort that lands during a redirect hop', async () => {
    const reason = new Error('caller stopped mid-redirect')
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      controller.abort(reason)
      return new Response(null, {
        status: 302,
        headers: { location: 'https://api.crossref.org/works/1' },
      })
    })
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      pacer: new HostPacer({ 'doi.org': 0, 'api.crossref.org': 0 }),
      fetchImpl,
    })

    await expect(
      http.text('https://doi.org/10.1000/start', { signal: controller.signal }),
    ).rejects.toBe(reason)
    // The next hop is never requested after the caller has cancelled.
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('surfaces the caller reason when caller abort and provider deadline race', async () => {
    vi.useFakeTimers()
    try {
      // The fused signal adopts whichever reason aborted first. The deadline
      // wins the race here, and the caller aborts before the catch runs — the
      // rejection must still carry the caller's reason, not the timeout.
      const controller = new AbortController()
      const callerReason = new Error('caller stopped at the deadline edge')
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              controller.abort(callerReason)
              reject((init!.signal as AbortSignal).reason)
            },
            { once: true },
          )
        })
        return new Response('%PDF-1.4 body', { status: 200 })
      })
      const http = createScholarlyHttp({
        publicAccess: stubPublicAccess,
        pacer: new HostPacer({}),
        fetchImpl,
      })

      const request = http.bytes('https://example.com/paper.pdf', {
        allowPublicPdf: true,
        timeoutMs: 10,
        signal: controller.signal,
      })
      const settled = expect(request).rejects.toBe(callerReason)
      await vi.advanceTimersByTimeAsync(10)
      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a redirect that echoes a query credential onto another origin', async () => {
    // NCBI's only accepted credential form rides the query (?api_key=); a
    // redirect that replays it cross-origin would leak it onward.
    const fetchImpl = vi.fn(async () =>
      Response.redirect('https://api.crossref.org/works/1?api_key=sekrit', 302),
    )
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      pacer: new HostPacer({ 'doi.org': 0, 'api.crossref.org': 0 }),
      fetchImpl,
    })

    await expect(
      http.text('https://doi.org/10.1000/start?api_key=sekrit', { retries: 0 }),
    ).rejects.toThrow(/Query-credentialed redirects/)
    // The leaking hop is never dispatched.
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('keeps a redirect that drops the query credential, or stays on origin', async () => {
    // Cross-origin without the echoed credential proceeds; the second hop
    // answers normally.
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('doi.org')
        ? Response.redirect('https://api.crossref.org/works/1', 302)
        : new Response('{}', { status: 200 }),
    )
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      pacer: new HostPacer({ 'doi.org': 0, 'api.crossref.org': 0 }),
      fetchImpl,
    })
    await expect(http.text('https://doi.org/10.1000/start?api_key=sekrit')).resolves.toBe('{}')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Same-origin echo is not a leak: the credential never changes hands.
    const sameOrigin = vi.fn(async (url: string) =>
      String(url).includes('start')
        ? Response.redirect('https://doi.org/10.1000/other?api_key=sekrit', 302)
        : new Response('{}', { status: 200 }),
    )
    const http2 = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      pacer: new HostPacer({ 'doi.org': 0 }),
      fetchImpl: sameOrigin,
    })
    await expect(http2.text('https://doi.org/10.1000/start?api_key=sekrit')).resolves.toBe('{}')
    expect(sameOrigin).toHaveBeenCalledTimes(2)
  })

  it('leaves the in-flight gate without dispatching when the caller aborts', async () => {
    const firstStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    const secondPaced = deferred<void>()
    const releaseSecondPace = deferred<void>()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('api.crossref.org')) {
        firstStarted.resolve()
        await releaseFirst.promise
      }
      return new Response('{}', { status: 200 })
    })
    let paced = 0
    const pacer = {
      pace: async (): Promise<void> => {
        paced += 1
        if (paced === 1) return
        secondPaced.resolve()
        await releaseSecondPace.promise
      },
    } as unknown as HostPacer
    const http = createScholarlyHttp({
      publicAccess: stubPublicAccess,
      pacer,
      maxInFlight: 1,
      fetchImpl,
    })

    const first = http.text('https://api.crossref.org/works/1')
    await firstStarted.promise
    const controller = new AbortController()
    const queued = http.text('https://api.openalex.org/works/2', { signal: controller.signal })
    const settled = expect(queued).rejects.toThrow('aborted while waiting for a slot')

    await secondPaced.promise
    controller.abort(new Error('caller stopped while queued'))
    releaseSecondPace.resolve()
    await settled
    expect(fetchImpl).toHaveBeenCalledOnce()

    releaseFirst.resolve()
    await expect(first).resolves.toBe('{}')
  })
})

describe('provider deadlines while a request waits for admission', () => {
  it('reports a pacer wait that outlives the deadline as a gateway timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
      // The pacer holds until the fused deadline aborts; the transport must
      // classify that abort as its own timeout, not as a generic failure.
      const pacer = {
        pace: (_host: string, signal?: AbortSignal): Promise<void> =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      } as unknown as HostPacer
      const http = createScholarlyHttp({ publicAccess: stubPublicAccess, pacer, fetchImpl })
      const request = http.text('https://api.openalex.org/works', { timeoutMs: 10 })
      const settled = expect(request).rejects.toThrow(/HTTP 504 from api\.openalex\.org/)

      await vi.advanceTimersByTimeAsync(10)
      await settled
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a DNS resolution that outlives the deadline as a gateway timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(async () => new Response('%PDF-1.4 body', { status: 200 }))
      const resolverStarted = deferred<void>()
      const publicAccess: ScholarlyPublicAccess = {
        resolver: (_hostname, signal) => {
          resolverStarted.resolve()
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      }
      const http = createScholarlyHttp({ publicAccess, pacer: new HostPacer({}), fetchImpl })
      const request = http.bytes('https://example.com/paper.pdf', {
        allowPublicPdf: true,
        timeoutMs: 10,
      })
      const settled = expect(request).rejects.toThrow(/HTTP 504 from example\.com/)

      await resolverStarted.promise
      await vi.advanceTimersByTimeAsync(10)
      await settled
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a gate wait that outlives the deadline as a gateway timeout', async () => {
    vi.useFakeTimers()
    try {
      const firstStarted = deferred<void>()
      const releaseFirst = deferred<void>()
      const fetchImpl = vi.fn(async (url: string) => {
        if (String(url).includes('api.crossref.org')) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        return new Response('{}', { status: 200 })
      })
      const http = createScholarlyHttp({
        publicAccess: stubPublicAccess,
        pacer: new HostPacer({ 'api.crossref.org': 0, 'api.openalex.org': 0 }),
        maxInFlight: 1,
        fetchImpl,
      })

      const first = http.text('https://api.crossref.org/works/1')
      await firstStarted.promise
      // The only slot is held, so this request can only wait on the gate.
      const second = http.text('https://api.openalex.org/works/2', {
        timeoutMs: 10,
        retries: 0,
      })
      const settled = expect(second).rejects.toThrow(/HTTP 504 from api\.openalex\.org/)

      await vi.advanceTimersByTimeAsync(10)
      await settled
      expect(fetchImpl).toHaveBeenCalledOnce()

      releaseFirst.resolve()
      await expect(first).resolves.toBe('{}')
    } finally {
      vi.useRealTimers()
    }
  })
})
