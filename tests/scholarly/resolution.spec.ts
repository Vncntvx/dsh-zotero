/**
 * Full-text resolution: identifier parsing, PDF extraction, and the ordered
 * route chain (arXiv HTML, ar5iv, PMC JATS, open-access PDFs).
 *
 * Fixtures shared with the markup/store specs live in their own files; this one
 * covers only what a resolver failure has to say.
 *
 * @module tests/scholarly/resolution
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScholarlyTextStore } from '../../src/scholarly/fulltext/store.js'
import { extractPdfText } from '../../src/scholarly/fulltext/markup.js'
import {
  parsePaperIdentifier,
  resolveScholarlyFullText,
} from '../../src/scholarly/fulltext/resolve.js'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'scholarly-resolution-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('paper identifier parser', () => {
  it('parses arXiv IDs in various formats', () => {
    expect(parsePaperIdentifier('2301.07041')).toEqual({ kind: 'arxiv', id: '2301.07041' })
    expect(parsePaperIdentifier('arxiv:2301.07041v2')).toEqual({ kind: 'arxiv', id: '2301.07041' })
    expect(parsePaperIdentifier('https://arxiv.org/abs/2301.07041')).toEqual({
      kind: 'arxiv',
      id: '2301.07041',
    })
    expect(parsePaperIdentifier('math.PR/0501001')).toEqual({
      kind: 'arxiv',
      id: 'math.PR/0501001',
    })
  })

  it('parses DOIs correctly', () => {
    expect(parsePaperIdentifier('10.1145/3377811.3380356')).toEqual({
      kind: 'doi',
      id: '10.1145/3377811.3380356',
    })
    expect(parsePaperIdentifier('doi:10.1038/nature12373')).toEqual({
      kind: 'doi',
      id: '10.1038/nature12373',
    })
    expect(parsePaperIdentifier('https://doi.org/10.1038/nature12373')).toEqual({
      kind: 'doi',
      id: '10.1038/nature12373',
    })
  })

  it('parses PubMed and Europe PMC IDs', () => {
    expect(parsePaperIdentifier('pmid:34567890')).toEqual({ kind: 'pmid', id: '34567890' })
    expect(parsePaperIdentifier('pmcid:PMC8765432')).toEqual({ kind: 'pmcid', id: 'PMC8765432' })
    expect(parsePaperIdentifier('PMC8765432')).toEqual({ kind: 'pmcid', id: 'PMC8765432' })
  })

  it('parses generic URLs', () => {
    expect(parsePaperIdentifier('https://example.com/preprint.pdf')).toEqual({
      kind: 'url',
      id: 'https://example.com/preprint.pdf',
    })
  })
})

describe('PDF text extraction & fulltext resolution', () => {
  const minimalPdf =
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 72 712 Td (Hello World Test) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000219 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n313\n%%EOF'

  it('extracts plain text from valid PDF buffer', async () => {
    const text = await extractPdfText(new Uint8Array(Buffer.from(minimalPdf)))
    expect(text).toContain('[page 1]')
  })

  it('resolves fulltext for arXiv HTML paper', async () => {
    const dummyParagraph =
      'This is a detailed analysis of neural transformer architectures under extreme constraints. '.repeat(
        6,
      )
    const arxivHtml = `<!DOCTYPE html><html><body><article class="ltx_document"><h1>Arxiv Test</h1><p>${dummyParagraph}</p></article></body></html>`

    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('arxiv.org/html/2301.07041')) {
          return new Response(arxivHtml, { headers: { 'content-type': 'text/html' } })
        }
        return new Response('Not found', { status: 404 })
      },
    })

    const store = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-resolve-')))
    const target = parsePaperIdentifier('2301.07041')!
    const res = await resolveScholarlyFullText(target, { http: mockHttp, store })
    expect(res).toBeDefined()
    expect(res.source).toContain('arXiv')
    expect(res.text).toContain('# Arxiv Test')
  })

  it('resolves fulltext for Europe PMC JATS XML paper', async () => {
    const filler =
      'The biological efficacy of mRNA vaccines has been extensively examined across diverse demographic cohorts worldwide. '.repeat(
        5,
      )
    const xml = `<article><front><article-meta><article-title>PMC Title</article-title></article-meta></front><body><sec><title>Intro</title><p>${filler}</p></sec></body></article>`

    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('PMC12345/fullTextXML')) {
          return new Response(xml, { headers: { 'content-type': 'application/xml' } })
        }
        return new Response('Not found', { status: 404 })
      },
    })

    const store = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-resolve-')))
    const target = parsePaperIdentifier('PMC12345')!
    const res = await resolveScholarlyFullText(target, { http: mockHttp, store })
    expect(res).toBeDefined()
    expect(res.source).toContain('PMC')
    expect(res.text).toContain('# PMC Title')
  })

  it('resolves direct PDF URL', async () => {
    const streamContent =
      'BT /F1 12 Tf 72 712 Td ' +
      '(Hello World Testing Long Text In PDF Article ) Tj T* '.repeat(20) +
      ' ET'
    const longPdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length ${streamContent.length}>>stream\n${streamContent}\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000219 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n${300 + streamContent.length}\n%%EOF`

    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.endsWith('.pdf')) {
          return new Response(Buffer.from(longPdf), {
            headers: { 'content-type': 'application/pdf' },
          })
        }
        return new Response('Not found', { status: 404 })
      },
    })

    const store = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-resolve-')))
    const target = parsePaperIdentifier('https://example.com/test.pdf')!
    const res = await resolveScholarlyFullText(target, { http: mockHttp, store })
    expect(res).toBeDefined()
    expect(res.source).toContain('PDF')
    expect(res.text).toContain('[page 1]')
  })
})

describe('scholarly full-text resolution failure reporting', () => {
  /**
   * A resolver harness with every scholarly host pointed at one handler.
   * @param handler - the response per requested URL.
   * @returns the transport.
   */
  function httpOf(
    handler: (url: string) => Response | Promise<Response>,
  ): ReturnType<typeof createScholarlyHttp> {
    return createScholarlyHttp({
      fetchImpl: async (url) => handler(String(url)),
      pacer: new HostPacer({}),
    })
  }

  it('names every arXiv route that failed instead of claiming a paywall', async () => {
    // All three routes fail; the error must enumerate them.
    const http = httpOf(() => new Response('missing', { status: 404 }))
    const target = parsePaperIdentifier('2301.07041')!
    await expect(resolveScholarlyFullText(target, { http })).rejects.toThrow(
      /Tried: .*arXiv's HTML version.*ar5iv.*arXiv PDF/s,
    )
  })

  it('reports a URL that is not a PDF by its reason', async () => {
    const http = httpOf(() => new Response('<html>not a pdf</html>', { status: 200 }))
    const target = parsePaperIdentifier('https://example.com/paper.pdf')!
    await expect(resolveScholarlyFullText(target, { http })).rejects.toThrow(/not-a-pdf/)
  })

  it('reports a PDF with no extractable text by its reason', async () => {
    // A structurally valid PDF whose text layer is empty.
    const emptyPdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF'
    const http = httpOf(() => new Response(Buffer.from(emptyPdf), { status: 200 }))
    const target = parsePaperIdentifier('https://example.com/blank.pdf')!
    await expect(resolveScholarlyFullText(target, { http })).rejects.toThrow(/too-short|parse/)
  })

  it('records a cache write failure without failing the read it served', async () => {
    // A store whose root cannot be created: the text is already in hand.
    const blockerDir = mkdtempSync(join(tmpdir(), 'scholarly-block-'))
    const blocker = join(blockerDir, 'file')
    await writeFile(blocker, 'x', 'utf8')
    const store = new ScholarlyTextStore(join(blocker, 'nested'))

    const html = `<!DOCTYPE html><html><body><article class="ltx_document"><h1>Cache Test</h1><p>${'Substantive analysis of transformer architectures. '.repeat(20)}</p></article></body></html>`
    const http = httpOf((url) => {
      if (url.includes('arxiv.org/html/')) {
        return new Response(html, { headers: { 'content-type': 'text/html' } })
      }
      return new Response('nope', { status: 404 })
    })

    const target = parsePaperIdentifier('2301.07041')!
    const record = await resolveScholarlyFullText(target, { http, store })
    expect(record.text).toContain('# Cache Test')
  })

  it('treats a corrupt cache entry as a reason and re-fetches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scholarly-corrupt-'))
    await writeFile(join(dir, 'arxiv-2301.07041.json'), '{ broken', 'utf8')
    const store = new ScholarlyTextStore(dir)

    const html = `<!DOCTYPE html><html><body><article class="ltx_document"><h1>Refetched</h1><p>${'Substantive analysis of attention mechanisms. '.repeat(20)}</p></article></body></html>`
    const http = httpOf((url) => {
      if (url.includes('arxiv.org/html/')) {
        return new Response(html, { headers: { 'content-type': 'text/html' } })
      }
      return new Response('nope', { status: 404 })
    })

    const target = parsePaperIdentifier('2301.07041')!
    const record = await resolveScholarlyFullText(target, { http, store })
    expect(record.text).toContain('# Refetched')
  })
})

