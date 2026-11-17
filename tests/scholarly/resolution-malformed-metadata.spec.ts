/** Bad index metadata and conversion failures remain local to their fulltext route. */
import { afterEach, expect, it, vi } from 'vitest'
import { resolveScholarlyFullText } from '../../src/scholarly/fulltext/resolve.js'
import * as markup from '../../src/scholarly/fulltext/markup.js'
import { decodeEntities } from '../../src/scholarly/sources/helpers.js'
import type { FulltextEnhancer } from '../../src/local/fulltext-enhancer.js'
import { createMockHttp } from '../helpers/scholarly-runtime.js'

afterEach(() => {
  vi.restoreAllMocks()
})
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })
const goodPdf = 'https://repository.example/fulltext.pdf'
const enhancer: FulltextEnhancer = {
  lookup: async () => ({
    kind: 'hit',
    format: 'markdown',
    text: '# Committed artifact\n\nVerified source content.',
    source: 'MinerU (free)',
    sourceKind: 'url',
    sourceLabel: 'https://repository.example',
    provenance: {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'artifact',
      fingerprint: 'a'.repeat(64),
      sourceId: 'b'.repeat(64),
      generation: '24e3e1af-1b8e-4da3-933d-0139d6f748bf',
    },
  }),
}
function metadataHttp(validAlternative: boolean, seen: string[]) {
  return createMockHttp((url) => {
    seen.push(url)
    if (url.includes('europepmc/webservices/rest/search'))
      return json({
        resultList: {
          result: [
            {
              id: '12345678',
              source: 'MED',
              title: 'A matching record',
              fullTextUrlList: {
                fullTextUrl: [
                  { documentStyle: 'pdf', availabilityCode: 'OA', url: 'ftp://broken/epmc.pdf' },
                ],
              },
            },
          ],
        },
      })
    if (url.includes('api.openalex.org'))
      return json({
        id: 'https://openalex.org/W123',
        display_name: 'A matching record',
        best_oa_location: { pdf_url: 'relative/path.pdf' },
      })
    if (url.includes('api.unpaywall.org'))
      return json({
        best_oa_location: {
          url_for_pdf: validAlternative ? goodPdf : 'ftp://broken/unpaywall.pdf',
        },
      })
    if (url.includes('api.semanticscholar.org'))
      return json({
        paperId: 'record',
        title: 'A matching record',
        openAccessPdf: { url: 'ftp://broken/s2.pdf' },
      })
    throw new Error(`Unexpected document request: ${url}`)
  })
}

it('rejects malformed PDF metadata without losing a later usable source', async () => {
  const seen: string[] = []
  const lookup = vi.spyOn(enhancer, 'lookup')
  const record = await resolveScholarlyFullText(
    { kind: 'doi', id: '10.1234/bad-metadata' },
    {
      http: metadataHttp(true, seen),
      keys: { email: 'test@example.com' },
      enhancer,
    },
  )
  expect(record.url).toBe(goodPdf)
  expect(record.text).toContain('Verified source content')
  expect(lookup).toHaveBeenCalledOnce()
  expect(lookup.mock.calls[0]?.[0].source).toEqual({ kind: 'url', url: goodPdf })
  expect(seen.some((url) => url.startsWith('ftp:'))).toBe(false)
})

it('retains every invalid candidate reason in the classified no-fulltext error', async () => {
  const seen: string[] = []
  const failure = await resolveScholarlyFullText(
    { kind: 'doi', id: '10.1234/bad-metadata' },
    {
      http: metadataHttp(false, seen),
      keys: { email: 'test@example.com' },
    },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toMatchObject({ code: 'ZOTERO_SCHOLARLY_NO_FULLTEXT' })
  expect(String(failure)).toContain('Europe PMC: invalid URL')
  expect(String(failure)).toContain('OpenAlex: invalid URL')
  expect(String(failure)).toContain('Unpaywall: invalid URL')
  expect(String(failure)).toContain('Semantic Scholar: invalid URL')
})

it('preserves an explicit artifact permission failure instead of hiding it as a route miss', async () => {
  const error = new Error('Artifact permission denied')
  await expect(
    resolveScholarlyFullText(
      { kind: 'doi', id: '10.1234/bad-metadata' },
      {
        http: metadataHttp(true, []),
        keys: { email: 'test@example.com' },
        enhancer: { lookup: async () => ({ kind: 'fault', error }) },
      },
    ),
  ).rejects.toBe(error)
})

it('tries ar5iv after an arXiv conversion failure', async () => {
  vi.spyOn(markup, 'arxivHtmlToMarkdown').mockImplementationOnce(() => {
    throw new Error('Malformed article')
  })
  const seen: string[] = []
  const record = await resolveScholarlyFullText(
    { kind: 'arxiv', id: '2301.07041' },
    {
      http: createMockHttp((url) => {
        seen.push(url)
        return new Response(`<article><p>${'Readable article. '.repeat(60)}</p></article>`)
      }),
    },
  )
  expect(record.provider).toBe('ar5iv-html')
  expect(seen.map((url) => new URL(url).hostname)).toEqual(['arxiv.org', 'ar5iv.labs.arxiv.org'])
})

it('converts invalid Unicode numeric entities to replacement characters in JATS', async () => {
  const record = await resolveScholarlyFullText(
    { kind: 'pmcid', id: 'PMC1234567' },
    {
      http: createMockHttp((url) =>
        url.includes('fullTextXML')
          ? new Response(
              `<article><body><p>${'Readable XML. '.repeat(60)}&#x110000;&#55296;&#0;</p></body></article>`,
            )
          : json({ resultList: { result: [] } }),
      ),
    },
  )
  expect(record.provider).toBe('pmc-jats')
  expect(record.text).toContain('\uFFFD\uFFFD\uFFFD')
  expect(decodeEntities('&#x1F600; &#65; &#99999999999999999999999999;')).toBe('😀 A �')
})
