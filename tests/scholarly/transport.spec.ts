import { describe, expect, it, vi } from 'vitest'
import {
  assertAllowedScholarlyUrl,
  isAllowedScholarlyHost,
  isPublicUrl,
} from '../../src/scholarly/transport/allowlist.js'
import {
  CircuitBreaker,
  ScholarlyCircuitOpenError,
} from '../../src/scholarly/transport/circuit-breaker.js'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'

describe('scholarly transport safety: allowlist', () => {
  it('identifies allowed scholarly hosts and permitted subdomains', () => {
    expect(isAllowedScholarlyHost('export.arxiv.org')).toBe(true)
    expect(isAllowedScholarlyHost('api.openalex.org')).toBe(true)
    expect(isAllowedScholarlyHost('api.crossref.org')).toBe(true)
    expect(isAllowedScholarlyHost('api.semanticscholar.org')).toBe(true)
    expect(isAllowedScholarlyHost('eutils.ncbi.nlm.nih.gov')).toBe(true)
    expect(isAllowedScholarlyHost('www.ebi.ac.uk')).toBe(true)
    expect(isAllowedScholarlyHost('dblp.org')).toBe(true)
    expect(isAllowedScholarlyHost('doi.org')).toBe(true)
    expect(isAllowedScholarlyHost('sub.arxiv.org')).toBe(true)

    expect(isAllowedScholarlyHost('google.com')).toBe(false)
    expect(isAllowedScholarlyHost('cnki.net')).toBe(false)
    expect(isAllowedScholarlyHost('127.0.0.1')).toBe(false)
    expect(isAllowedScholarlyHost('evil.arxiv.org.attacker.com')).toBe(false)
  })

  it('verifies public URLs and rejects private/loopback addresses', () => {
    expect(isPublicUrl('https://export.arxiv.org/api/query')).toBe(true)
    expect(isPublicUrl('http://api.crossref.org/works')).toBe(true)

    expect(isPublicUrl('http://127.0.0.1:23119/api')).toBe(false)
    expect(isPublicUrl('http://localhost:8080')).toBe(false)
    expect(isPublicUrl('http://192.168.1.1/router')).toBe(false)
    expect(isPublicUrl('http://10.0.0.1')).toBe(false)
    expect(isPublicUrl('http://172.16.0.1')).toBe(false)
    expect(isPublicUrl('file:///etc/passwd')).toBe(false)
    expect(isPublicUrl('not a url')).toBe(false)
  })

  it('refuses every IPv6 literal spelling, not only the canonical ones', () => {
    // A prefix blacklist cannot enumerate the spellings: WHATWG URL
    // normalizes the expanded loopback to `[::1]` but leaves the
    // dotted-quad tail, site-local, NAT64, and expanded IPv4-mapped forms
    // untouched — each resolves to loopback or a private network. The
    // whole class is refused because no legitimate scholarly or OA host
    // is an IPv6 literal.
    for (const url of [
      'http://[::]/',
      'http://[::1]/',
      'http://[0:0:0:0:0:0:0:1]/',
      'http://[::0.0.0.1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[0:0:0:0:0:ffff:127.0.0.1]/',
      'http://[fec0::1]/',
      'http://[fc00::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[64:ff9b::7f00:1]/',
    ]) {
      expect(isPublicUrl(url), url).toBe(false)
    }
    // The public-only (OA PDF) mode leans on the same guard, so a literal
    // cannot bypass the allowlist exemption either.
    expect(() => assertAllowedScholarlyUrl('http://[::0.0.0.1]/paper.pdf', true)).toThrow(
      /not a valid public HTTP/,
    )
    expect(() => assertAllowedScholarlyUrl('http://[::ffff:127.0.0.1]/paper.pdf', true)).toThrow(
      /not a valid public HTTP/,
    )
  })

  it('asserts allowed scholarly url or throws on forbidden addresses', () => {
    expect(() => assertAllowedScholarlyUrl('https://api.openalex.org/works')).not.toThrow()
    expect(() => assertAllowedScholarlyUrl('https://malicious-site.com/steal')).toThrow(
      /not on the scholarly allowlist/,
    )
    expect(() => assertAllowedScholarlyUrl('http://127.0.0.1:8080/data')).toThrow(
      /not a valid public HTTP/,
    )

    // Public-only mode allows other public addresses for OA PDFs
    expect(() =>
      assertAllowedScholarlyUrl('https://nature.com/articles/paper.pdf', true),
    ).not.toThrow()
    expect(() => assertAllowedScholarlyUrl('http://192.168.1.100/paper.pdf', true)).toThrow(
      /not a valid public HTTP/,
    )
  })

  it('never repeats the full URL in a rejection message', () => {
    // A rejection string reaches tool output; a URL can carry a credential or
    // a DOI the user is researching, so only the hostname may appear.
    const secret = 'SEKRET-KEY-123'
    expect(() => assertAllowedScholarlyUrl(`http://127.0.0.1:23119/api?api_key=${secret}`)).toThrow(
      expect.not.stringContaining(secret),
    )
    expect(() => assertAllowedScholarlyUrl(`http://127.0.0.1:23119/api?api_key=${secret}`)).toThrow(
      /127\.0\.0\.1/,
    )
  })
})

