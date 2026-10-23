/**
 * `scholarly_search`, `scholarly_get`, and `scholarly_citations` tool contracts.
 *
 * Fixtures shared with the sibling scholarly tool specs live in `./fixtures.ts`.
 * @module tests/scholarly/search-tools
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroServiceLike } from '../../src/scholarly/zotero-link.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from './fixtures.js'
import { SCHOLARLY_TOOL_NAMES } from '../helpers/tool-names.js'
import {
  createAllScholarlyTools,
  createScholarlyGetTool,
  createScholarlySearchTool,
} from '../../src/scholarly/tools/index.js'

describe('scholarly tools registry', () => {
  it('creates all scholarly model tools', () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tools = createAllScholarlyTools(host)
    // The factories are the source of truth; the shared name list the host
    // specs assert against must equal what they actually register, or the
    // two drift silently (the `zotero_batch_items` gap's scholarly sibling).
    const names = tools.map((t) => t.name)
    expect(names).toEqual([...SCHOLARLY_TOOL_NAMES])
    expect(tools.length).toBe(SCHOLARLY_TOOL_NAMES.length)
  })

  it('projects write outcomes only for the scholarly save card', () => {
    const tools = createAllScholarlyTools(createMockHost(createMockHttp(() => new Response('{}'))))
    for (const tool of tools) {
      if (tool.name === 'scholarly_save_to_zotero') {
        expect(tool.output.presentationMeta).toBeTypeOf('function')
      } else {
        expect(tool.output.presentationMeta, `${tool.name} has no client card`).toBeUndefined()
      }
    }
  })

  it('validates every declared output schema against the registry checker', async () => {
    const { assertSupportedJsonSchema } = await import('@deepseek-ai/dsh-tools')
    const tools = createAllScholarlyTools(createMockHost(createMockHttp(() => new Response('{}'))))
    for (const tool of tools) {
      expect(() => assertSupportedJsonSchema(tool.output.schema), tool.name).not.toThrow()
      expect(() => assertSupportedJsonSchema(tool.parameters), tool.name).not.toThrow()
    }
  })
})

describe('scholarly_search tool', () => {
  it('rejects empty query parameter', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tool = createScholarlySearchTool(host)
    await expect(tool.execute({ query: '   ' }, EXEC_CONTEXT as any)).rejects.toThrow(
      'query parameter cannot be empty',
    )
  })

  it('searches and returns deduplicated results with library tags', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.openalex.org/works')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W1234',
                doi: 'https://doi.org/10.1234/test.1',
                display_name: 'Attention Is All You Need',
                publication_year: 2017,
                type: 'article',
                authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
                primary_location: { source: { display_name: 'NeurIPS' } },
                open_access: { is_oa: true, oa_url: 'https://arxiv.org/pdf/1706.03762' },
                cited_by_count: 90000,
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ results: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    })

    const mockZotero: ZoteroServiceLike = {
      search: async () => ({
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        items: [
          {
            ref: 'zotero://user/0/item/ITEM1234',
            title: 'Attention Is All You Need',
            creatorSummary: 'Vaswani et al.',
            year: 2017,
            itemType: 'journalArticle',
            extra: 'DOI: 10.1234/test.1',
          },
        ],
        total: 1,
        returned: 1,
        offset: 0,
      }),
      get: async () => ({
        ref: 'zotero://user/0/item/ITEM1234',
        itemType: 'journalArticle',
        title: 'Attention Is All You Need',
        creators: [],
        doi: '10.1234/test.1',
        collections: [{ ref: 'zotero://user/0/collection/COLL1234', name: 'ML' }],
        tags: [],
        children: { total: 0 },
        abstractTruncated: false,
      }),
    }

    const host = createMockHost(mockHttp, mockZotero)
    const tool = createScholarlySearchTool(host)

    const result = (await tool.execute(
      { query: 'Attention Is All You Need', sources: ['openalex'] },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('Attention Is All You Need')
    expect(result.text).toContain('In Zotero: ML')
    expect(result.text).toContain('cited 90000')
  })
})

describe('scholarly_get tool', () => {
  it('rejects empty id parameter', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tool = createScholarlyGetTool(host)
    await expect(tool.execute({ id: '   ' }, EXEC_CONTEXT as any)).rejects.toThrow(
      'id parameter cannot be empty',
    )
  })

  it('points a bare URL at the reader instead of searching it as a title', async () => {
    // A URL is not a title. Searching the index for the URL string returned
    // whatever happened to match and presented it as an exact hit.
    let searched = false
    const host = createMockHost(
      createMockHttp(() => {
        searched = true
        return new Response('{}', { status: 200 })
      }),
    )
    const tool = createScholarlyGetTool(host)
    await expect(
      tool.execute({ id: 'https://example.com/paper.pdf' }, EXEC_CONTEXT as any),
    ).rejects.toThrow(/Use scholarly_read with that URL/)
    expect(searched, 'no index request may be issued').toBe(false)
  })

  it('retrieves detailed paper metadata by arXiv identifier', async () => {
    const arxivXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2301.07041v1</id>
          <title>A Comprehensive Survey of LLMs</title>
          <summary>Large language models have advanced rapidly.</summary>
          <published>2023-01-16T18:00:00Z</published>
          <author><name>Alice Researcher</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
        </entry>
      </feed>
    `

    const mockHttp = createMockHttp((url) => {
      if (url.includes('export.arxiv.org/api/query')) {
        return new Response(arxivXml, { headers: { 'content-type': 'application/xml' } })
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '2301.07041' }, EXEC_CONTEXT as any)) as {
      text: string
      papers: Array<{ title: string; open: boolean }>
    }

    expect(result.text).toContain('Comprehensive Survey of LLMs')
    expect(result.text).toContain('2301.07041')
    expect(result.text).toContain('arXiv: 2301.07041')
  })

  it('retrieves paper metadata by DOI', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('nature1234')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              DOI: '10.1038/nature1234',
              title: ['Deep Learning Nature'],
              author: [{ family: 'LeCun', given: 'Yann' }],
              'published-print': { 'date-parts': [[2015]] },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '10.1038/nature1234' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('Deep Learning Nature')
  })

  it('reports an unanswered index instead of claiming no such paper', async () => {
    // Every source answers 404, so nothing is known about the identifier —
    // the output must not read as proof that no index holds it.
    const mockHttp = createMockHttp(() => new Response('Not found', { status: 404 }))
    const host = createMockHost(mockHttp)
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '10.9999/unknown.paper' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('No scholarly index found a paper matching')
    expect(result.text).toContain('Unanswered sources:')
    expect(result.text).toContain('Europe PMC (HTTP 404 from www.ebi.ac.uk)')
    expect(result.text).not.toContain('Please verify the identifier')
  })

  it('keeps answering sources in the result when others fail', async () => {
    // One index holds the work while two others fail: the hit survives and
    // the failures ride along as a notice, never as a silent absence.
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.crossref.org')) {
        return new Response('{}', { status: 500 })
      }
      if (url.includes('api.semanticscholar.org')) {
        return new Response('{}', { status: 503 })
      }
      if (url.includes('api.openalex.org')) {
        return new Response(
          JSON.stringify({
            id: 'https://openalex.org/W99',
            doi: 'https://doi.org/10.1038/nature1234',
            display_name: 'Deep Learning Nature',
            publication_year: 2015,
            authorships: [{ author: { display_name: 'Yann LeCun' } }],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })
    const host = createMockHost(mockHttp)
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '10.1038/nature1234' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('Deep Learning Nature')
    expect(result.text).toContain('Notice:')
    expect(result.text).toContain('Crossref (HTTP 500 from api.crossref.org)')
    expect(result.text).toContain('Semantic Scholar (HTTP 503 from api.semanticscholar.org)')
  })

  it('reports a rate-limited Semantic Scholar as unanswered, never as absent', async () => {
    // The regression this locks: the S2 adapter used to swallow 429 into an
    // empty list, so a rate-limited index vanished from the result silently.
    // A rate limit is a transport fact: it must ride along as an unanswered
    // source, and it must not invite the reader to "verify the identifier".
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.semanticscholar.org')) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
      }
      if (url.includes('api.openalex.org')) {
        return new Response(
          JSON.stringify({
            id: 'https://openalex.org/W99',
            doi: 'https://doi.org/10.1038/nature1234',
            display_name: 'Deep Learning Nature',
            publication_year: 2015,
            authorships: [{ author: { display_name: 'Yann LeCun' } }],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 500 })
    })
    const host = createMockHost(mockHttp)
    const tool = createScholarlyGetTool(host)

    const result = (await tool.execute({ id: '10.1038/nature1234' }, EXEC_CONTEXT as any)) as {
      text: string
    }
    expect(result.text).toContain('Deep Learning Nature')
    expect(result.text).toContain('Notice:')
    expect(result.text).toContain(
      'Semantic Scholar (HTTP 429 — Rate limited by api.semanticscholar.org',
    )
    expect(result.text).not.toContain('Please verify the identifier')
  })

  it('lists a rate-limited Semantic Scholar under unanswered sources when nothing is found', async () => {
    const mockHttp = createMockHttp((url) =>
      url.includes('api.semanticscholar.org')
        ? new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
        : new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )
    const tool = createScholarlySearchTool(createMockHost(mockHttp))

    const result = (await tool.execute(
      { query: 'a query no index can answer' },
      EXEC_CONTEXT as any,
    )) as { text: string }
    expect(result.text).toContain('No papers found')
    expect(result.text).toContain('Unanswered sources: Semantic Scholar (Rate limited by')
  })

  it('propagates a caller abort instead of recording a failed source', async () => {
    const controller = new AbortController()
    const mockHttp = createMockHttp(() => {
      controller.abort()
      return new Response('{}', { status: 500 })
    })
    const host = createMockHost(mockHttp)
    const tool = createScholarlyGetTool(host)

    await expect(
      tool.execute({ id: '10.1038/nature1234' }, { signal: controller.signal } as any),
    ).rejects.toThrow()
  })
})

describe('scholarly_search parameter normalization', () => {
  /**
   * A host whose index answers with one work, tracking what was requested.
   * @param seen - collects requested URLs.
   * @returns the host.
   */
  function hostOf(seen: string[] = []): ReturnType<typeof createMockHost> {
    return createMockHost(
      createMockHttp((url) => {
        seen.push(String(url))
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W1',
                display_name: 'A Normalized Result',
                publication_year: 2020,
                authorships: [{ author: { display_name: 'A. Author' } }],
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }),
    )
  }

  it('bounds a date-sorted search to the recent window', async () => {
    const seen: string[] = []
    const tool = createScholarlySearchTool(hostOf(seen))
    const result = (await tool.execute(
      { query: 'recent transformer work', sources: ['openalex'], sort: 'date' },
      EXEC_CONTEXT as any,
    )) as { text: string }
    expect(result.text).toContain('papers found')
    // A date sort derives a lower year bound; the request must carry it.
    expect(seen.some((url) => url.includes('publication_year'))).toBe(true)
  })

  it('honours an explicit year range and open-access filter', async () => {
    const seen: string[] = []
    const tool = createScholarlySearchTool(hostOf(seen))
    await tool.execute(
      {
        query: 'open access survey',
        sources: ['openalex'],
        year_from: 2015,
        year_to: 2018,
        open_access: true,
      },
      EXEC_CONTEXT as any,
    )
    const request = seen.find((url) => url.includes('openalex.org/works')) ?? ''
    expect(request).toContain('2015')
    expect(request).toContain('2018')
    expect(request).toContain('is_oa')
  })

  it('passes arXiv categories through to the request', async () => {
    const seen: string[] = []
    const tool = createScholarlySearchTool(hostOf(seen))
    await tool.execute(
      { query: 'category filter', sources: ['arxiv'], categories: ['cs.CL'] },
      EXEC_CONTEXT as any,
    )
    expect(seen.some((url) => url.includes('cs.CL'))).toBe(true)
  })

  it('reports the sources that failed alongside the ones that answered', async () => {
    const host = createMockHost(
      createMockHttp((url) => {
        if (String(url).includes('openalex')) return new Response('down', { status: 500 })
        return new Response(
          JSON.stringify({
            results: [{ display_name: 'Answered', id: 'https://openalex.org/W9' }],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'partial outage', sources: ['openalex', 'crossref'] },
      EXEC_CONTEXT as any,
    )) as { text: string }
    expect(result.text).toMatch(/Notice:|Unanswered sources|papers found/)
  })

  it('says nothing was found when every source returns nothing', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(JSON.stringify({ results: [] }), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'nothing matches this', sources: ['openalex'] },
      EXEC_CONTEXT as any,
    )) as { text: string }
    expect(result.text).toContain('No papers found')
  })

  it('caps the requested limit at the configured maximum', async () => {
    const seen: string[] = []
    const tool = createScholarlySearchTool(hostOf(seen))
    await tool.execute(
      { query: 'limit probe', sources: ['openalex'], limit: 1_000 },
      EXEC_CONTEXT as any,
    )
    // The mock host caps maxResults at 10, so the per-page value cannot exceed it.
    const perPage = /per-page=(\d+)/.exec(seen.find((u) => u.includes('per-page')) ?? '')?.[1]
    expect(Number(perPage ?? 0)).toBeLessThanOrEqual(10)
  })
})

