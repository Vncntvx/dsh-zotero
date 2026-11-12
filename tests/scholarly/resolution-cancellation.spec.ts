/**
 * Caller cancellation across the full-text route chain: whatever path the
 * resolver is on when the caller aborts, the caller's own reason must reach
 * the caller instead of the route's accumulated "no copy" story.
 *
 * The fetch boundary is scripted: a matching URL aborts the caller's
 * controller and rejects, standing in for a transfer cut off mid-flight. No
 * test opens a socket.
 * @module tests/scholarly/resolution-cancellation
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveScholarlyFullText } from '../../src/scholarly/fulltext/resolve.js'
import { createScholarlyHttp, type ScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from './fixtures.js'

interface CancellationHarness {
  readonly http: ScholarlyHttp
  readonly controller: AbortController
  readonly reason: Error
  readonly fetchImpl: ReturnType<typeof vi.fn>
}

/**
 * A transport that aborts the caller while one route is in flight and answers
 * every other route with the supplied response.
 * @param matches - whether a URL is the route that gets cancelled.
 * @param other - the response for every other route.
 * @returns the transport plus the controller and reason it aborts with.
 */
function cancellationHarness(
  matches: (url: string) => boolean,
  other: (url: string) => Response = () => new Response('missing', { status: 404 }),
): CancellationHarness {
  const controller = new AbortController()
  const reason = new Error('caller stopped the read')
  const fetchImpl = vi.fn(async (url: string) => {
    if (matches(url)) {
      controller.abort(reason)
      throw new Error('transport rejected after the caller aborted')
    }
    return other(url)
  })
  const http = createScholarlyHttp({
    fetchImpl,
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({}),
  })
  return { http, controller, reason, fetchImpl }
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

describe('scholarly full-text cancellation', () => {
  it('keeps the caller reason when the direct PDF transfer is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness((url) =>
      url.includes('example.com/paper.pdf'),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'url', id: 'https://example.com/paper.pdf' },
        { http, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })

  it('keeps the caller reason when the arXiv HTML route is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness((url) =>
      url.includes('arxiv.org/html/'),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'arxiv', id: '2403.00001' },
        { http, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })

  it('keeps the caller reason when the Europe PMC lookup is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness((url) =>
      url.includes('www.ebi.ac.uk/europepmc/webservices/rest/search'),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'doi', id: '10.1234/cancel.epmc' },
        { http, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })

  it('keeps the caller reason when the concurrent OpenAlex lookup is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness(
      (url) => url.includes('api.openalex.org'),
      (url) =>
        url.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')
          ? json({ resultList: { result: [] } })
          : new Response('missing', { status: 404 }),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'doi', id: '10.1234/cancel.openalex' },
        { http, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })

  it('keeps the caller reason when the Unpaywall lookup is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness(
      (url) => url.includes('api.unpaywall.org'),
      (url) => {
        if (url.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')) {
          return json({ resultList: { result: [] } })
        }
        if (url.includes('api.openalex.org')) return json({})
        return new Response('missing', { status: 404 })
      },
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'doi', id: '10.1234/cancel.unpaywall' },
        { http, keys: { email: 'user@example.com' }, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })

  it('keeps the caller reason when the PMC JATS transfer is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness(
      (url) => url.includes('fullTextXML'),
      (url) =>
        url.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')
          ? json({ resultList: { result: [] } })
          : new Response('missing', { status: 404 }),
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'pmcid', id: 'PMC1122334' },
        { http, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })

  it('keeps the caller reason when the Semantic Scholar fallback is cancelled', async () => {
    const { http, controller, reason } = cancellationHarness(
      (url) => url.includes('api.semanticscholar.org'),
      (url) => {
        if (url.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')) {
          return json({ resultList: { result: [] } })
        }
        if (url.includes('api.openalex.org')) return json({})
        return new Response('missing', { status: 404 })
      },
    )
    await expect(
      resolveScholarlyFullText(
        { kind: 'doi', id: '10.1234/cancel.s2' },
        { http, signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })
})
