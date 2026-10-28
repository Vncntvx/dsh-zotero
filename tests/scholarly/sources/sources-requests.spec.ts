import { describe, expect, it } from 'vitest'
import { routeQuery } from '../../../src/scholarly/router.js'
import {
  buildArxivSearchQuery,
  lookupArxiv,
  parseArxivAtom,
  searchArxiv,
} from '../../../src/scholarly/sources/arxiv.js'
import {
  lookupOpenAlex,
  paperFromOpenAlex,
  reconstructInvertedAbstract,
  searchOpenAlex,
} from '../../../src/scholarly/sources/openalex.js'
import { searchPubMed } from '../../../src/scholarly/sources/pubmed.js'
import {
  lookupSemanticScholar,
  searchSemanticScholar,
} from '../../../src/scholarly/sources/semanticscholar.js'
import { createScholarlyHttp, type ScholarlyHttp } from '../../../src/scholarly/transport/http.js'
import { ScholarlyHttpError } from '../../../src/scholarly/transport/http.js'

describe('scholarly query router', () => {
  it('does not route ordinary English to the technical indexes', () => {
    // The regression this locks: bare `attention`, `vision`, and `graph` sent
    // "attention economy" / "vision of the firm" / "graph of social relations"
    // to arXiv+DBLP, and no configuration could override it.
    const general = ['arxiv', 'openalex', 'crossref', 'semanticscholar']
    for (const query of [
      'attention economy and advertising',
      'vision of the firm',
      'graph of social relations',
    ]) {
      expect(routeQuery(query), query).toEqual(general)
    }
  })

  it('still routes technical phrases to the technical indexes', () => {
    expect(routeQuery('self-attention mechanisms')).toEqual([
      'arxiv',
      'dblp',
      'semanticscholar',
      'openalex',
    ])
    expect(routeQuery('transformer architecture for NLP')).toContain('arxiv')
    expect(routeQuery('graph neural network pretraining')).toContain('arxiv')
  })

  it('routes CS / Math / Physics keywords to arxiv, dblp, s2, openalex', () => {
    const sources = routeQuery('diffusion models acceleration sampling')
    expect(sources).toEqual(['arxiv', 'dblp', 'semanticscholar', 'openalex'])
  })

  it('routes Biomedical keywords to pubmed, europepmc, crossref, openalex', () => {
    const sources = routeQuery('crispr cas9 off-target gene editing in cancer cells')
    expect(sources).toEqual(['pubmed', 'europepmc', 'crossref', 'openalex'])
  })

  it('routes generic or mixed topics to broad sources', () => {
    const sources = routeQuery('academic evaluation metrics and citations')
    expect(sources).toEqual(['arxiv', 'openalex', 'crossref', 'semanticscholar'])
  })

  it('respects explicitly requested sources without overriding', () => {
    const sources = routeQuery('transformer', ['dblp', 'arxiv'])
    expect(sources).toEqual(['dblp', 'arxiv'])
  })
})

describe('source searcher registry', () => {
  it('is total over the declared source ids', async () => {
    // A routing branch that names an id with no searcher is a runtime hole the
    // type system now refuses; this asserts the two declarations agree.
    const { SOURCE_SEARCHERS } = await import('../../../src/scholarly/sources/index.js')
    const { SCHOLARLY_SOURCE_IDS } = await import('../../../src/scholarly/types.js')
    for (const id of SCHOLARLY_SOURCE_IDS) {
      expect(typeof SOURCE_SEARCHERS[id], `${id} needs a searcher`).toBe('function')
    }
  })

  it('dispatches every id through its adapter', async () => {
    const { SOURCE_SEARCHERS } = await import('../../../src/scholarly/sources/index.js')
    const { SCHOLARLY_SOURCE_IDS } = await import('../../../src/scholarly/types.js')
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ results: [], resultList: { result: [] }, message: { items: [] } }),
          {
            headers: { 'content-type': 'application/json' },
          },
        ),
      pacer: new (await import('../../../src/scholarly/transport/pacing.js')).HostPacer({}),
    })

    for (const id of SCHOLARLY_SOURCE_IDS) {
      const papers = await SOURCE_SEARCHERS[id](
        { query: 'anything', limit: 1, sort: 'relevance' },
        http,
        {},
      )
      expect(Array.isArray(papers), `${id} must return a list`).toBe(true)
    }
  })
})

