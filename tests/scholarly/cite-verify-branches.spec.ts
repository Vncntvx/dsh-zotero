/** `scholarly_verify`'s title-match branches and transport detail arms. */

import { describe, expect, it } from 'vitest'
import { createScholarlyVerifyTool } from '../../src/scholarly/tools/verify.js'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from './fixtures.js'

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
      'updated-by': [{ type: 'retraction' }],
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
    expect(result.text).toContain('scholarly_get')
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
