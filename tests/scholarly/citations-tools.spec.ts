/**
 * `scholarly_citations`: the citation-network tool — invalid identifiers, the
 * three directions, and the request shapes each direction sends. Split out of
 * `./search-tools.spec.ts` along the per-tool seam.
 * @module tests/scholarly/citations-tools
 */

import { describe, expect, it } from 'vitest'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from './fixtures.js'
import { createScholarlyCitationsTool } from '../../src/scholarly/tools/index.js'

describe('scholarly_citations tool', () => {
  it('rejects invalid or non-paper identifier', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    const tool = createScholarlyCitationsTool(host)
    await expect(
      tool.execute(
        { id: 'https://example.com/not-a-paper', direction: 'citations' },
        EXEC_CONTEXT as any,
      ),
    ).rejects.toThrow('Please provide a valid DOI, an arXiv ID, or a PMID')
  })

  it('retrieves citing papers using OpenAlex graph', async () => {
    const mockHttp = createMockHttp((url) => {
      if (
        url.includes('api.openalex.org/works/') &&
        (url.includes('nature1234') || url.includes('doi'))
      ) {
        return new Response(
          JSON.stringify({
            id: 'https://openalex.org/W999',
            doi: 'https://doi.org/10.1038/nature1234',
            display_name: 'Target Paper',
            publication_year: 2020,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('filter=cites%3AW999') || url.includes('cites:W999')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W1000',
                display_name: 'Citing Paper Alpha',
                publication_year: 2022,
                authorships: [{ author: { display_name: 'Bob Citer' } }],
                cited_by_count: 15,
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

    const host = createMockHost(mockHttp)
    const tool = createScholarlyCitationsTool(host)

    const result = (await tool.execute(
      { id: '10.1038/nature1234', direction: 'citations' },
      EXEC_CONTEXT as any,
    )) as { text: string; papers: Array<{ title: string }> }

    expect(result.text).toContain('Citing Paper Alpha')
    expect(result.text).toContain('Citing Paper Alpha')
  })

  it('retrieves referenced papers using OpenAlex graph', async () => {
    const mockHttp = createMockHttp((url) => {
      if (url.includes('nature1234')) {
        return new Response(
          JSON.stringify({
            id: 'https://openalex.org/W999',
            referenced_works: ['https://openalex.org/W888'],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('openalex.org/works?') || url.includes('openalex.org/works/')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W888',
                display_name: 'Referenced Foundational Paper',
                publication_year: 2010,
                authorships: [{ author: { display_name: 'Original Author' } }],
                cited_by_count: 500,
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })

    const host = createMockHost(mockHttp)
    const tool = createScholarlyCitationsTool(host)

    const result = (await tool.execute(
      { id: '10.1038/nature1234', direction: 'references' },
      EXEC_CONTEXT as any,
    )) as { text: string; papers: Array<{ title: string }> }

    expect(result.text).toContain('Referenced Foundational Paper')
    expect(result.text).toContain('Referenced Foundational Paper')
  })
})

describe('scholarly_citations direction handling', () => {
  /**
   * A host answering OpenAlex graph queries with one linked work.
   * @param seen - request log.
   * @returns the host.
   */
  function hostOf(seen: string[] = []): ReturnType<typeof createMockHost> {
    return createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        seen.push(value)
        if (value.includes('/works/doi%3A') || value.includes('/works/doi:')) {
          return new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              doi: 'https://doi.org/10.1234/seed.1',
              display_name: 'The Seed Paper',
              publication_year: 2020,
              authorships: [{ author: { display_name: 'A. Author' } }],
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W2',
                display_name: 'A Linked Paper',
                publication_year: 2021,
                authorships: [{ author: { display_name: 'B. Author' } }],
                cited_by_count: 3,
              },
            ],
            meta: { count: 1 },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }),
    )
  }

  it('queries a different OpenAlex relation per direction', async () => {
    const seen: string[] = []
    const tool = createScholarlyCitationsTool(hostOf(seen))
    for (const direction of ['citations', 'references', 'related'] as const) {
      await tool.execute({ id: '10.1234/seed.1', direction }, EXEC_CONTEXT as never)
    }
    // OpenAlex filter values are URL-encoded in the query string.
    const joined = decodeURIComponent(seen.join(' '))
    expect(joined).toContain('cites:W1')
    expect(joined).toContain('cited_by:W1')
    expect(joined).toContain('related_to:W1')
  })

  it('reports when the seed paper cannot be resolved', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}', { status: 404 })))
    const tool = createScholarlyCitationsTool(host)
    const result = (await tool.execute(
      { id: '10.1234/unknown.1', direction: 'citations' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('reports an empty citation graph', async () => {
    const host = createMockHost(
      createMockHttp((url) => {
        if (String(url).includes('/works/doi')) {
          return new Response(
            JSON.stringify({
              id: 'https://openalex.org/W1',
              display_name: 'Lonely Paper',
              publication_year: 2020,
              authorships: [],
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ results: [], meta: { count: 0 } }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const tool = createScholarlyCitationsTool(host)
    const result = (await tool.execute(
      { id: '10.1234/lonely.1', direction: 'citations' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text.length).toBeGreaterThan(0)
  })
})
