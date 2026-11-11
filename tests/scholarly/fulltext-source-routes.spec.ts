/** Source-route priority and exact PDF targets across scholarly cache reads. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { FulltextEnhancer, FulltextLookupResult } from '../../src/local/fulltext-enhancer.ts'
import { resolveScholarlyFullText } from '../../src/scholarly/fulltext/resolve.ts'
import { ScholarlyTextStore } from '../../src/scholarly/fulltext/store.ts'
import { createMockHttp } from './fixtures.ts'

const resources: Array<{ store: ScholarlyTextStore; http: ReturnType<typeof createMockHttp> }> = []
afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ store, http }) => {
      store.dispose()
      await http.dispose()
      await rm(store.root, { recursive: true, force: true })
    }),
  )
})

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

async function harness(handler: (url: string) => Response) {
  const fetch = vi.fn(handler)
  const http = createMockHttp(fetch)
  const store = new ScholarlyTextStore(await mkdtemp(join(tmpdir(), 'scholarly-routes-')))
  resources.push({ http, store })
  const lookup = vi.fn<FulltextEnhancer['lookup']>(async () => artifact)
  return { http, store, fetch, enhancer: { lookup } }
}

const filler = 'Source route retains its original article headings and detailed evidence. '.repeat(
  12,
)
const html = `<article><h1>1. Introduction</h1><p>${filler}</p><h2>2. Methods</h2><p>${filler}</p></article>`
const xml = `<article><front><article-meta><article-title>Article</article-title></article-meta></front><body><sec><title>1. Methods</title><p>${filler}</p></sec></body></article>`

it.each([
  { provider: 'arxiv-html', winningUrl: 'https://arxiv.org/html/2301.07041' },
  { provider: 'ar5iv-html', winningUrl: 'https://ar5iv.labs.arxiv.org/html/2301.07041' },
])(
  'keeps $provider ahead of the PDF artifact route on fresh and cached reads',
  async ({ provider, winningUrl }) => {
    const { http, store, fetch, enhancer } = await harness((url) =>
      url === winningUrl ? new Response(html) : new Response('missing', { status: 404 }),
    )
    const record = await resolveScholarlyFullText(
      { kind: 'arxiv', id: '2301.07041' },
      { http, store, enhancer },
    )
    expect(record).toMatchObject({ provider, format: 'markdown', sourceIdentity: winningUrl })
    expect(record.text).toContain('## 2. Methods')
    const count = fetch.mock.calls.length
    expect(
      await resolveScholarlyFullText(
        { kind: 'arxiv', id: '2301.07041' },
        { http, store: new ScholarlyTextStore(store.root), enhancer },
      ),
    ).toEqual(record)
    expect(fetch).toHaveBeenCalledTimes(count)
    expect(enhancer.lookup).not.toHaveBeenCalled()
  },
)

it('keeps PMC JATS ahead of PDF artifacts and preserves its Markdown cache record', async () => {
  const { http, store, fetch, enhancer } = await harness((url) => {
    if (url.includes('/PMC12345/fullTextXML')) return new Response(xml)
    return new Response(JSON.stringify({ resultList: { result: [] } }), {
      headers: { 'content-type': 'application/json' },
    })
  })
  const record = await resolveScholarlyFullText(
    { kind: 'pmcid', id: 'PMC12345' },
    { http, store, enhancer },
  )
  expect(record).toMatchObject({
    provider: 'pmc-jats',
    format: 'markdown',
    sourceIdentity: 'https://europepmc.org/article/PMC/PMC12345',
  })
  expect(record.text).toContain('## 1. Methods')
  const count = fetch.mock.calls.length
  expect(
    await resolveScholarlyFullText(
      { kind: 'pmcid', id: 'PMC12345' },
      { http, store: new ScholarlyTextStore(store.root), enhancer },
    ),
  ).toEqual(record)
  expect(fetch).toHaveBeenCalledTimes(count)
  expect(enhancer.lookup).not.toHaveBeenCalled()
})

it('evicts a cached direct-URL body whose source query differs from the request', async () => {
  const requested = 'https://repo.example.org/a.pdf?copy=one'
  const other = 'https://repo.example.org/a.pdf?copy=two'
  const { http, store, enhancer } = await harness(() => {
    throw new Error('artifact hit must not download')
  })
  await store.set(`url-${requested}`, {
    provider: 'pdf-extract',
    format: 'text',
    text: 'body from another query',
    source: 'PDF',
    url: other,
    sourceIdentity: other,
  })
  const result = await resolveScholarlyFullText(
    { kind: 'url', id: requested },
    { http, store, enhancer },
  )
  expect(result).toMatchObject({ provider: 'mineru', sourceIdentity: requested })
  expect(enhancer.lookup).toHaveBeenCalledExactlyOnceWith(
    { key: requested, source: { kind: 'url', url: requested }, contentType: 'application/pdf' },
    undefined,
  )
})

it('revalidates the exact discovered PDF URL for a cached DOI without repeating discovery', async () => {
  const pdfUrl = 'https://repo.example.org/a.pdf?copy=one'
  const { http, store, fetch, enhancer } = await harness((url) => {
    const body = url.includes('api.openalex.org')
      ? {
          id: 'https://openalex.org/W1',
          display_name: 'Article',
          best_oa_location: { pdf_url: `${pdfUrl}#page=3` },
        }
      : { resultList: { result: [] } }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  })
  const target = { kind: 'doi' as const, id: '10.1234/exact-source' }
  await resolveScholarlyFullText(target, { http, store, enhancer })
  const count = fetch.mock.calls.length
  const current = await resolveScholarlyFullText(target, {
    http,
    store: new ScholarlyTextStore(store.root),
    enhancer,
  })
  expect(current).toMatchObject({
    provider: 'mineru',
    format: 'markdown',
    url: pdfUrl,
    sourceIdentity: pdfUrl,
  })
  expect(enhancer.lookup).toHaveBeenCalledTimes(2)
  for (const call of enhancer.lookup.mock.calls) {
    expect(call).toEqual([
      { key: pdfUrl, source: { kind: 'url', url: pdfUrl }, contentType: 'application/pdf' },
      undefined,
    ])
  }
  expect(fetch).toHaveBeenCalledTimes(count)
})