describe('DOI routes: preprint escalation, Unpaywall, and Semantic Scholar', () => {
  /**
   * A one-page PDF whose text layer exceeds the 500-character floor the
   * resolver applies. The shape mirrors the fixture the direct-URL case
   * already proves extractable.
   * @param label - repeated into the text stream.
   * @returns the PDF bytes as a string.
   */
  function pdfOf(label: string): string {
    const stream = 'BT /F1 12 Tf 72 712 Td ' + `(${label} ) Tj T* `.repeat(24) + ' ET'
    return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000219 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n${300 + stream.length}\n%%EOF`
  }

  /**
   * A transport that answers by host, recording what was asked.
   * @param routes - per-substring response builders.
   * @param seen - collects every requested URL.
   * @returns the transport.
   */
  function routed(
    routes: Array<[string, () => Response]>,
    seen: string[] = [],
  ): ReturnType<typeof createScholarlyHttp> {
    return createScholarlyHttp({
      fetchImpl: async (url) => {
        const value = String(url)
        seen.push(value)
        for (const [needle, build] of routes) {
          if (value.includes(needle)) return build()
        }
        return new Response('miss', { status: 404 })
      },
      pacer: new HostPacer({}),
    })
  }

  it('escalates a DOI to the arXiv preprint OpenAlex names', async () => {
    const seen: string[] = []
    const html = `<!DOCTYPE html><html><body><article class="ltx_document"><h1>Preprint Copy</h1><p>${'Detailed treatment of retrieval augmented generation. '.repeat(20)}</p></article></body></html>`
    const http = routed(
      [
        [
          'www.ebi.ac.uk/europepmc/webservices/rest/search',
          () =>
            new Response(JSON.stringify({ resultList: { result: [] } }), {
              headers: { 'content-type': 'application/json' },
            }),
        ],
        [
          'api.openalex.org/works/doi%3A',
          () =>
            new Response(
              JSON.stringify({
                id: 'https://openalex.org/W9',
                display_name: 'A Paper',
                ids: {},
                // The landing page names the preprint; OpenAlex surfaces an arXiv
                // id only when the record carries no DOI of its own.
                primary_location: { landing_page_url: 'https://arxiv.org/abs/2401.00001' },
                best_oa_location: { pdf_url: 'https://arxiv.org/pdf/2401.00001' },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        ],
        ['arxiv.org/html/2401.00001', () => new Response(html)],
      ],
      seen,
    )

    const target = parsePaperIdentifier('10.1234/preprint.1')!
    const record = await resolveScholarlyFullText(target, { http })
    expect(record.source).toContain('preprint of this paper')
    expect(record.text).toContain('# Preprint Copy')
    expect(seen.some((url) => url.includes('arxiv.org/html/2401.00001'))).toBe(true)
  })

  it('falls through to an Unpaywall PDF when the indexes hold none', async () => {
    const seen: string[] = []
    const http = routed(
      [
        [
          'api.unpaywall.org',
          () =>
            new Response(
              JSON.stringify({
                best_oa_location: { url_for_pdf: 'https://repo.example.org/a.pdf' },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        ],
        [
          'repo.example.org/a.pdf',
          () =>
            new Response(Buffer.from(pdfOf('Unpaywall open access body text. '.repeat(30))), {
              headers: { 'content-type': 'application/pdf' },
            }),
        ],
      ],
      seen,
    )

    const target = parsePaperIdentifier('10.1234/unpaywall.1')!
    const record = await resolveScholarlyFullText(target, {
      http,
      keys: { email: 'user@example.com' },
    })
    expect(record.source).toContain('Unpaywall')
    expect(seen.some((url) => url.includes('api.unpaywall.org'))).toBe(true)
  })

  it('names a Semantic Scholar lookup failure instead of a paywall', async () => {
    const http = routed([
      ['api.unpaywall.org', () => new Response('{}', { status: 404 })],
      ['api.semanticscholar.org', () => new Response('nope', { status: 500 })],
      ['api.openalex.org/works/doi%3A', () => new Response('{}', { status: 500 })],
    ])

    const target = parsePaperIdentifier('10.1234/nothing.1')!
    await expect(resolveScholarlyFullText(target, { http })).rejects.toThrow(
      /Semantic Scholar lookup|OpenAlex lookup/,
    )
  })

  it('reads a PMID target through Europe PMC', async () => {
    const filler = 'Clinical cohort analysis across multiple trial sites. '.repeat(20)
    const xml = `<article><front><article-meta><article-title>PMID Paper</article-title></article-meta></front><body><sec><title>Results</title><p>${filler}</p></sec></body></article>`
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(
            JSON.stringify({
              resultList: { result: [{ id: '99', pmcid: 'PMC99887', doi: '10.1234/pmid.1' }] },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'PMC99887/fullTextXML',
        () => new Response(xml, { headers: { 'content-type': 'application/xml' } }),
      ],
    ])

    const target = parsePaperIdentifier('pmid:12345678')!
    const record = await resolveScholarlyFullText(target, { http })
    expect(record.text).toContain('# PMID Paper')
  })
})

describe('PDF candidate discovery order', () => {
  /**
   * A transport answering per host, collecting requests.
   * @param routes - substring → response builder.
   * @param seen - request log.
   * @returns the transport.
   */
  function routed(
    routes: Array<[string, () => Response]>,
    seen: string[] = [],
  ): ReturnType<typeof createScholarlyHttp> {
    return createScholarlyHttp({
      fetchImpl: async (url) => {
        const value = String(url)
        seen.push(value)
        for (const [needle, build] of routes) if (value.includes(needle)) return build()
        return new Response('empty', { status: 404 })
      },
      pacer: new HostPacer({}),
    })
  }

  /** A PDF whose extracted text clears the resolver's 500-character floor. */
  function readablePdf(): string {
    const stream = 'BT /F1 12 Tf 72 712 Td ' + '(Candidate PDF text ) Tj T* '.repeat(30) + ' ET'
    return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj\ntrailer<</Size 5/Root 1 0 R>>\n%%EOF`
  }

  it('uses the OpenAlex PDF candidate when no preprint exists', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'api.openalex.org/works/doi%3A',
        () =>
          new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              display_name: 'A Work',
              best_oa_location: { pdf_url: 'https://repo.example.org/oa.pdf' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'repo.example.org/oa.pdf',
        () =>
          new Response(Buffer.from(readablePdf()), {
            headers: { 'content-type': 'application/pdf' },
          }),
      ],
    ])

    const record = await resolveScholarlyFullText(parsePaperIdentifier('10.1234/openalex.1')!, {
      http,
    })
    expect(record.source).toContain('OpenAlex')
  })

  it('deduplicates candidate PDF URLs across OpenAlex and Unpaywall', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'api.openalex.org/works/doi%3A',
        () =>
          new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              display_name: 'A Work',
              best_oa_location: { pdf_url: 'https://repo.example.org/dup.pdf' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'api.unpaywall.org/v2/',
        () =>
          new Response(
            JSON.stringify({
              doi: '10.1234/dup.1',
              is_oa: true,
              best_oa_location: { url_for_pdf: 'https://repo.example.org/dup.pdf' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'repo.example.org/dup.pdf',
        () =>
          new Response(Buffer.from(readablePdf()), {
            headers: { 'content-type': 'application/pdf' },
          }),
      ],
    ])

    const record = await resolveScholarlyFullText(parsePaperIdentifier('10.1234/dup.1')!, {
      http,
      keys: { email: 'user@example.com' },
    })
    expect(record.source).toContain('OpenAlex')
  })

  it('names a failed Unpaywall lookup in the terminal reasons', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      ['api.unpaywall.org', () => new Response('boom', { status: 500 })],
      ['api.semanticscholar.org', () => new Response('boom', { status: 500 })],
    ])

    await expect(
      resolveScholarlyFullText(parsePaperIdentifier('10.1234/unpay.2')!, {
        http,
        keys: { email: 'user@example.com' },
      }),
    ).rejects.toThrow(/Unpaywall lookup/)
  })

  it('falls back to a Semantic Scholar PDF when nothing else answers', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      ['api.openalex.org', () => new Response('{}', { status: 404 })],
      [
        'api.semanticscholar.org',
        () =>
          new Response(
            JSON.stringify({
              data: [],
              paperId: 'x',
              title: 'A Work',
              openAccessPdf: { url: 'https://repo.example.org/s2.pdf' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'repo.example.org/s2.pdf',
        () =>
          new Response(Buffer.from(readablePdf()), {
            headers: { 'content-type': 'application/pdf' },
          }),
      ],
    ])

    const record = await resolveScholarlyFullText(parsePaperIdentifier('10.1234/s2.9')!, { http })
    expect(record.source).toContain('Semantic Scholar')
    expect(record.text).toContain('[page 1]')
  })
})

