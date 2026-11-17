/**
 * `scholarly_verify` input shapes.
 *
 * The same tool accepts a bare DOI and a full bibliographic reference, and the
 * two establish different facts. A DOI-only entry must never be reported as a
 * title mismatch, and a field the entry did not supply must be reported as
 * `not-compared`, not as a discrepancy. Author matching also has to survive
 * institutional authors, CJK names, compound surnames, and initials-first
 * styles.
 *
 * @module tests/scholarly/verify-input-shapes
 */

import { describe, expect, it } from 'vitest'
import {
  createScholarlyVerifyTool,
  parseReferenceSnippet,
} from '../../src/scholarly/tools/verify.js'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from '../helpers/scholarly-runtime.js'

interface VerifyOutput {
  text: string
  checks: Array<{
    inputKind: 'doi' | 'reference'
    verdict: string
    doi?: string
    retracted?: boolean
    fields: { title: string; authors: string; year: string }
    notes: string[]
  }>
}

/** A Crossref work response; overrides replace top-level `message` fields. */
function registry(over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      status: 'ok',
      message: {
        DOI: '10.1234/known.1',
        title: ['A Real Study'],
        author: [{ family: 'Doe', given: 'J' }],
        'published-print': { 'date-parts': [[2015]] },
        ...over,
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

async function verify(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  references: string[],
): Promise<VerifyOutput> {
  const tool = createScholarlyVerifyTool(createMockHost(createMockHttp(handler)))
  return (await tool.execute({ references }, EXEC_CONTEXT as never)) as VerifyOutput
}

describe('scholarly_verify DOI-only input', () => {
  it('verifies a bare DOI without comparing fields it did not supply', async () => {
    const result = await verify(
      (url) =>
        url.includes('query.bibliographic') ? new Response('{}', { status: 404 }) : registry(),
      ['10.1234/known.1'],
    )

    expect(result.text).toContain('VERIFIED')
    expect(result.text).not.toContain('DOI mismatch')
    expect(result.checks[0]).toMatchObject({
      inputKind: 'doi',
      verdict: 'verified',
      doi: '10.1234/known.1',
      retracted: false,
      fields: { title: 'not-compared', authors: 'not-compared', year: 'not-compared' },
    })
  })

  it('treats a doi.org URL as a bare DOI', async () => {
    const result = await verify(() => registry(), ['https://doi.org/10.1234/known.1'])

    expect(result.checks[0]).toMatchObject({
      inputKind: 'doi',
      verdict: 'verified',
      fields: { title: 'not-compared', authors: 'not-compared', year: 'not-compared' },
    })
    expect(result.text).not.toContain('DOI mismatch')
  })

  it('reports an unregistered bare DOI as not found without a bibliographic search', async () => {
    const urls: string[] = []
    const result = await verify(
      (url) => {
        urls.push(String(url))
        return new Response('{}', { status: 404 })
      },
      ['10.1234/missing.1'],
    )

    expect(result.checks[0]).toMatchObject({ inputKind: 'doi', verdict: 'not_found' })
    expect(result.text).toContain('is not registered in Crossref')
    expect(urls.some((url) => url.includes('query.bibliographic'))).toBe(false)
  })

  it('marks a retracted bare DOI as CHECK with the retraction noted', async () => {
    const result = await verify(
      () => registry({ 'updated-by': [{ type: 'retraction' }] }),
      ['10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({ inputKind: 'doi', verdict: 'check', retracted: true })
    expect(result.text).toContain('RETRACTED')
    expect(result.text).not.toContain('DOI mismatch')
  })
})

describe('scholarly_verify reference parsing', () => {
  it('does not present punctuation, numbers, or a long span as an author', () => {
    expect(parseReferenceSnippet(', A. (2015). Title.').leadingName).toBeUndefined()
    expect(parseReferenceSnippet('1234, A. (2015). Title.').leadingName).toBeUndefined()
    expect(
      parseReferenceSnippet('One Two Three Four Five Six (2015). Title.').leadingName,
    ).toBeUndefined()
  })
})

describe('scholarly_verify field-level comparison', () => {
  it('compares only the title when the reference supplies only a title and DOI', async () => {
    const result = await verify(() => registry(), ['A Real Study. doi:10.1234/known.1'])

    expect(result.checks[0]).toMatchObject({
      inputKind: 'reference',
      verdict: 'verified',
      fields: { title: 'match', authors: 'not-compared', year: 'not-compared' },
    })
  })

  it('reports a missing reference author as not compared', async () => {
    const result = await verify(() => registry(), ['A Real Study (2015). doi:10.1234/known.1'])

    expect(result.checks[0]).toMatchObject({
      fields: { title: 'match', authors: 'not-compared', year: 'match' },
    })
  })

  it('does not fail when the registry lists no authors', async () => {
    const result = await verify(
      () => registry({ author: undefined }),
      ['Doe, J. (2015). A Real Study. doi:10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({
      verdict: 'verified',
      fields: { title: 'match', authors: 'not-compared', year: 'match' },
    })
    expect(result.text).toContain('lists no authors')
  })

  it('matches an institutional author on its full name', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['Global Report'],
          author: [{ name: 'World Health Organization' }],
          'published-print': { 'date-parts': [[2020]] },
        }),
      ['World Health Organization. (2020). Global Report. doi:10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({
      verdict: 'verified',
      fields: { title: 'match', authors: 'match', year: 'match' },
    })
  })

  it('matches a CJK surname attached to its given name', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['一项研究'],
          author: [{ family: '张', given: '三' }],
          'published-print': { 'date-parts': [[2021]] },
        }),
      ['张三, 李四 (2021). 一项研究. doi:10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({
      verdict: 'verified',
      fields: { title: 'match', authors: 'match', year: 'match' },
    })
  })

  it('matches a compound surname written before the given name', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['Cien años de soledad'],
          author: [{ family: 'García Márquez', given: 'Gabriel' }],
          'published-print': { 'date-parts': [[2019]] },
        }),
      ['García Márquez, G. (2019). Cien años de soledad. doi:10.1234/known.1'],
    )

    expect(result.checks[0].fields.authors).toBe('match')
  })

  it('matches an initials-first author style', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['Attention Is All You Need'],
          author: [{ family: 'Vaswani', given: 'Ashish' }],
          'published-print': { 'date-parts': [[2017]] },
        }),
      ['A. Vaswani, N. Shazeer (2017). Attention Is All You Need. NeurIPS. doi:10.1234/known.1'],
    )

    expect(result.checks[0].fields.authors).toBe('match')
  })

  it('matches a surname-then-initials author without a comma', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['Attention Is All You Need'],
          author: [{ family: 'Vaswani', given: 'Ashish' }],
          'published-print': { 'date-parts': [[2017]] },
        }),
      ['Vaswani A (2017). Attention Is All You Need. NeurIPS. doi:10.1234/known.1'],
    )

    expect(result.checks[0].fields.authors).toBe('match')
  })

  it('reports a registry record without a year as not compared', async () => {
    const result = await verify(
      () => registry({ 'published-print': undefined }),
      ['Doe, J. (2015). A Real Study. doi:10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({
      verdict: 'verified',
      fields: { title: 'match', authors: 'match', year: 'not-compared' },
    })
    expect(result.text).toContain('no publication year')
  })

  it('does not match an institution against a short acronym', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['Global Report'],
          author: [{ name: 'WHO' }],
          'published-print': { 'date-parts': [[2020]] },
        }),
      ['World Health Organization (2020). Global Report. doi:10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({
      verdict: 'check',
      fields: { authors: 'mismatch' },
    })
  })

  it('matches an institutional author whose reference adds a subtitle', async () => {
    const result = await verify(
      () =>
        registry({
          title: ['Global Report'],
          author: [{ name: 'World Health Organization' }],
          'published-print': { 'date-parts': [[2020]] },
        }),
      ['World Health Organization Global Report (2020). doi:10.1234/known.1'],
    )

    expect(result.checks[0]).toMatchObject({
      verdict: 'verified',
      fields: { authors: 'match' },
    })
  })

  it('accepts a one-year online-first difference but rejects two years', async () => {
    const near = await verify(
      () => registry(),
      ['Doe, J. (2016). A Real Study. doi:10.1234/known.1'],
    )
    expect(near.checks[0]).toMatchObject({ verdict: 'verified', fields: { year: 'match' } })

    const far = await verify(
      () => registry(),
      ['Doe, J. (2017). A Real Study. doi:10.1234/known.1'],
    )
    expect(far.checks[0]).toMatchObject({ verdict: 'check', fields: { year: 'mismatch' } })
    expect(far.text).toContain('Year discrepancy')
  })
})