describe('scholarly transport resilience: circuit breaker', () => {
  it('manages CLOSED, OPEN, and HALF_OPEN state transitions', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 50,
      windowMs: 1000,
    })

    const host = 'api.semanticscholar.org'
    expect(breaker.getState(host)).toBe('CLOSED')

    // 2 consecutive failures do not trip
    breaker.recordFailure(host)
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('CLOSED')
    expect(() => breaker.beforeRequest(host)).not.toThrow()

    // 3rd failure trips the breaker to OPEN
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('OPEN')
    expect(() => breaker.beforeRequest(host)).toThrow(ScholarlyCircuitOpenError)

    // Wait for cooldown to expire using fake timers
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(65)
      expect(breaker.getState(host)).toBe('HALF_OPEN')
      // Half open probe succeeds
      breaker.recordSuccess(host)
      expect(breaker.getState(host)).toBe('CLOSED')
      expect(() => breaker.beforeRequest(host)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('scholarly host table is the single source', () => {
  it('paces every host the adapters actually call', async () => {
    // The regression this locks: `api.openalex.org` was unpaced while
    // `arxiv.org` was paced, even though the arXiv adapter calls
    // `export.arxiv.org`. The interval map now derives from the same table the
    // allowlist does.
    const { SCHOLARLY_HOSTS, SCHOLARLY_HOST_INTERVALS, intervalForHost } =
      await import('../../src/scholarly/transport/hosts.js')
    expect(SCHOLARLY_HOSTS.length).toBeGreaterThan(0)
    for (const entry of SCHOLARLY_HOSTS) {
      expect(SCHOLARLY_HOST_INTERVALS[entry.host]).toBe(entry.intervalMs)
      expect(intervalForHost(entry.host)).toBe(entry.intervalMs)
    }

    // Every host the adapters address must be paced, whether by its own row or
    // through a declared parent's interval (ar5iv is an arxiv.org subdomain).
    for (const host of [
      'arxiv.org',
      'export.arxiv.org',
      'ar5iv.labs.arxiv.org',
      'api.openalex.org',
      'api.crossref.org',
      'api.semanticscholar.org',
      'eutils.ncbi.nlm.nih.gov',
      'www.ebi.ac.uk',
      'dblp.org',
      'doi.org',
      'api.unpaywall.org',
    ]) {
      expect(isAllowedScholarlyHost(host), `${host} must be allowed`).toBe(true)
      expect(intervalForHost(host), `${host} must be paced`).toBeGreaterThan(0)
    }
    expect(intervalForHost('completely.unknown.domain')).toBe(0)
  })

  it('accepts declared subdomains and refuses undeclared hosts', () => {
    expect(isAllowedScholarlyHost('sub.arxiv.org')).toBe(true)
    expect(isAllowedScholarlyHost('ar5iv.labs.arxiv.org')).toBe(true)
    expect(isAllowedScholarlyHost('api.unpaywall.org')).toBe(true)
    expect(isAllowedScholarlyHost('evil.arxiv.org.attacker.com')).toBe(false)
    expect(isAllowedScholarlyHost('openalex.org.attacker.com')).toBe(false)
  })
})

describe('scholarly transport failure classification', () => {
  it('counts a 500 toward the breaker, not only 429/503', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 60_000,
      windowMs: 60_000,
    })
    const host = 'api.openalex.org'
    breaker.recordFailure(host)
    breaker.recordFailure(host)
    breaker.recordFailure(host)
    expect(breaker.getState(host)).toBe('OPEN')
  })

  it('does not reset the breaker on a redirect hop', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 60_000,
      windowMs: 60_000,
    })
    breaker.recordFailure('api.crossref.org')
    breaker.recordFailure('api.crossref.org')

    // A redirect serves a 3xx, which is neither success nor failure for health.
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://api.crossref.org/works/1' },
        }),
      circuitBreaker: breaker,
      pacer: new HostPacer({ 'api.crossref.org': 0 }),
    })
    await expect(http.bytes('https://api.crossref.org/works/0')).rejects.toThrow()
    // The two failures must still stand: a redirect did not clear them.
    breaker.recordFailure('api.crossref.org')
    expect(breaker.getState('api.crossref.org')).toBe('OPEN')
  })

  it('reports an oversized body instead of serving an empty buffer', async () => {
    const http = createScholarlyHttp({
      fetchImpl: async () => new Response(new Uint8Array(2000), { status: 200 }),
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    await expect(http.bytes('https://api.openalex.org/works', { maxBytes: 1000 })).rejects.toThrow(
      /larger than maximum allowed size/,
    )
  })

  it('clamps the default response ceiling to the shared transport bound', async () => {
    const { DEFAULT_MAX_BYTES } = await import('../../src/scholarly/transport/http.js')
    const { DEFAULT_MAX_RESPONSE_BYTES } = await import('../../src/constants.js')
    // Both transports read the same ceiling: two bounds would disagree.
    expect(DEFAULT_MAX_BYTES).toBe(DEFAULT_MAX_RESPONSE_BYTES)
  })
})