describe('resolver reason composition', () => {
  /**
   * A transport answering per substring.
   * @param routes - substring → builder.
   * @returns the transport.
   */
  function routed(routes: Array<[string, () => Response]>): ReturnType<typeof createScholarlyHttp> {
    return createScholarlyHttp({
      fetchImpl: async (url) => {
        const value = String(url)
        for (const [needle, build] of routes) if (value.includes(needle)) return build()
        return new Response('miss', { status: 404 })
      },
      pacer: new HostPacer({}),
    })
  }

  it('names an arXiv HTML route that carried no article body', async () => {
    const http = routed([
      ['arxiv.org/html/', () => new Response('<html><body>no article here</body></html>')],
      ['ar5iv', () => new Response('<html><body>no article here</body></html>')],
    ])
    await expect(
      resolveScholarlyFullText(parsePaperIdentifier('2301.07042')!, { http }),
    ).rejects.toThrow(/no article body found/)
  })

  it('names a preprint route that failed after an OpenAlex hit', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'api.openalex.org/works/doi%3A',
        () =>
          new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              display_name: 'A Work',
              best_oa_location: { pdf_url: 'https://arxiv.org/pdf/2301.09999' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      ['arxiv.org/html/2301.09999', () => new Response('nope', { status: 404 })],
      ['ar5iv', () => new Response('nope', { status: 404 })],
      ['arxiv.org/pdf/2301.09999', () => new Response('not a pdf', { status: 200 })],
    ])

    await expect(
      resolveScholarlyFullText(parsePaperIdentifier('10.1234/preprint.fail')!, { http }),
    ).rejects.toThrow(/arXiv:2301\.09999/)
  })

  it('reports a PDF candidate that answered with a non-PDF body', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'api.openalex.org/works/doi%3A',
        () =>
          new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              display_name: 'A Work',
              best_oa_location: { pdf_url: 'https://repo.example.org/notpdf' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      ['repo.example.org/notpdf', () => new Response('<html>landing page</html>', { status: 200 })],
    ])

    await expect(
      resolveScholarlyFullText(parsePaperIdentifier('10.1234/notpdf.1')!, { http }),
    ).rejects.toThrow(/not-a-pdf/)
  })

  it('says no route was available when an identifier has none', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
    ])
    // A PMCID target with no full text and no DOI leaves nothing to try.
    await expect(
      resolveScholarlyFullText(parsePaperIdentifier('PMC0000000')!, { http }),
    ).rejects.toThrow(/no route was available/)
  })

  it('resolves an arXiv preprint discovered via OpenAlex location', async () => {
    const http = routed([
      [
        'www.ebi.ac.uk/europepmc/webservices/rest/search',
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'api.openalex.org/works/doi%3A',
        () =>
          new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              display_name: 'A Work',
              best_oa_location: { pdf_url: 'https://arxiv.org/pdf/2301.01234' },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'arxiv.org/html/2301.01234',
        () => new Response(`<article>${'Important preprint text. '.repeat(30)}</article>`),
      ],
    ])

    const record = await resolveScholarlyFullText(
      parsePaperIdentifier('10.1234/preprint.success')!,
      { http },
    )
    expect(record.source).toContain("arXiv's HTML version (LaTeXML)")
    expect(record.text).toContain('Important preprint text')
  })
})