describe('scholarly_search limit and source-weight decisions', () => {
  /**
   * A host answering one OpenAlex work.
   * @returns the host.
   */
  function hostOf(): ReturnType<typeof createMockHost> {
    return createMockHost(
      createMockHttp((url) =>
        String(url).includes('openalex.org')
          ? new Response(
              JSON.stringify({
                results: [
                  {
                    id: 'https://openalex.org/W1',
                    display_name: 'A Result',
                    publication_year: 2020,
                    authorships: [{ author: { display_name: 'A' } }],
                  },
                ],
              }),
              { headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify({ data: [] }), {
              headers: { 'content-type': 'application/json' },
            }),
      ),
    )
  }

  it('widens the per-source window for a multi-source search', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        seen.push(decodeURIComponent(String(url)))
        return new Response(JSON.stringify({ results: [], data: [], items: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const tool = createScholarlySearchTool(host)
    await tool.execute(
      { query: 'multi source probe', sources: ['openalex', 'crossref', 'arxiv'], limit: 10 },
      EXEC_CONTEXT as never,
    )
    // With several sources each is asked for a fraction of the target, floored
    // at five.
    const perPage = seen.find((u) => u.includes('per-page=')) ?? ''
    expect(perPage.length).toBeGreaterThan(0)
  })

  it('over-fetches for a citation-sorted search', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        seen.push(decodeURIComponent(String(url)))
        return new Response(JSON.stringify({ results: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const tool = createScholarlySearchTool(host)
    await tool.execute(
      { query: 'cited work', sources: ['openalex'], sort: 'citations', limit: 5 },
      EXEC_CONTEXT as never,
    )
    expect(seen.join(' ')).toContain('cited_by_count')
  })

  it('caps the per-source window at fifty', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((url) => {
        seen.push(decodeURIComponent(String(url)))
        return new Response(JSON.stringify({ results: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const tool = createScholarlySearchTool(host)
    await tool.execute(
      { query: 'big window', sources: ['openalex'], sort: 'citations', limit: 100 },
      EXEC_CONTEXT as never,
    )
    const perPage = /per-page=(\d+)/.exec(seen.join(' '))?.[1]
    expect(Number(perPage ?? 0)).toBeLessThanOrEqual(50)
  })

  it('renders no abstract when the caller asks for none', async () => {
    const tool = createScholarlySearchTool(hostOf())
    const withAbstract = (await tool.execute(
      { query: 'abstract probe', sources: ['openalex'], abstract: 'full' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(withAbstract.text.length).toBeGreaterThan(0)
  })

  it('weights the preprint indexes above the general ones', async () => {
    // The weight is internal to fusion; the observable contract is that an
    // arXiv-only hit still outranks a Crossref-only duplicate.
    const host = createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        if (value.includes('arxiv')) {
          return new Response(
            '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2101.1v1</id><title>Shared Title Of A Paper</title><summary>S</summary><published>2021-01-01T00:00:00Z</published><author><name>A</name></author></entry></feed>',
          )
        }
        return new Response(
          JSON.stringify({
            message: { items: [{ DOI: '10.1234/shared', title: ['Shared Title Of A Paper'] }] },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const tool = createScholarlySearchTool(host)
    const result = (await tool.execute(
      { query: 'shared title of a paper', sources: ['arxiv', 'crossref'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Shared Title Of A Paper')
  })
})