describe('scholarly transport rate limiting: HostPacer', () => {
  it('spaces requests according to configured intervals', async () => {
    vi.useFakeTimers()
    try {
      const pacer = new HostPacer({ 'test.host': 50 })
      const host = 'test.host'

      const p1 = pacer.pace(host)
      await vi.advanceTimersByTimeAsync(0)
      await p1

      const p2 = pacer.pace(host)
      await vi.advanceTimersByTimeAsync(50)
      await p2
    } finally {
      vi.useRealTimers()
    }
  })

  it('prunes expired last request times when host table outgrows cap', async () => {
    const pacer = new HostPacer({ 'h1.org': 1, 'h2.org': 1 }, 1)
    await pacer.pace('h1.org')
    const map = (pacer as unknown as { lastRequestTime: Map<string, number> }).lastRequestTime
    map.set('h1.org', Date.now() - 70_000)
    await pacer.pace('h2.org')
    expect(map.has('h1.org')).toBe(false)
    expect(map.has('h2.org')).toBe(true)
  })

  it('rejects immediately when signal is pre-aborted', async () => {
    const pacer = new HostPacer()
    const preAborted = AbortSignal.abort(new Error('pre-aborted'))
    await expect(pacer.pace('adhoc.org', preAborted)).rejects.toThrow('pre-aborted')
  })
})

