/**
 * Adapter network pipelines: one request/response cycle per index, asserting the
 * URL each adapter builds and the record it returns.
 *
 * @module tests/scholarly/sources/sources-pipelines
 */

import { describe, expect, it } from 'vitest'
import { lookupArxiv, searchArxiv } from '../../../src/scholarly/sources/arxiv.js'
import { lookupCrossref, searchCrossref } from '../../../src/scholarly/sources/crossref.js'
import { searchDblp } from '../../../src/scholarly/sources/dblp.js'
import { lookupOpenAlex, searchOpenAlex } from '../../../src/scholarly/sources/openalex.js'
import {
  fetchPmcFullTextXml,
  lookupEuropePmc,
  searchEuropePmc,
} from '../../../src/scholarly/sources/pmc.js'
import { searchPubMed } from '../../../src/scholarly/sources/pubmed.js'
import {
  lookupSemanticScholar,
  searchSemanticScholar,
} from '../../../src/scholarly/sources/semanticscholar.js'
import { createScholarlyHttp } from '../../../src/scholarly/transport/http.js'

describe('adapter network query & lookup pipelines', () => {
  it('searches and looks up arXiv papers', async () => {
    const atomXml = `
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
    const mockHttp = createScholarlyHttp({
      fetchImpl: async () =>
        new Response(atomXml, { headers: { 'content-type': 'application/xml' } }),
    })
    const hits = await searchArxiv({ query: 'LLMs', limit: 5, sort: 'relevance' }, mockHttp)
    expect(hits.length).toBe(1)
    expect(hits[0]?.title).toBe('A Comprehensive Survey of LLMs')

    const single = await lookupArxiv('2301.07041', mockHttp)
    expect(single?.arxiv).toBe('2301.07041')
  })

  it('searches and looks up Crossref works', async () => {
    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('404')) return new Response('Not found', { status: 404 })
        if (u.includes('nature1234')) {
          return new Response(
            JSON.stringify({
              status: 'ok',
              message: {
                DOI: '10.1038/nature1234',
                title: ['Deep Learning'],
                author: [{ family: 'LeCun', given: 'Yann' }],
                'published-print': { 'date-parts': [[2015]] },
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              items: [
                {
                  DOI: '10.1038/nature1234',
                  title: ['Deep Learning'],
                  author: [{ family: 'LeCun', given: 'Yann' }],
                  'published-print': { 'date-parts': [[2015]] },
                },
              ],
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
    })

    const hits = await searchCrossref(
      { query: 'deep learning', limit: 5, sort: 'date', yearFrom: 2010, yearTo: 2020 },
      mockHttp,
      { email: 'test@example.com' },
    )
    expect(hits.length).toBe(1)
    expect(hits[0]?.doi).toBe('10.1038/nature1234')

    const item = await lookupCrossref('10.1038/nature1234', mockHttp)
    expect(item?.title).toBe('Deep Learning')

    const itemWithMail = await lookupCrossref('10.1038/nature1234', mockHttp, {
      email: 'test@example.com',
    })
    expect(itemWithMail?.title).toBe('Deep Learning')

    const citationHits = await searchCrossref(
      { query: 'deep learning', limit: 5, sort: 'citations' },
      mockHttp,
    )
    expect(citationHits.length).toBe(1)

    const missing = await lookupCrossref('10.1038/404', mockHttp)
    expect(missing).toBeUndefined()
  })

  it('searches DBLP and handles HTML challenge error', async () => {
    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('challenge')) return new Response('<html>Bot verification</html>')
        return new Response(
          JSON.stringify({
            result: {
              hits: {
                hit: [
                  {
                    info: {
                      title: 'Transformers in Vision.',
                      authors: { author: [{ text: 'Alexey Dosovitskiy' }] },
                      year: '2021',
                      venue: 'ICLR',
                    },
                  },
                ],
              },
            },
          }),
        )
      },
    })

    const hits = await searchDblp({ query: 'transformers', limit: 5, sort: 'relevance' }, mockHttp)
    expect(hits.length).toBe(1)
    expect(hits[0]?.title).toBe('Transformers in Vision')

    const filteredHits = await searchDblp(
      { query: 'transformers', limit: 5, sort: 'relevance', yearFrom: 2021, yearTo: 2021 },
      mockHttp,
    )
    expect(filteredHits.length).toBe(1)

    await expect(
      searchDblp({ query: 'challenge', limit: 5, sort: 'relevance' }, mockHttp),
    ).rejects.toThrow('DBLP returned HTML challenge')
  })

  it('searches and looks up OpenAlex works', async () => {
    const work = {
      id: 'https://openalex.org/W12345',
      doi: 'https://doi.org/10.1234/test',
      display_name: 'OpenAlex Paper',
      publication_year: 2023,
      cited_by_count: 50,
      open_access: { is_oa: true, oa_url: 'https://example.com/oa.pdf' },
      authorships: [{ author: { display_name: 'Author A' } }],
    }

    let lastUrl = ''
    let lastInit: RequestInit | undefined
    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url, init) => {
        lastUrl = String(url)
        lastInit = init
        const u = String(url)
        if (u.includes('openalex.org/works/')) return new Response(JSON.stringify(work))
        return new Response(JSON.stringify({ results: [work] }))
      },
    })

    const hits = await searchOpenAlex(
      { query: 'test', limit: 5, sort: 'citations', openAccess: true },
      mockHttp,
      { openalexKey: 'secret' },
    )
    expect(hits.length).toBe(1)
    expect(hits[0]?.openAccess).toBe(true)

    // The key travels as a bearer credential: a URL reaches error objects and
    // log lines, which a `role('secret')` field must never reach.
    expect(lastUrl).not.toContain('api_key')
    expect(lastUrl).not.toContain('secret')
    expect((lastInit?.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer secret',
    )

    const single = await lookupOpenAlex('W12345', mockHttp)
    expect(single?.title).toBe('OpenAlex Paper')
  })

  it('searches, looks up, and fetches full text from Europe PMC', async () => {
    const epmcItem = {
      id: '123456',
      title: 'PMC Clinical Trial',
      authorString: 'Smith J',
      pubYear: '2022',
      journalTitle: 'NEJM',
      pmcid: 'PMC1234567',
      pmid: '35000000',
      doi: '10.1056/NEJMoa123',
    }

    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('fullTextXML')) {
          if (u.includes('PMC999')) return new Response('Not found', { status: 404 })
          return new Response('<article><body>Full text</body></article>')
        }
        return new Response(JSON.stringify({ resultList: { result: [epmcItem] } }))
      },
    })

    const hits = await searchEuropePmc(
      { query: 'trial', limit: 5, sort: 'date', yearFrom: 2020, openAccess: true },
      mockHttp,
    )
    expect(hits.length).toBe(1)
    expect(hits[0]?.pmcid).toBe('PMC1234567')

    const byPmid = await lookupEuropePmc({ pmid: '35000000' }, mockHttp)
    expect(byPmid?.pmid).toBe('35000000')

    const xml = await fetchPmcFullTextXml('PMC1234567', mockHttp)
    expect(xml).toContain('<article>')

    const missingXml = await fetchPmcFullTextXml('PMC999', mockHttp)
    expect(missingXml).toBeUndefined()
  })

  it('searches and looks up PubMed citations', async () => {
    const esearchJson = { esearchresult: { idlist: ['99999999'] } }
    const efetchXml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>99999999</PMID><Article><ArticleTitle>PubMed Trial Result.</ArticleTitle><Journal><JournalIssue><PubDate><Year>2021</Year></PubDate></JournalIssue></Journal><AuthorList><Author><ForeName>Alice</ForeName><LastName>Brown</LastName></Author></AuthorList></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`

    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('esearch.fcgi')) {
          return new Response(JSON.stringify(esearchJson), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(efetchXml, { headers: { 'content-type': 'application/xml' } })
      },
    })

    const hits = await searchPubMed({ query: 'trial', limit: 5, sort: 'relevance' }, mockHttp, {
      ncbiKey: 'key',
    })
    expect(hits.length).toBe(1)
    expect(hits[0]?.pmid).toBe('99999999')
    expect(hits[0]?.title).toBe('PubMed Trial Result')
  })

  it('searches and looks up Semantic Scholar papers', async () => {
    const s2Paper = {
      paperId: 's2_123',
      title: 'Foundation Models',
      authors: [{ name: 'Percy Liang' }],
      year: 2021,
      venue: 'arXiv',
      citationCount: 1500,
      isOpenAccess: true,
      openAccessPdf: { url: 'https://arxiv.org/pdf/2108.07258.pdf' },
      tldr: { text: 'Comprehensive review of foundation models.' },
    }

    const mockHttp = createScholarlyHttp({
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('s2_404')) return new Response('Not found', { status: 404 })
        if (u.includes('paper/s2_123')) return new Response(JSON.stringify(s2Paper))
        return new Response(JSON.stringify({ data: [s2Paper] }))
      },
    })

    const hits = await searchSemanticScholar(
      { query: 'foundation models', limit: 5, sort: 'relevance' },
      mockHttp,
      { s2Key: 's2_secret' },
    )
    expect(hits.length).toBe(1)
    expect(hits[0]?.citations).toBe(1500)

    const single = await lookupSemanticScholar('s2_123', mockHttp)
    expect(single?.title).toBe('Foundation Models')

    const notFound = await lookupSemanticScholar('s2_404', mockHttp)
    expect(notFound).toBeUndefined()
  })
})
