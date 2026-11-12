/**
 * Full-text route fallbacks beyond the happy path: the arXiv PDF arm when both
 * HTML routes are unusable, PMC JATS without an article body, Europe PMC's own
 * PDF candidate, an OpenAlex record that names no copy, an arXiv PDF candidate
 * discovered later in the chain, and a cached PDF that expired and then failed
 * to refetch.
 *
 * The transport is scripted per route; the PDF fixture is a minimal document
 * with a text layer above the resolver's 500-character floor.
 * @module tests/scholarly/resolution-route-fallbacks
 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FulltextEnhancer, FulltextLookupResult } from '../../src/local/fulltext-enhancer.js'
import { resolveScholarlyFullText } from '../../src/scholarly/fulltext/resolve.js'
import { ScholarlyTextStore } from '../../src/scholarly/fulltext/store.js'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import { stubPublicAccess } from './fixtures.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A one-page PDF whose text layer clears the resolver's minimum. */
function readablePdf(): string {
  const stream =
    'BT /F1 12 Tf 72 712 Td ' + '(Readable fallback PDF text ) Tj T* '.repeat(24) + ' ET'
  return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj\ntrailer<</Size 5/Root 1 0 R>>\n%%EOF`
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

const pdf = (): Response =>
  new Response(Buffer.from(readablePdf()), { headers: { 'content-type': 'application/pdf' } })

/**
 * A transport answering by URL substring and recording every request.
 * @param routes - substring to response builder, in match order.
 * @param seen - collects every requested URL.
 * @returns the transport and the request log.
 */
function routed(routes: Array<[string, () => Response]>, seen: string[] = []) {
  const http = createScholarlyHttp({
    publicAccess: stubPublicAccess,
    pacer: new HostPacer({}),
    fetchImpl: async (url) => {
      const value = String(url)
      seen.push(value)
      for (const [needle, build] of routes) if (value.includes(needle)) return build()
      return new Response('missing', { status: 404 })
    },
  })
  return { http, seen }
}

const articleHtml = `<article class="ltx_document"><h1>Preprint Copy</h1><p>${'Detailed treatment of the discovered preprint. '.repeat(20)}</p></article>`

it('resolves an arXiv identifier through the PDF when both HTML routes lack an article body', async () => {
  const { http } = routed([
    ['ar5iv.labs.arxiv.org', () => new Response('<html><body>no article body</body></html>')],
    ['arxiv.org/html/', () => new Response('<html><body>no article body</body></html>')],
    ['arxiv.org/pdf/', pdf],
  ])

  const record = await resolveScholarlyFullText({ kind: 'arxiv', id: '2403.00001' }, { http })

  expect(record).toMatchObject({
    provider: 'pdf-extract',
    format: 'text',
    source: 'the arXiv PDF',
    sourceIdentity: 'https://arxiv.org/pdf/2403.00001',
  })
  expect(record.text).toContain('[page 1]')
})

it('names JATS XML without an article body before reporting no open copy', async () => {
  const { http } = routed([
    [
      'fullTextXML',
      () =>
        new Response('<article><front><article-title>No Body</article-title></front></article>', {
          headers: { 'content-type': 'application/xml' },
        }),
    ],
    ['www.ebi.ac.uk/europepmc/webservices/rest/search', () => json({ resultList: { result: [] } })],
  ])

  const pending = resolveScholarlyFullText({ kind: 'pmcid', id: 'PMC5550000' }, { http })
  await expect(pending).rejects.toThrow(
    /No open-access full text found for PMC5550000[\s\S]*JATS XML carried no article body/,
  )
})

it('tries the Europe PMC PDF URL as an open-access candidate', async () => {
  const { http, seen } = routed([
    [
      'www.ebi.ac.uk/europepmc/webservices/rest/search',
      () =>
        json({
          resultList: {
            result: [
              {
                id: '1',
                source: 'MED',
                title: 'A Europe PMC record',
                fullTextUrlList: {
                  fullTextUrl: [
                    {
                      documentStyle: 'pdf',
                      availabilityCode: 'OA',
                      url: 'https://repo.example.org/epmc.pdf',
                    },
                  ],
                },
              },
            ],
          },
        }),
    ],
    ['api.openalex.org', () => new Response('missing', { status: 404 })],
    ['repo.example.org/epmc.pdf', pdf],
  ])

  const record = await resolveScholarlyFullText({ kind: 'doi', id: '10.1234/epmc-pdf' }, { http })

  expect(record.provider).toBe('pdf-extract')
  expect(record.source).toBe('an open-access PDF (found via Europe PMC)')
  expect(seen).toContain('https://repo.example.org/epmc.pdf')
})

it('does not invent a preprint when OpenAlex names neither an arXiv id nor a PDF', async () => {
  const { http, seen } = routed([
    ['www.ebi.ac.uk/europepmc/webservices/rest/search', () => json({ resultList: { result: [] } })],
    [
      'api.openalex.org/works/doi%3A',
      () => json({ id: 'https://openalex.org/W1', display_name: 'No copies' }),
    ],
    ['api.semanticscholar.org', () => new Response('{}', { status: 404 })],
  ])

  await expect(
    resolveScholarlyFullText({ kind: 'doi', id: '10.1234/no-copy' }, { http }),
  ).rejects.toThrow(/No open-access full text found/)
  expect(seen.some((url) => url.includes('arxiv.org'))).toBe(false)
  expect(seen.some((url) => url.includes('api.semanticscholar.org'))).toBe(true)
})

it('escalates an arXiv PDF named by Europe PMC and names the discovery route', async () => {
  const { http } = routed([
    [
      'www.ebi.ac.uk/europepmc/webservices/rest/search',
      () =>
        json({
          resultList: {
            result: [
              {
                id: '2',
                source: 'PPR',
                title: 'A preprint record',
                fullTextUrlList: {
                  fullTextUrl: [
                    {
                      documentStyle: 'pdf',
                      availabilityCode: 'OA',
                      url: 'https://arxiv.org/pdf/2404.00002',
                    },
                  ],
                },
              },
            ],
          },
        }),
    ],
    ['api.openalex.org', () => new Response('missing', { status: 404 })],
    ['arxiv.org/html/2404.00002', () => new Response(articleHtml)],
  ])

  const record = await resolveScholarlyFullText({ kind: 'doi', id: '10.1234/epmc-arxiv' }, { http })

  expect(record.provider).toBe('arxiv-html')
  expect(record.source).toBe("arXiv's HTML version (LaTeXML) (found via Europe PMC)")
})

it('names only the failure reason when a refetched cached PDF has an empty transport message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scholarly-expired-'))
  tempDirs.push(root)
  const store = new ScholarlyTextStore(root)
  const url = 'https://repo.example.org/cached.pdf'
  await store.set(`url-${url}`, {
    provider: 'pdf-extract',
    format: 'text',
    text: 'the previous extraction',
    source: 'PDF copy',
    url,
    sourceIdentity: url,
  })
  const lookup = vi.fn<FulltextEnhancer['lookup']>(async () => ({
    kind: 'miss',
    reason: 'expired',
  }))
  const { http, seen } = routed([
    [
      'repo.example.org/cached.pdf',
      () => {
        throw new Error('')
      },
    ],
  ])

  await expect(
    resolveScholarlyFullText({ kind: 'url', id: url }, { http, store, enhancer: { lookup } }),
  ).rejects.toThrowError(new Error('The cached PDF source did not yield readable text (fetch).'))
  expect(lookup).toHaveBeenCalledExactlyOnceWith(
    { key: url, source: { kind: 'url', url }, contentType: 'application/pdf' },
    undefined,
  )
  expect(seen.filter((requested) => requested === url)).toHaveLength(1)
})

it('refetches a cached PDF source whose artifact is absent and whose text was never stored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scholarly-pointer-'))
  tempDirs.push(root)
  const store = new ScholarlyTextStore(root)
  const url = 'https://repo.example.org/pointer.pdf'
  const artifact: FulltextLookupResult = {
    kind: 'hit',
    text: '# Artifact\n\nVerified PDF source.',
    format: 'markdown',
    source: 'MinerU (free)',
    provenance: {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'artifact',
      fingerprint: 'a'.repeat(64),
      sourceId: 'b'.repeat(64),
      generation: '24e3e1af-1b8e-4da3-933d-0139d6f748bf',
    },
  }
  const lookup = vi
    .fn<FulltextEnhancer['lookup']>()
    .mockResolvedValueOnce(artifact)
    .mockResolvedValueOnce({ kind: 'miss', reason: 'absent' })
  const { http, seen } = routed([['repo.example.org/pointer.pdf', pdf]])

  const first = await resolveScholarlyFullText(
    { kind: 'url', id: url },
    { http, store, enhancer: { lookup } },
  )
  expect(first.provider).toBe('mineru')

  const second = await resolveScholarlyFullText(
    { kind: 'url', id: url },
    { http, store, enhancer: { lookup } },
  )
  expect(second.provider).toBe('pdf-extract')
  expect(second.text).toContain('[page 1]')
  expect(lookup).toHaveBeenCalledTimes(2)
  expect(seen.filter((requested) => requested === url)).toHaveLength(1)
})

it('names a PMC JATS transport failure while the copy may still exist', async () => {
  const { http } = routed([
    ['fullTextXML', () => new Response('upstream exploded', { status: 500 })],
    ['www.ebi.ac.uk/europepmc/webservices/rest/search', () => json({ resultList: { result: [] } })],
  ])

  await expect(
    resolveScholarlyFullText({ kind: 'pmcid', id: 'PMC7777000' }, { http }),
  ).rejects.toThrow(
    /No open-access full text found for PMC7777000[\s\S]*PMC full text \(PMC7777000\): HTTP 500 from www\.ebi\.ac\.uk/,
  )
})

it('names an arXiv candidate that failed every route via its discovery source', async () => {
  const { http } = routed([
    [
      'www.ebi.ac.uk/europepmc/webservices/rest/search',
      () =>
        json({
          resultList: {
            result: [
              {
                id: '3',
                source: 'PPR',
                title: 'A failed preprint record',
                fullTextUrlList: {
                  fullTextUrl: [
                    {
                      documentStyle: 'pdf',
                      availabilityCode: 'OA',
                      url: 'https://arxiv.org/pdf/2405.00003',
                    },
                  ],
                },
              },
            ],
          },
        }),
    ],
    ['api.openalex.org', () => new Response('missing', { status: 404 })],
  ])

  await expect(
    resolveScholarlyFullText({ kind: 'doi', id: '10.1234/epmc-arxiv-fail' }, { http }),
  ).rejects.toThrow(/arXiv:2405\.00003 via Europe PMC/)
})