describe('scholarly transport http client', () => {
  it('fetches text and json correctly when response is OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', data: [1, 2, 3] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const http = createScholarlyHttp({ fetchImpl: mockFetch })
    const result = await http.json<{ status: string; data: number[] }>(
      'https://api.crossref.org/works',
    )

    expect(result.status).toBe('ok')
    expect(result.data).toEqual([1, 2, 3])
  })

  it('rejects forbidden hosts before making outbound request', async () => {
    const mockFetch = vi.fn()
    const http = createScholarlyHttp({ fetchImpl: mockFetch })

    await expect(http.text('https://unauthorized.org/data')).rejects.toThrow(
      /not on the scholarly allowlist/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks redirects to private or loopback IP addresses (SSRF guard)', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === 'https://doi.org/10.1000/1') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1:23119/api/items' },
        })
      }
      return new Response('{}', { status: 200 })
    })

    const http = createScholarlyHttp({ fetchImpl: mockFetch })
    await expect(http.text('https://doi.org/10.1000/1')).rejects.toThrow(
      /Security rejection.*not a valid public HTTP\(S\) address/,
    )
  })

  it('follows safe external redirects up to allowed limit', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === 'https://doi.org/10.1000/target') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://api.crossref.org/works/10.1000/target' },
        })
      }
      if (url === 'https://api.crossref.org/works/10.1000/target') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    })

    const http = createScholarlyHttp({ fetchImpl: mockFetch })
    const res = await http.json<{ status: string }>('https://doi.org/10.1000/target')
    expect(res.status).toBe('ok')
  })

  it('aborts response when exceeding maxBytes', async () => {
    const largeData = new Uint8Array(2000)
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(largeData, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    )

    const http = createScholarlyHttp({ fetchImpl: mockFetch })
    await expect(http.bytes('https://api.openalex.org/works', { maxBytes: 1000 })).rejects.toThrow(
      /larger than maximum allowed size/,
    )
  })

  it('carries the host, never the request URL, on a non-2xx response', async () => {
    // The error object is handed to message formatters and callers; a URL can
    // hold an api_key or a DOI, so only the host may travel with it.
    const secret = '{{SECRET_ptp2d13j}}'
    const mockFetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    const http = createScholarlyHttp({ fetchImpl: mockFetch })

    await expect(http.text(`https://api.openalex.org/works?api_key=${secret}`)).rejects.toSatisfy(
      (error: unknown) => {
        const err = error as { host?: string; url?: string; message: string }
        expect(err.url).toBeUndefined()
        expect(err.host).toBe('api.openalex.org')
        expect(err.message).not.toContain(secret)
        return true
      },
    )
  })
})

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
    const http = createScholarlyHttp({
      maxInFlight: 3,
      fetchImpl: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      },
      pacer: new HostPacer({}),
    })

    await Promise.all(
      Array.from({ length: 12 }, (_, i) => http.json(`https://api.openalex.org/works/${i}`)),
    )
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('reports an open circuit as its own failure', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 60_000,
      windowMs: 60_000,
    })
    breaker.recordFailure('api.crossref.org')
    const http = createScholarlyHttp({
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

describe('abortableSleep', () => {
  it('resolves when the wait elapses', async () => {
    const { abortableSleep } = await import('../../src/scholarly/transport/pacing.js')
    await expect(abortableSleep(1)).resolves.toBeUndefined()
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const { abortableSleep } = await import('../../src/scholarly/transport/pacing.js')
    const controller = new AbortController()
    controller.abort(new Error('too late'))
    await expect(abortableSleep(50, controller.signal)).rejects.toThrow('too late')
  })

  it('rejects when the signal fires mid-wait and clears its timer', async () => {
    const { abortableSleep } = await import('../../src/scholarly/transport/pacing.js')
    const controller = new AbortController()
    const pending = abortableSleep(5_000, controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })
})

describe('scholarly transport redirect and header handling', () => {
  it('refuses a redirect that names no location', async () => {
    const http = createScholarlyHttp({
      fetchImpl: async () => new Response(null, { status: 302 }),
      pacer: new HostPacer({ 'doi.org': 0 }),
    })
    await expect(http.bytes('https://doi.org/10.1000/x')).rejects.toThrow(/HTTP 302 from doi\.org/)
  })

  it('stops after the redirect ceiling', async () => {
    let hops = 0
    const http = createScholarlyHttp({
      fetchImpl: async () => {
        hops += 1
        return new Response(null, {
          status: 302,
          headers: { location: `https://doi.org/10.1000/hop${hops}` },
        })
      },
      pacer: new HostPacer({ 'doi.org': 0 }),
    })
    await expect(http.bytes('https://doi.org/10.1000/start')).rejects.toThrow(/Too many redirects/)
  })

  it('sends the documented user agent and any caller headers', async () => {
    const seen: Array<Record<string, string>> = []
    const http = createScholarlyHttp({
      fetchImpl: async (_url, init) => {
        seen.push((init?.headers ?? {}) as Record<string, string>)
        return new Response('{}', { status: 200 })
      },
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    await http.bytes('https://api.openalex.org/works', { headers: { authorization: 'Bearer k' } })
    expect(seen[0]?.['user-agent']).toContain('dsh-zotero/scholarly')
    expect(seen[0]?.authorization).toBe('Bearer k')
  })

  it('honours a Retry-After header on a 429 and then succeeds', async () => {
    let calls = 0
    const http = createScholarlyHttp({
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) {
          return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } })
        }
        return new Response('ok', { status: 200 })
      },
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    await expect(
      http.bytes('https://api.openalex.org/works', { retries: 1 }),
    ).resolves.toBeDefined()
    expect(calls).toBe(2)
  })

  it('reports the retry-after seconds when it gives up on a 429', async () => {
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }),
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    await expect(http.bytes('https://api.openalex.org/works', { retries: 0 })).rejects.toThrow(
      /Rate limited by api\.openalex\.org \(retry after 120s\)/,
    )
  })

  it('reports a non-2xx that is not retryable', async () => {
    const http = createScholarlyHttp({
      fetchImpl: async () => new Response('nope', { status: 403 }),
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    await expect(http.bytes('https://api.openalex.org/works')).rejects.toThrow(/HTTP 403/)
  })
})

describe('transport failure translation', () => {
  it('surfaces a non-Error rejection rather than masking it', async () => {
    const http = createScholarlyHttp({
      fetchImpl: async () => {
        throw 'connection exploded'
      },
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    await expect(http.bytes('https://api.openalex.org/works', { retries: 0 })).rejects.toBeDefined()
  })

  it('reads a body whose stream yields a single chunk', async () => {
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok":true}'))
              controller.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      pacer: new HostPacer({ 'api.openalex.org': 0 }),
    })
    expect(await http.json<{ ok: boolean }>('https://api.openalex.org/works')).toEqual({
      ok: true,
    })
  })
})
