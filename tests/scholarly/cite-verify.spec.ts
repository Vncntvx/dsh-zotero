/**
 * `scholarly_cite` and `scholarly_verify` failure paths.
 *
 * Bundled citation retrieval and reference verification both confront hostile
 * input: an identifier no registry knows, a registry that answers with junk, a
 * reference whose fields disagree. Each of those is a distinct outcome the
 * model acts on, so each is exercised here.
 *
 * @module tests/scholarly/cite-verify
 */

import { describe, expect, it } from 'vitest'
import { createScholarlyCiteTool } from '../../src/scholarly/tools/cite.js'
import {
  createScholarlyVerifyTool,
  parseReferenceSnippet,
} from '../../src/scholarly/tools/verify.js'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from './fixtures.js'

describe('scholarly_cite failure paths', () => {
  it('reports a registry that does not answer with a citation', async () => {
    const host = createMockHost(
      createMockHttp(() => new Response('not a citation', { status: 200 })),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/none.1'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('reports a transport failure for one identifier without losing the others', async () => {
    const host = createMockHost(
      createMockHttp((url) =>
        String(url).includes('bad')
          ? new Response('boom', { status: 500 })
          : new Response('@article{good}', { status: 200 }),
      ),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/good.1', '10.1234/bad.1'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('accepts every declared format', async () => {
    const host = createMockHost(createMockHttp(() => new Response('@article{x}', { status: 200 })))
    const tool = createScholarlyCiteTool(host)
    for (const format of ['bibtex', 'ris', 'csljson', 'text'] as const) {
      const result = (await tool.execute(
        { ids: ['10.1234/any.1'], format },
        EXEC_CONTEXT as never,
      )) as { text: string }
      expect(result.text.length, format).toBeGreaterThan(0)
    }
  })

  it('honours a style and locale for a formatted citation', async () => {
    const seen: string[] = []
    const host = createMockHost(
      createMockHttp((_url, init) => {
        seen.push(JSON.stringify((init as RequestInit | undefined)?.headers ?? {}))
        return new Response('Formatted citation text.', { status: 200 })
      }),
    )
    const tool = createScholarlyCiteTool(host)
    await tool.execute(
      { ids: ['10.1234/styled.1'], format: 'text', style: 'ieee', locale: 'en-US' },
      EXEC_CONTEXT as never,
    )
    expect(seen.join(' ')).toContain('ieee')
  })
})

describe('scholarly_verify verdict details', () => {
  it('flags a retracted paper as CHECK with the retraction noted', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(
            JSON.stringify({
              status: 'ok',
              message: {
                DOI: '10.1234/retracted.1',
                title: ['A Retracted Study'],
                author: [{ family: 'Doe', given: 'J' }],
                'published-print': { 'date-parts': [[2015]] },
                'update-to': [{ type: 'retraction' }],
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Doe, J. (2015). A Retracted Study. doi:10.1234/retracted.1'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toMatch(/RETRACTED|CHECK/)
  })

  it('flags a DOI that belongs to a different paper', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(
            JSON.stringify({
              status: 'ok',
              message: {
                DOI: '10.1234/mismatch.1',
                title: ['An Entirely Different Work About Oceans'],
                author: [{ family: 'Other', given: 'A' }],
                'published-print': { 'date-parts': [[2015]] },
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      {
        references: ['Doe, J. (2015). Quantum Algorithms For Everyone. doi:10.1234/mismatch.1'],
      },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('CHECK')
  })

  it('flags an author mismatch', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(
            JSON.stringify({
              status: 'ok',
              message: {
                DOI: '10.1234/author.1',
                title: ['A Study Of Things'],
                author: [{ family: 'Zephyr', given: 'Z' }],
                'published-print': { 'date-parts': [[2015]] },
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Aardvark, A. (2015). A Study Of Things. doi:10.1234/author.1'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toMatch(/Author discrepancy|CHECK/)
  })

  it('caps a long list at forty references', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}', { status: 404 })))
    const tool = createScholarlyVerifyTool(host)
    const references = Array.from({ length: 50 }, (_, i) => `Author ${i} (2020). Title ${i}.`)
    const result = (await tool.execute({ references }, EXEC_CONTEXT as never)) as {
      text: string
    }
    expect(result.text).toContain('(of 40 checked)')
  })
})

describe('scholarly_verify reference parsing', () => {
  it('reads a bracketed numeric prefix, a year, and a first author', () => {
    const parsed = parseReferenceSnippet('[12] Lovelace, A. (2019). Notes on the engine.')
    expect(parsed.year).toBe(2019)
    expect(parsed.firstAuthor).toBe('lovelace')
    expect(parsed.doi).toBeUndefined()
  })

  it('extracts a normalized DOI from a URL form', () => {
    expect(parseReferenceSnippet('See https://doi.org/10.1234/abc.1 for details.').doi).toBe(
      '10.1234/abc.1',
    )
  })

  it('strips a trailing period from the DOI match', () => {
    expect(parseReferenceSnippet('A paper. doi:10.1234/def.2.').doi).toBe('10.1234/def.2')
  })

  it('reports no fields for an empty reference', () => {
    expect(parseReferenceSnippet('1234')).toEqual({
      doi: undefined,
      year: undefined,
      firstAuthor: undefined,
    })
  })
})

describe('scholarly_verify bibliographic-match branches', () => {
  /**
   * A host whose Crossref search returns one record.
   * @param record - the work to return.
   * @returns the host.
   */
  function searchHostOf(record: Record<string, unknown>): ReturnType<typeof createMockHost> {
    return createMockHost(
      createMockHttp((url) => {
        if (String(url).includes('/works?')) {
          return new Response(JSON.stringify({ status: 'ok', message: { items: [record] } }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('{}', { status: 404 })
      }),
    )
  }

  it('flags a retracted match found by title search', async () => {
    const host = searchHostOf({
      DOI: '10.1234/found.1',
      title: ['A Retracted Paper About Things'],
      author: [{ family: 'Doe', given: 'J' }],
      'published-print': { 'date-parts': [[2016]] },
      'update-to': [{ type: 'retraction' }],
    })
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Doe, J. (2016). A Retracted Paper About Things. Journal.'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toMatch(/RETRACTED|CHECK/)
  })

  it('flags a closest match that differs significantly', async () => {
    const host = searchHostOf({
      DOI: '10.1234/other.1',
      title: ['Completely Unrelated Oceanography Findings'],
      author: [{ family: 'Other', given: 'A' }],
      'published-print': { 'date-parts': [[2016]] },
    })
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Doe, J. (2016). Quantum Algorithms For Everyone. Journal.'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('CHECK')
  })

  it('accepts a match whose title is contained in the reference', async () => {
    const host = searchHostOf({
      DOI: '10.1234/contained.1',
      title: ['Attention Is All You Need'],
      author: [{ family: 'Vaswani', given: 'A' }],
      'published-print': { 'date-parts': [[2017]] },
    })
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      {
        references: [
          'Vaswani, A. (2017). Attention Is All You Need. In Advances in Neural Information Processing Systems.',
        ],
      },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('VERIFIED')
  })

  it('notes the DOI when the reference did not carry one', async () => {
    const host = searchHostOf({
      DOI: '10.1234/founddoi.1',
      title: ['Attention Is All You Need'],
      author: [{ family: 'Vaswani', given: 'A' }],
      'published-print': { 'date-parts': [[2017]] },
    })
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Vaswani, A. (2017). Attention Is All You Need. NeurIPS.'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Found with DOI')
  })
})

describe('scholarly_verify transport failure detail', () => {
  it('names the transport status when the registry refuses', async () => {
    // The failure note carries the registry's own status so an operator can tell
    // a rate limit from a wrong identifier.
    const host = createMockHost(createMockHttp(() => new Response('nope', { status: 429 })))
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Doe, J. (2020). A Paper. doi:10.1234/limited.1'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('UNVERIFIED')
    expect(result.text).toContain('429')
  })

  it('reports a non-Error rejection as its string form', async () => {
    const host = createMockHost(
      createMockHttp(() => {
        throw 'a bare string failure'
      }),
    )
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Doe, J. (2020). A Paper. doi:10.1234/throw.1'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('UNVERIFIED')
  })
})
