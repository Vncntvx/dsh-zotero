/** Real tool execution checks identifier, author and caller-supplied limit contracts. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { bootToolContext } from '../helpers/lanes/tool-context.js'
import { createMockHost, createMockHttp } from '../helpers/scholarly-runtime.js'
import { createScholarlyGetTool } from '../../src/scholarly/tools/get.js'
import { createScholarlyReadTool } from '../../src/scholarly/tools/read.js'
import { createScholarlySearchTool } from '../../src/scholarly/tools/search.js'
import { createScholarlyVerifyTool } from '../../src/scholarly/tools/verify.js'
import { createScholarlyCitationsTool } from '../../src/scholarly/tools/citations.js'

let ctx: Awaited<ReturnType<typeof bootToolContext>>
beforeEach(async () => {
  ctx = await bootToolContext()
})
afterEach(async () => {
  await ctx.fiber.dispose()
})
async function run(tool: ToolDefinition, args: Record<string, unknown>) {
  ctx.tools.register(tool)
  return await executeModelToolFixture(ctx, {
    callId: ToolCallId('scholarly-contract'),
    name: tool.name,
    arguments: args,
    signal: new AbortController().signal,
  })
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })

it('refuses a bare landing-page URL before fetching any scholarly index', async () => {
  const fetch = vi.fn(() => json({}))
  const result = await run(createScholarlyGetTool(createMockHost(createMockHttp(fetch))), {
    id: 'https://publisher.example/article/landing',
  })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result)).toContain('ZOTERO_INVALID_ARGUMENT')
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['https://doi.org/10.1234/contract', 'https://pubmed.ncbi.nlm.nih.gov/12345678/'])(
  'resolves an identifier embedded in %s',
  async (id) => {
    const seen: string[] = []
    const result = await run(
      createScholarlyGetTool(
        createMockHost(
          createMockHttp((url) => {
            seen.push(url)
            return new Response('missing', { status: 404 })
          }),
        ),
      ),
      { id },
    )
    expect(result.isError).toBe(false)
    expect(seen.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain('A URL has no scholarly record')
  },
)

it.each([
  {
    authors: [
      { family: 'Liang', given: 'Alice' },
      { family: 'Smith', given: 'Bob' },
    ],
  },
  {
    authors: [
      { family: 'Smith', given: 'Bob' },
      { family: 'Li', given: 'Alice' },
    ],
  },
  {
    authors: Array.from({ length: 300 }, (_, i) => ({
      family: i === 299 ? 'Li' : `Smith${i}`,
      given: 'A',
    })),
  },
])('rejects a substring or later collaborator as the first author', async ({ authors }) => {
  const host = createMockHost(
    createMockHttp((url) =>
      url.includes('/works?')
        ? json({
            status: 'ok',
            message: {
              items: [
                {
                  DOI: '10.1234/authors',
                  title: ['Attention Is All You Need'],
                  author: authors,
                  'published-print': { 'date-parts': [[2017]] },
                },
              ],
            },
          })
        : new Response('missing', { status: 404 }),
    ),
  )
  const result = await run(createScholarlyVerifyTool(host), {
    references: ['Li, A. (2017). Attention Is All You Need.'],
  })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.value)).toContain('Author discrepancy')
  expect(JSON.stringify(result.value)).toContain('"verdict":"check"')
})

it('honors a 100-character read instead of raising it to 500', async () => {
  const host = createMockHost(
    createMockHttp(() => {
      throw new Error('A cached read must not fetch')
    }),
  )
  await host.cache.set('arxiv-2301.07041', {
    provider: 'arxiv-html',
    format: 'markdown',
    text: '字'.repeat(600),
    source: 'arxiv-html',
    url: 'https://arxiv.org/html/2301.07041',
    sourceIdentity: 'https://arxiv.org/html/2301.07041',
  })
  const result = await run(createScholarlyReadTool(host), { id: '2301.07041', max_chars: 100 })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.value)).toContain('next_start: 100')
  expect(JSON.stringify(result.value)).not.toContain('字'.repeat(101))
})

it.each([0, -1, 10_001])('refuses max_chars=%i before any source work', async (max_chars) => {
  const fetch = vi.fn(() => json({}))
  const result = await run(createScholarlyReadTool(createMockHost(createMockHttp(fetch))), {
    id: '2301.07041',
    max_chars,
  })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result)).toContain('max_chars must be between 1 and 10000')
  expect(fetch).not.toHaveBeenCalled()
})

it('passes the explicit future year unchanged to the source', async () => {
  const seen: URL[] = []
  const result = await run(
    createScholarlySearchTool(
      createMockHost(
        createMockHttp((url) => {
          seen.push(new URL(url))
          return json({ results: [] })
        }),
      ),
    ),
    { query: 'prospective study', sources: ['openalex'], year_to: 2035 },
  )
  expect(result.isError).toBe(false)
  expect(seen[0]?.searchParams.get('filter')).toContain('publication_year:-2035')
})

it('orders the documented relevance candidate windows by date across sources', async () => {
  const seen: URL[] = []
  const year = new Date().getFullYear()
  const host = createMockHost(
    createMockHttp((url) => {
      seen.push(new URL(url))
      if (url.includes('api.openalex.org'))
        return json({
          results: [
            {
              id: 'https://openalex.org/W123',
              display_name: 'Older source candidate',
              publication_year: year,
              publication_date: `${year}-01-02`,
            },
          ],
        })
      return json({
        message: {
          items: [
            {
              DOI: '10.1234/newest',
              title: ['Newest source candidate'],
              issued: { 'date-parts': [[year, 1, 4]] },
            },
            {
              DOI: '10.1234/middle',
              title: ['Middle source candidate'],
              issued: { 'date-parts': [[year, 1, 3]] },
            },
          ],
        },
      })
    }),
  )
  const result = await run(createScholarlySearchTool(host), {
    query: 'source candidate',
    sources: ['openalex', 'crossref'],
    sort: 'date',
    limit: 2,
  })
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({
    papers: [{ title: 'Newest source candidate' }, { title: 'Middle source candidate' }],
  })
  const openalex = seen.find((url) => url.hostname === 'api.openalex.org')!
  const crossref = seen.find((url) => url.hostname === 'api.crossref.org')!
  expect(openalex.searchParams.get('per-page')).toBe('6')
  expect(crossref.searchParams.get('rows')).toBe('6')
  expect(openalex.searchParams.get('sort')).toBeNull()
  expect(crossref.searchParams.get('sort')).toBeNull()
})

it.each(['lookup', 'graph'])(
  'reports a %s outage with issues instead of claiming no citations',
  async (stage) => {
    const host = createMockHost(
      createMockHttp((url) =>
        stage === 'lookup' || url.includes('/works?')
          ? new Response('limited', { status: 429 })
          : json({ id: 'https://openalex.org/W123', display_name: 'Target work' }),
      ),
    )
    const result = await run(createScholarlyCitationsTool(host), {
      id: '10.1234/citations',
      direction: 'citations',
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value)).toContain('Every scholarly index was unavailable')
    expect(JSON.stringify(result.value)).toContain('"issues":["OpenAlex (')
    expect(JSON.stringify(result.value)).toContain('429')
    expect(JSON.stringify(result.value)).not.toContain('No papers found')
  },
)