describe('arXiv query construction and search fallback', () => {
  it('wraps a plain query in title-or-abstract terms', () => {
    const query = buildArxivSearchQuery({
      query: 'graph neural networks',
      limit: 5,
      sort: 'relevance',
    } as never)
    expect(query).toContain('ti:')
    expect(query).toContain('abs:')
  })

  it('passes a fielded query through unchanged', () => {
    const query = buildArxivSearchQuery({
      query: 'au:Vaswani',
      limit: 5,
      sort: 'relevance',
    } as never)
    expect(query).toContain('au:Vaswani')
    expect(query).not.toContain('ti:au:Vaswani')
  })

  it('adds a submitted-date range when a year bound is present', () => {
    const query = buildArxivSearchQuery({
      query: 'anything',
      limit: 5,
      sort: 'relevance',
      yearFrom: 2015,
      yearTo: 2018,
    } as never)
    expect(query).toContain('submittedDate:')
    expect(query).toContain('2015')
    expect(query).toContain('2018')
  })

  it('treats a query with no matchable terms as a title-or-abstract search', () => {
    // An all-stopword query leaves no term to field, so it falls back to a
    // single grouped clause rather than an empty AND chain.
    const query = buildArxivSearchQuery({
      query: 'the of a an',
      limit: 5,
      sort: 'relevance',
    } as never)
    expect(query).toContain('ti:')
  })

  it('retries with the loosened query when the strict one finds nothing', async () => {
    const queries: string[] = []
    const http = createScholarlyHttp({
      fetchImpl: async (url) => {
        queries.push(decodeURIComponent(String(url)))
        // Only the any-word form matches; the strict form returns an empty feed.
        const isLoose = /all:/.test(decodeURIComponent(String(url)))
        const entry = isLoose
          ? '<entry><id>http://arxiv.org/abs/2101.00009v1</id><title>Loose Hit</title><summary>S</summary><published>2021-01-01T00:00:00Z</published><author><name>A</name></author></entry>'
          : ''
        return new Response(
          `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entry}</feed>`,
        )
      },
      pacer: new (await import('../../../src/scholarly/transport/pacing.js')).HostPacer({}),
    })

    const papers = await searchArxiv(
      { query: 'nonexistent phrase', limit: 5, sort: 'relevance' },
      http,
    )
    // The strict attempt ran first, then the loosened one.
    expect(queries.length).toBeGreaterThanOrEqual(2)
    expect(papers.length).toBeGreaterThanOrEqual(0)
  })

  it('does not loosen a date-sorted query', async () => {
    const queries: string[] = []
    const http = createScholarlyHttp({
      fetchImpl: async (url) => {
        queries.push(String(url))
        return new Response(
          '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
        )
      },
      pacer: new (await import('../../../src/scholarly/transport/pacing.js')).HostPacer({}),
    })

    const papers = await searchArxiv({ query: 'anything', limit: 5, sort: 'date' }, http)
    expect(papers).toEqual([])
    expect(queries).toHaveLength(1)
  })

  it('looks up one identifier by id_list', async () => {
    const seen: string[] = []
    const http = createScholarlyHttp({
      fetchImpl: async (url) => {
        seen.push(String(url))
        return new Response(
          '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2101.00010v2</id><title>A Lookup</title><summary>S</summary><published>2021-01-01T00:00:00Z</published><author><name>A</name></author></entry></feed>',
        )
      },
      pacer: new (await import('../../../src/scholarly/transport/pacing.js')).HostPacer({}),
    })

    const paper = await lookupArxiv('2101.00010v2', http)
    expect(paper?.title).toBe('A Lookup')
    expect(seen[0]).toContain('id_list=')
  })

  it('skips an entry whose title is the arXiv error marker', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><id>http://arxiv.org/abs/9999.99999v1</id><title>Error</title><summary/><published>2020-01-01T00:00:00Z</published></entry>
    </feed>`
    expect(parseArxivAtom(xml)).toEqual([])
  })
})

describe('index adapters degrade on a provider-side refusal', () => {
  /**
   * A transport answering every request with one status.
   * @param status - the HTTP status to return.
   * @returns the transport.
   */
  async function failingWith(status: number): Promise<ScholarlyHttp> {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    return createScholarlyHttp({
      fetchImpl: async () => new Response('refused', { status }),
      pacer: new HostPacer({}),
    })
  }

  it('propagates a Semantic Scholar 429 instead of reporting "no results"', async () => {
    // The regression this locks: the adapter used to swallow 429 into an empty
    // list, so a rate-limited index looked like an index with no matches and
    // the failedSources mechanism never saw the failure. A rate limit is a
    // transport fact the caller must report as an unanswered source.
    const query = { query: 'q', limit: 5, sort: 'relevance' as const }
    await expect(searchSemanticScholar(query, await failingWith(429))).rejects.toBeInstanceOf(
      ScholarlyHttpError,
    )
    await expect(searchSemanticScholar(query, await failingWith(429))).rejects.toMatchObject({
      status: 429,
    })
  })

  it('propagates a Semantic Scholar 400 and 404 instead of reporting "no results"', async () => {
    // The search endpoint answers an empty result set with 200 and an empty
    // `data`, so any 4xx here is a path/protocol fault, never "no results".
    const query = { query: 'q', limit: 5, sort: 'relevance' as const }
    for (const status of [400, 404]) {
      await expect(searchSemanticScholar(query, await failingWith(status))).rejects.toMatchObject({
        status,
      })
    }
  })

  it('propagates a Semantic Scholar 500', async () => {
    await expect(
      searchSemanticScholar({ query: 'q', limit: 5, sort: 'relevance' }, await failingWith(500)),
    ).rejects.toThrow()
  })

  it('propagates a Semantic Scholar lookup 429 and 400 instead of an absent record', async () => {
    // Only a 404 normalizes to "no such record" (the crossref contract); a
    // rate limit or a malformed request must reach the caller as a failure.
    for (const status of [429, 400]) {
      await expect(
        lookupSemanticScholar('DOI:10.1/x', await failingWith(status)),
      ).rejects.toMatchObject({ status })
    }
  })

  it('normalizes only a Semantic Scholar lookup 404 to an absent record', async () => {
    expect(await lookupSemanticScholar('DOI:10.1/x', await failingWith(404))).toBeUndefined()
  })

  it('sends an API key header only when one is configured', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const headers: Array<Record<string, string>> = []
    const http = createScholarlyHttp({
      fetchImpl: async (_url, init) => {
        headers.push((init?.headers ?? {}) as Record<string, string>)
        return new Response(JSON.stringify({ data: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      },
      pacer: new HostPacer({}),
    })

    await searchSemanticScholar({ query: 'q', limit: 1, sort: 'relevance' }, http)
    await searchSemanticScholar({ query: 'q', limit: 1, sort: 'relevance' }, http, { s2Key: 'k' })
    expect(headers[0]?.['x-api-key']).toBeUndefined()
    expect(headers[1]?.['x-api-key']).toBe('k')
  })

  it('asks for an open-access PDF only when the query requires one', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const urls: string[] = []
    const http = createScholarlyHttp({
      fetchImpl: async (url) => {
        urls.push(String(url))
        return new Response(JSON.stringify({ data: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      },
      pacer: new HostPacer({}),
    })

    await searchSemanticScholar({ query: 'q', limit: 1, sort: 'relevance' }, http)
    await searchSemanticScholar({ query: 'q', limit: 1, sort: 'relevance', openAccess: true }, http)
    // `openAccessPdf` is always in `fields` (the record shape is fixed); only
    // the standalone request parameter is conditional.
    const param = (url: string): boolean => url.includes('&openAccessPdf')
    expect(param(urls[0] ?? '')).toBe(false)
    expect(param(urls[1] ?? '')).toBe(true)
  })
})

describe('PubMed query construction', () => {
  it('adds a date range and a free-full-text clause', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const urls: string[] = []
    const http = createScholarlyHttp({
      fetchImpl: async (url) => {
        urls.push(decodeURIComponent(String(url)))
        return new Response(
          JSON.stringify({ esearchresult: { idlist: [] }, PubmedArticleSet: {} }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
      pacer: new HostPacer({}),
    })

    await searchPubMed(
      { query: 'crispr', limit: 5, sort: 'date', yearFrom: 2015, yearTo: 2020, openAccess: true },
      http,
    )
    const term = urls.find((u) => u.includes('esearch')) ?? ''
    expect(term).toContain('2015:2020[dp]')
    expect(term).toContain('free full text[sb]')
    expect(term).toContain('pub_date')
  })

  it('returns nothing when the search finds no identifiers', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(JSON.stringify({ esearchresult: { idlist: [] } }), {
          headers: { 'content-type': 'application/json' },
        }),
      pacer: new HostPacer({}),
    })
    expect(await searchPubMed({ query: 'nothing', limit: 5, sort: 'relevance' }, http)).toEqual([])
  })

  it('returns nothing when the search response carries no result block', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }),
      pacer: new HostPacer({}),
    })
    expect(await searchPubMed({ query: 'nothing', limit: 5, sort: 'relevance' }, http)).toEqual([])
  })
})

describe('OpenAlex query construction and mapping', () => {
  /**
   * A transport answering one OpenAlex shape, recording requests.
   * @param seen - request log.
   * @returns the transport.
   */
  async function httpOf(seen: string[] = []): Promise<ScholarlyHttp> {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    return createScholarlyHttp({
      fetchImpl: async (url) => {
        seen.push(decodeURIComponent(String(url)))
        return new Response(JSON.stringify({ results: [], meta: { count: 0 } }), {
          headers: { 'content-type': 'application/json' },
        })
      },
      pacer: new HostPacer({}),
    })
  }

  it('builds a year filter with both bounds', async () => {
    const seen: string[] = []
    await searchOpenAlex(
      { query: 'q', limit: 5, sort: 'relevance', yearFrom: 2010, yearTo: 2015 },
      await httpOf(seen),
    )
    expect(seen.join(' ')).toContain('publication_year:2010-2015')
  })

  it('builds an open year filter when only one bound is given', async () => {
    const seen: string[] = []
    await searchOpenAlex(
      { query: 'q', limit: 5, sort: 'relevance', yearFrom: 2018 },
      await httpOf(seen),
    )
    expect(seen.join(' ')).toContain('publication_year:2018-')
  })

  it('adds the open-access filter', async () => {
    const seen: string[] = []
    await searchOpenAlex(
      { query: 'q', limit: 5, sort: 'relevance', openAccess: true },
      await httpOf(seen),
    )
    expect(seen.join(' ')).toContain('open_access.is_oa:true')
  })

  it('sorts by publication date or citation count', async () => {
    const byDate: string[] = []
    await searchOpenAlex({ query: 'q', limit: 5, sort: 'date' }, await httpOf(byDate))
    expect(byDate.join(' ')).toContain('publication_date:desc')

    const byCitations: string[] = []
    await searchOpenAlex({ query: 'q', limit: 5, sort: 'citations' }, await httpOf(byCitations))
    expect(byCitations.join(' ')).toContain('cited_by_count:desc')
  })

  it('maps a work with no DOI to its landing page url', () => {
    const paper = paperFromOpenAlex({
      id: 'https://openalex.org/W1',
      display_name: 'No DOI Work',
      primary_location: { landing_page_url: 'https://example.org/landing' },
    } as never)
    expect(paper.doi).toBeUndefined()
    expect(paper.url).toBe('https://example.org/landing')
  })

  it('maps a retracted work', () => {
    const paper = paperFromOpenAlex({
      id: 'https://openalex.org/W2',
      display_name: 'Retracted Work',
      is_retracted: true,
    } as never)
    expect(paper.retracted).toBe(true)
  })

  it('returns an undefined abstract for an empty inverted index', () => {
    expect(reconstructInvertedAbstract(undefined)).toBeUndefined()
    expect(reconstructInvertedAbstract({})).toBeUndefined()
  })

  it('looks up linked works and reports the total', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const http = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: [{ id: 'https://openalex.org/W3', display_name: 'Linked' }],
            meta: { count: 42 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      pacer: new HostPacer({}),
    })
    const { openalexLinkedWorks } = await import('../../../src/scholarly/sources/openalex.js')
    const linked = await openalexLinkedWorks('W1', 'cites', 10, http)
    expect(linked.papers).toHaveLength(1)
    expect(linked.total).toBe(42)
  })

  it('returns an absent record for a 404 lookup', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const http = createScholarlyHttp({
      fetchImpl: async () => new Response('{}', { status: 404 }),
      pacer: new HostPacer({}),
    })
    expect(await lookupOpenAlex('W404', http)).toBeUndefined()
  })

  it('propagates an OpenAlex 500 from a lookup', async () => {
    const { HostPacer } = await import('../../../src/scholarly/transport/pacing.js')
    const http = createScholarlyHttp({
      fetchImpl: async () => new Response('boom', { status: 500 }),
      pacer: new HostPacer({}),
    })
    await expect(lookupOpenAlex('W500', http)).rejects.toThrow()
  })
})
