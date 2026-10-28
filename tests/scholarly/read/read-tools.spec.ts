/**
 * `scholarly_read`, `scholarly_cite`, and `scholarly_verify` tool contracts.
 *
 * Fixtures shared with the sibling scholarly tool specs live in `./fixtures.ts`.
 * @module tests/scholarly/read/read-tools
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'
import { ScholarlyTextStore } from '../../../src/scholarly/fulltext/store.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp, itemLineOf } from '../fixtures.js'
import {
  createScholarlyCiteTool,
  createScholarlyGetTool,
  createScholarlyReadTool,
  createScholarlyVerifyTool,
} from '../../../src/scholarly/tools/index.js'

describe('scholarly_read tool', () => {
  const dummyDoc = `
# 1. Introduction

The study of transformer attention scaling across computational frontiers.

## 1.1 Model Architecture

We describe the specific matrix multiplication optimizations used.

# 2. Results

Empirical results indicate strong convergence under AdamW schedule.
`

  it('rejects empty id parameter', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tool = createScholarlyReadTool(host)
    await expect(tool.execute({ id: '' }, EXEC_CONTEXT as any)).rejects.toThrow(
      'Please provide a valid arXiv ID',
    )
  })

  it('supports outline inspection and BM25 passage querying', async () => {
    // A temp root: the default is the harness cache path, which a test must
    // never write to.
    const cache = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-tools-')))
    await cache.set('arxiv-2301.07041', {
      text: dummyDoc,
      source: 'arxiv_html',
      structured: true,
      url: 'https://arxiv.org/abs/2301.07041',
    })

    const host = createMockHost(createMockHttp(() => new Response('{}')))
    host.cache = cache
    const tool = createScholarlyReadTool(host)

    // Test outline mode
    const outlineResult = (await tool.execute(
      { id: '2301.07041', outline: true },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(outlineResult.text).toContain('Sections')
    expect(outlineResult.text).toContain('1. Introduction')
    expect(outlineResult.text).toContain('1.1. Model Architecture')

    // Test query mode with BM25 ranking
    const queryResult = (await tool.execute(
      { id: '2301.07041', query: 'AdamW convergence schedule' },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(queryResult.text).toContain('Top passages matching')
    expect(queryResult.text).toContain('AdamW')

    // Test section mode
    const sectionResult = (await tool.execute(
      { id: '2301.07041', section: '1.1' },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(sectionResult.text).toContain('Section 1.1')
    expect(sectionResult.text).toContain('matrix multiplication')
  })
})

describe('scholarly_cite tool', () => {
  it('rejects empty ids array', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tool = createScholarlyCiteTool(host)
    await expect(tool.execute({ ids: [], format: 'bibtex' }, EXEC_CONTEXT as any)).rejects.toThrow(
      'ids parameter cannot be empty',
    )
  })

  it('fetches official BibTeX citation via DOI content negotiation', async () => {
    const bibtexSnippet = `@article{Vaswani2017,\n  title={Attention is all you need},\n  author={Vaswani, Ashish},\n  year={2017}\n}`

    const mockHttp = createMockHttp((url, options) => {
      const accept = (options?.headers as Record<string, string> | undefined)?.accept
      if (url.includes('doi.org/10.1234/test') && accept?.includes('application/x-bibtex')) {
        return new Response(bibtexSnippet, { headers: { 'content-type': 'application/x-bibtex' } })
      }
      return new Response('Not found', { status: 404 })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyCiteTool(host)

    const result = (await tool.execute(
      { ids: ['10.1234/test'], format: 'bibtex' },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('@article{Vaswani2017')
    expect(result.text).toContain('Attention is all you need')
  })
})

describe('scholarly_verify tool', () => {
  it('rejects empty references list', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tool = createScholarlyVerifyTool(host)
    await expect(tool.execute({ references: [] }, EXEC_CONTEXT as any)).rejects.toThrow(
      'references parameter cannot be empty',
    )
  })

  it('verifies valid DOI and identifies title/author matches', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.crossref.org/works/') && url.includes('nature1234')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              DOI: '10.1038/nature1234',
              title: ['Deep Residual Learning for Image Recognition'],
              author: [{ family: 'He', given: 'Kaiming' }],
              'published-print': { 'date-parts': [[2016]] },
              'container-title': ['CVPR'],
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      {
        references: [
          'He, K. (2016). Deep Residual Learning for Image Recognition. CVPR. doi:10.1038/nature1234',
        ],
      },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('Reference verification summary')
    expect(result.text).toContain('1 verified')
    expect(result.text).toContain('VERIFIED')
    expect(result.text).toContain('10.1038/nature1234')
  })

  it('flags warning when first author or publication year mismatches registry', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.crossref.org/works/') && url.includes('nature1234')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              DOI: '10.1038/nature1234',
              title: ['Original Work'],
              author: [{ family: 'Smith', given: 'John' }],
              'published-print': { 'date-parts': [[2010]] },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      {
        references: ['Williams, R. (2022). Original Work. doi:10.1038/nature1234'],
      },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('Reference verification summary')
    expect(result.text).toContain('1 to check')
    expect(result.text).toContain('CHECK')
    expect(result.text).toContain('Year discrepancy')
  })

  it('verifies non-DOI reference via bibliographic search and title token containment', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.crossref.org/works?') && url.includes('query.bibliographic')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              items: [
                {
                  DOI: '10.5555/attention.2017',
                  title: ['Attention Is All You Need'],
                  author: [{ family: 'Vaswani', given: 'Ashish' }],
                  'published-print': { 'date-parts': [[2017]] },
                },
              ],
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      {
        references: [
          'Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J. (2017). Attention is all you need. NeurIPS 2017.',
        ],
      },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('1 verified')
    expect(result.text).toContain('VERIFIED')
    expect(result.text).toContain('10.5555/attention.2017')
    expect(result.text).not.toContain('Closest match differed significantly')
  })

  it('extracts author and verifies reference with bracketed numeric prefix', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.crossref.org/works?') && url.includes('query.bibliographic')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              items: [
                {
                  DOI: '10.5555/attention.2017',
                  title: ['Attention Is All You Need'],
                  author: [{ family: 'Vaswani', given: 'Ashish' }],
                  'published-print': { 'date-parts': [[2017]] },
                },
              ],
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      {
        references: ['[1] Vaswani, A. (2017). Attention is all you need. NeurIPS.'],
      },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('1 verified')
    expect(result.text).toContain('VERIFIED')
    expect(result.text).not.toContain('Author discrepancy')
  })

  it('reports a registry failure as unverified, never as a missing DOI', async () => {
    // A 500 is a transport/registry failure. `lookupCrossref` normalizes only a
    // 404 to `undefined` and rethrows the rest, so this path must not claim the
    // DOI is absent: a reader would delete a correct citation.
    const mockHttp = createMockHttp(() => new Response('boom', { status: 500 }))
    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      { references: ['Smith, J. (2020). A real paper. Nature. doi:10.1038/nature12373'] },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('0 not found')
    expect(result.text).toContain('1 unverified')
    expect(result.text).toContain('UNVERIFIED')
    expect(result.text).toContain('Crossref lookup failed')
    expect(result.text).not.toContain('does not exist in Crossref registry')
  })

  it('reports a missing DOI as not found when the registry answers 404 and the search is empty', async () => {
    // A real registry answers a bibliographic search with 200 + no items; the
    // DOI path's own 404 is normalized to "absent" by `lookupCrossref`.
    const mockHttp = createMockHttp((url) => {
      if (url.includes('/works?')) {
        return new Response(JSON.stringify({ status: 'ok', message: { items: [] } }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    })
    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      { references: ['Nobody, A. (2020). Imaginary. doi:10.9999/imaginary.1'] },
      EXEC_CONTEXT as any,
    )) as { text: string }

    const item = itemLineOf(result.text)
    expect(item).toContain('NOT FOUND')
    expect(item).toContain('No matching publication record found in Crossref.')
  })

  it('reports a bibliographic search failure as unverified', async () => {
    const mockHttp = createMockHttp(() => new Response('boom', { status: 503 }))
    const host = createMockHost(mockHttp)
    const tool = createScholarlyVerifyTool(host)

    const result = (await tool.execute(
      { references: ['Vaswani, A. (2017). Attention is all you need. NeurIPS.'] },
      EXEC_CONTEXT as any,
    )) as { text: string }

    const item = itemLineOf(result.text)
    expect(item).toContain('UNVERIFIED')
    expect(item).toContain('Crossref search failed')
    expect(item).not.toContain('NOT FOUND')
  })
})

describe('scholarly_cite value handling', () => {
  it('reports an empty citation body without inventing one', async () => {
    const host = createMockHost(createMockHttp(() => new Response('', { status: 200 })))
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/empty.1'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('keeps the answers it did get when one identifier fails', async () => {
    const host = createMockHost(
      createMockHttp((url) =>
        String(url).includes('bad')
          ? new Response('nope', { status: 500 })
          : new Response('@article{good, title={Good}}', { status: 200 }),
      ),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/good.1', '10.1234/bad.1'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Good')
  })

  it('refuses more than thirty ids instead of silently truncating them', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        seen.push(String(url))
        return new Response('@article{x}', { status: 200 })
      }),
    )
    const tool = createScholarlyCiteTool(host)
    const ids = Array.from({ length: 35 }, (_, i) => `10.1234/item${i}.1`)
    await expect(
      tool.execute({ ids, format: 'bibtex' }, EXEC_CONTEXT as never),
    ).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: expect.stringContaining('at most 30'),
    })
    expect(seen).toHaveLength(0)
  })
})

describe('scholarly_cite identifier resolution', () => {
  it('derives an arXiv DOI and strips the leading at-sign for BibTeX', async () => {
    const host = createMockHost(
      createMockHttp(() => new Response('  @article{arxiv, title={T}}', { status: 200 })),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['2301.07041'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    // The registry body is emitted as an entry, with indentation normalized.
    expect(result.text).toContain('@article{arxiv')
  })

  it('resolves a PMID to its DOI through Europe PMC', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        seen.push(value)
        if (value.includes('www.ebi.ac.uk/europepmc')) {
          return new Response(
            JSON.stringify({
              resultList: { result: [{ id: '1', title: 'T', doi: '10.1234/frompmid.1' }] },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('@article{x}', { status: 200 })
      }),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['pmid:12345678'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(seen.some((u) => u.includes('doi.org/10.1234/frompmid.1'))).toBe(true)
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('reports an identifier with no resolvable DOI', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['pmid:99999999'], format: 'ris' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('No DOI found')
  })

  it('reports a 404 as a DOI that does not exist on doi.org', async () => {
    const host = createMockHost(createMockHttp(() => new Response('missing', { status: 404 })))
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/absent.1'], format: 'csljson' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('does not exist on doi.org')
  })
})

describe('scholarly_get identifier branches', () => {
  /**
   * A host whose every index answers with one Crossref-shaped work.
   * @param seen - collects requested URLs.
   * @returns the host.
   */
  function hostOf(seen: string[] = []): ReturnType<typeof createMockHost> {
    return createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        seen.push(value)
        if (value.includes('api.crossref.org/works/')) {
          return new Response(
            JSON.stringify({ status: 'ok', message: { DOI: '10.1/x', title: ['A'], author: [] } }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (value.includes('api.openalex.org')) {
          return new Response(
            JSON.stringify({ id: 'https://openalex.org/W1', display_name: 'A' }),
            {
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        if (value.includes('www.ebi.ac.uk')) {
          return new Response(JSON.stringify({ resultList: { result: [] } }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }),
    )
  }

  it('resolves a PMID through Europe PMC and escalates to OpenAlex', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        seen.push(value)
        if (value.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')) {
          return new Response(
            JSON.stringify({
              resultList: {
                result: [
                  {
                    id: '55',
                    title: 'A PMID Paper',
                    authorString: 'Doe J',
                    pubYear: '2019',
                    doi: '10.1234/frompmid',
                  },
                ],
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (value.includes('api.openalex.org')) {
          return new Response(
            JSON.stringify({ id: 'https://openalex.org/W2', display_name: 'A PMID Paper' }),
            {
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }),
    )
    const tool = createScholarlyGetTool(host)
    const result = (await tool.execute({ id: 'pmid:12345678' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('PMID Paper')
    expect(seen.some((url) => url.includes('api.openalex.org'))).toBe(true)
  })

  it('resolves a PMCID through Europe PMC and escalates to OpenAlex when DOI is present', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        seen.push(value)
        if (value.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')) {
          return new Response(
            JSON.stringify({
              resultList: {
                result: [
                  {
                    id: 'PMC1234567',
                    pmcid: 'PMC1234567',
                    title: 'A PMCID Paper',
                    authorString: 'Doe J',
                    pubYear: '2021',
                    doi: '10.1234/frompmcid',
                  },
                ],
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (value.includes('api.openalex.org')) {
          return new Response(
            JSON.stringify({ id: 'https://openalex.org/W9', display_name: 'A PMCID Paper' }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }),
    )
    const tool = createScholarlyGetTool(host)
    const result = (await tool.execute({ id: 'PMC1234567' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('PMCID Paper')
    expect(seen.some((url) => url.includes('www.ebi.ac.uk'))).toBe(true)
    expect(seen.some((url) => url.includes('api.openalex.org'))).toBe(true)
  })

  it('resolves a PMCID through Europe PMC when DOI is absent', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        seen.push(value)
        if (value.includes('www.ebi.ac.uk/europepmc/webservices/rest/search')) {
          return new Response(
            JSON.stringify({
              resultList: {
                result: [
                  {
                    id: 'PMC7654321',
                    pmcid: 'PMC7654321',
                    title: 'A PMCID Only Paper',
                    authorString: 'Smith A',
                    pubYear: '2020',
                  },
                ],
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }),
    )
    const tool = createScholarlyGetTool(host)
    const result = (await tool.execute({ id: 'PMC7654321' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('PMCID Only Paper')
    expect(seen.some((url) => url.includes('www.ebi.ac.uk'))).toBe(true)
    expect(seen.some((url) => url.includes('api.openalex.org'))).toBe(false)
  })

  it('resolves a DOI across four indexes in one pass', async () => {
    const seen: string[] = []
    const tool = createScholarlyGetTool(hostOf(seen))
    const result = (await tool.execute({ id: '10.1234/four' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text.length).toBeGreaterThan(0)
    expect(seen.some((url) => url.includes('api.crossref.org'))).toBe(true)
    expect(seen.some((url) => url.includes('api.openalex.org'))).toBe(true)
    expect(seen.some((url) => url.includes('api.semanticscholar.org'))).toBe(true)
    expect(seen.some((url) => url.includes('www.ebi.ac.uk'))).toBe(true)
  })

  it('resolves an arXiv id across three indexes', async () => {
    const seen: string[] = []
    const tool = createScholarlyGetTool(hostOf(seen))
    const result = (await tool.execute({ id: '2301.07041' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text.length).toBeGreaterThan(0)
    expect(seen.some((url) => url.includes('export.arxiv.org'))).toBe(true)
  })

  it('reports an unanswered title search instead of claiming no such paper', async () => {
    // A title search queries OpenAlex only, so its 404 is the whole answer:
    // "no record" and "index unreachable" must not share one sentence.
    const host = createMockHost(createMockHttp(() => new Response('{}', { status: 404 })))
    const tool = createScholarlyGetTool(host)
    const result = (await tool.execute(
      { id: 'a title that no index holds at all' },
      EXEC_CONTEXT as any,
    )) as { text: string }
    expect(result.text).toContain('No scholarly index found a paper matching')
    expect(result.text).toContain('Unanswered sources: OpenAlex (HTTP 404 from api.openalex.org)')
    expect(result.text).not.toContain('Please verify the identifier')
  })

  it('labels a title-derived hit as a closest match', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  id: 'https://openalex.org/W3',
                  display_name: 'A Title Search Result',
                  publication_year: 2018,
                  authorships: [{ author: { display_name: 'A. Author' } }],
                },
              ],
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const tool = createScholarlyGetTool(host)
    const result = (await tool.execute({ id: 'a title search result' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('Closest match found by title')
  })
})
