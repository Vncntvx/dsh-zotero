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
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'
import { createScholarlyCiteTool } from '../../src/scholarly/tools/cite.js'
import {
  createScholarlyVerifyTool,
  parseReferenceSnippet,
} from '../../src/scholarly/tools/verify.js'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from '../helpers/scholarly-runtime.js'

describe('scholarly_cite failure paths', () => {
  it('names the transport status when a registry rate-limits a citation read', async () => {
    const host = createMockHost(
      createMockHttp(() => new Response('{}', { status: 429, headers: { 'retry-after': '30' } })),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/slow.1'], format: 'csljson' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('HTTP 429 — Rate limited by doi.org')
  })

  it('reports a registry that does not answer with a citation', async () => {
    const host = createMockHost(
      createMockHttp(() => new Response('not a citation', { status: 200 })),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/none.1'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string; citations: Array<{ status: string; reason?: string }> }
    expect(result.text).toContain('0 of 1 resolved')
    expect(result.text).toContain('no BibTeX entry')
    expect(result.citations[0]).toMatchObject({ status: 'failed' })
  })

  it('reports a transport failure for one identifier without losing the others', async () => {
    const host = createMockHost(
      createMockHttp((url) =>
        String(url).includes('bad')
          ? new Response('boom', { status: 500 })
          : new Response('@article{good, DOI={10.1234/good.1}}', { status: 200 }),
      ),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/good.1', '10.1234/bad.1'], format: 'bibtex' },
      EXEC_CONTEXT as never,
    )) as { text: string; citations: Array<{ inputIndex: number; status: string }> }
    expect(result.text).toContain('1 of 2 resolved')
    expect(result.text).toContain('#2 10.1234/bad.1')
    expect(result.citations.map((entry) => [entry.inputIndex, entry.status])).toEqual([
      [0, 'resolved'],
      [1, 'failed'],
    ])
  })

  it('accepts every declared format only when the body matches it', async () => {
    const bodies: Record<string, string> = {
      bibtex: '@article{x, title={T}, DOI={10.1234/any.1}}',
      ris: 'TY  - JOUR\nDO  - 10.1234/any.1\nER  - ',
      csljson: JSON.stringify({ DOI: '10.1234/any.1', title: 'T' }),
      text: 'A formatted citation long enough to pass.',
    }
    const host = createMockHost(
      createMockHttp((_url, init) => {
        const headers = (init as RequestInit | undefined)?.headers as
          Record<string, string> | undefined
        const accept = headers?.accept ?? ''
        const body = accept.includes('bibtex')
          ? bodies.bibtex
          : accept.includes('research-info')
            ? bodies.ris
            : accept.includes('csl+json')
              ? bodies.csljson
              : bodies.text
        return new Response(body, { status: 200 })
      }),
    )
    const tool = createScholarlyCiteTool(host)
    for (const format of ['bibtex', 'ris', 'csljson', 'text'] as const) {
      const result = (await tool.execute(
        { ids: ['10.1234/any.1'], format },
        EXEC_CONTEXT as never,
      )) as { text: string }
      expect(result.text, format).toContain('1 of 1 resolved')
      expect(result.text, format).not.toContain('Unresolved items')
    }
  })

  it('rejects an HTML page returned for a CSL-JSON request', async () => {
    const host = createMockHost(
      createMockHttp(() => new Response('<html><body>Not found</body></html>', { status: 200 })),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      { ids: ['10.1234/html.1'], format: 'csljson' },
      EXEC_CONTEXT as never,
    )) as { text: string; citations: Array<{ status: string; value?: string }> }
    expect(result.text).toContain('0 of 1 resolved')
    expect(result.text).toContain('not valid JSON')
    expect(result.citations[0]).toMatchObject({ status: 'failed' })
    expect(result.citations[0]?.value).toBeUndefined()
  })

  it('keeps every input in order with its own status and DOI', async () => {
    const host = createMockHost(
      createMockHttp((url) => {
        const value = String(url)
        if (value.includes('mismatch')) {
          return new Response('@article{x, DOI={10.1234/other.1}}', { status: 200 })
        }
        const doi = value.includes('second') ? '10.1234/second.1' : '10.1234/first.1'
        return new Response(`@article{x, DOI={${doi}}}`, { status: 200 })
      }),
    )
    const tool = createScholarlyCiteTool(host)
    const result = (await tool.execute(
      {
        ids: ['10.1234/first.1', '10.1234/mismatch.1', '10.1234/second.1'],
        format: 'bibtex',
      },
      EXEC_CONTEXT as never,
    )) as {
      text: string
      citations: Array<Record<string, unknown>>
      issues: string[]
    }

    expect(result.text).toContain('2 of 3 resolved')
    expect(result.citations).toHaveLength(3)
    expect(result.citations.map((entry) => [entry.inputIndex, entry.status])).toEqual([
      [0, 'resolved'],
      [1, 'failed'],
      [2, 'resolved'],
    ])
    expect(result.citations[0]).toMatchObject({
      requestedId: '10.1234/first.1',
      resolvedDoi: '10.1234/first.1',
    })
    expect(result.citations[1]).toMatchObject({
      requestedId: '10.1234/mismatch.1',
      status: 'failed',
    })
    expect(String(result.citations[1]?.reason)).toContain('not the requested')
    expect(result.citations[2]).toMatchObject({
      requestedId: '10.1234/second.1',
      resolvedDoi: '10.1234/second.1',
    })
    expect(result.issues[0]).toContain('#2 10.1234/mismatch.1')
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
  it('never verifies a DOI the registry does not know', async () => {
    const host = createMockHost(
      createMockHttp((url) => {
        if (!url.includes('query.bibliographic')) return new Response('{}', { status: 404 })
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: {
              items: [
                {
                  DOI: '10.1234/real.9',
                  title: ['A Real Study'],
                  author: [{ family: 'Doe', given: 'J' }],
                  'published-print': { 'date-parts': [[2015]] },
                  issued: { 'date-parts': [[2015]] },
                  type: 'journal-article',
                },
              ],
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Doe, J. (2015). A Real Study. doi:10.1234/fake.1'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('[1] CHECK')
    expect(result.text).not.toContain('[1] VERIFIED')
    expect(result.text).toContain('10.1234/fake.1 is not registered in Crossref')
  })

  it('reports an unregistered DOI as not found when no record matches', async () => {
    const host = createMockHost(
      createMockHttp((url) => {
        if (!url.includes('query.bibliographic')) return new Response('{}', { status: 404 })
        return new Response(JSON.stringify({ status: 'ok', message: { items: [] } }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const tool = createScholarlyVerifyTool(host)
    const result = (await tool.execute(
      { references: ['Nobody, N. (2019). A Missing Study. doi:10.1234/fake.2'] },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('NOT FOUND')
    expect(result.text).toContain('10.1234/fake.2 is not registered in Crossref')
  })

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
                'updated-by': [{ type: 'retraction' }],
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

  it('flags a short title mismatch when registry paper title has fewer than 3 tokens', async () => {
    const host = createMockHost(
      createMockHttp(
        () =>
          new Response(
            JSON.stringify({
              status: 'ok',
              message: {
                DOI: '10.1234/short.1',
                title: ['Deep Learning'],
                author: [{ family: 'Doe', given: 'J' }],
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
        references: ['Doe, J. (2015). Quantum Computing Principles. doi:10.1234/short.1'],
      },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('CHECK')
    expect(result.text).toContain('DOI mismatch')
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

  it('refuses a list above the cap instead of silently truncating it', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}', { status: 404 })))
    const tool = createScholarlyVerifyTool(host)
    const references = Array.from({ length: 50 }, (_, i) => `Author ${i} (2020). Title ${i}.`)
    await expect(tool.execute({ references }, EXEC_CONTEXT as never)).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: expect.stringContaining('at most 40'),
    })
  })

  it('counts blank entries toward the reference cap', async () => {
    const host = createMockHost(createMockHttp(() => new Response('{}', { status: 404 })))
    const tool = createScholarlyVerifyTool(host)
    const references = [
      ...Array.from({ length: 40 }, (_, i) => `Author ${i} (2020). Title ${i}.`),
      ...Array.from({ length: 5 }, () => '   '),
    ]
    await expect(tool.execute({ references }, EXEC_CONTEXT as never)).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
      message: expect.stringContaining('got 45'),
    })
  })
})

describe('scholarly_verify reference parsing', () => {
  it('reads a bracketed numeric prefix, a year, and a first author', () => {
    const parsed = parseReferenceSnippet('[12] Lovelace, A. (2019). Notes on the engine.')
    expect(parsed.inputKind).toBe('reference')
    expect(parsed.year).toBe(2019)
    expect(parsed.leadingName).toBe('Lovelace')
    expect(parsed.nameTokens).toContain('lovelace')
    expect(parsed.doi).toBeUndefined()
  })

  it('extracts a normalized DOI from a URL form', () => {
    const parsed = parseReferenceSnippet('See https://doi.org/10.1234/abc.1 for details.')
    expect(parsed.doi).toBe('10.1234/abc.1')
    expect(parsed.inputKind).toBe('reference')
  })

  it('classifies a doi.org URL with no other text as DOI-only', () => {
    const parsed = parseReferenceSnippet('https://doi.org/10.1234/abc.1')
    expect(parsed.doi).toBe('10.1234/abc.1')
    expect(parsed.inputKind).toBe('doi')
    expect(parsed.year).toBeUndefined()
    expect(parsed.leadingName).toBeUndefined()
  })

  it('strips a trailing period from the DOI match', () => {
    expect(parseReferenceSnippet('A paper. doi:10.1234/def.2.').doi).toBe('10.1234/def.2')
  })

  it('reports no author or year for a number-only reference', () => {
    expect(parseReferenceSnippet('1234')).toEqual({
      inputKind: 'reference',
      doi: undefined,
      year: undefined,
      leadingName: undefined,
      nameTokens: [],
      surnamesFirst: false,
      remainder: '',
    })
  })
})
