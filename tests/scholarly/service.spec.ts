/**
 * `ScholarlyService` lifecycle and the tool layer's degradation rules.
 *
 * Fixtures shared with the sibling scholarly tool specs live in `./fixtures.ts`.
 * @module tests/scholarly/service
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroServiceLike } from '../../src/scholarly/zotero-link.js'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { Context, Service } from '@deepseek-ai/cordis'
import { ScholarlyService } from '../../src/scholarly/service.js'
import { resolveScholarlyConfig } from '../../src/scholarly/config.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp, writeVolatile } from './fixtures.js'
import {
  createAllScholarlyTools,
  createScholarlySearchTool,
} from '../../src/scholarly/tools/index.js'

describe('ScholarlyService lifecycle & volatile config', () => {
  it('reads a live section through the volatile references on every call', () => {
    const ctx = new Context()
    ;(ctx as any).tools = { register: () => () => {} }
    // The loader hands the service real volatile references, never plain
    // values: a settings commit writes through the same object this instance
    // holds, so the next read sees the new value without a remount.
    const email = createVolatile<string>('initial@example.com')
    const maxResults = createVolatile<number>(15)
    const service = new ScholarlyService(ctx, { email, maxResults })

    expect(resolveScholarlyConfig(service.config).email).toBe('initial@example.com')
    expect(resolveScholarlyConfig(service.config).maxResults).toBe(15)

    writeVolatile(email, 'updated@example.com')
    writeVolatile(maxResults, 25)
    expect(resolveScholarlyConfig(service.config).email).toBe('updated@example.com')
    expect(resolveScholarlyConfig(service.config).maxResults).toBe(25)
  })
})

describe('scholarly tools degrade without inventing facts', () => {
  it('reports library status as unavailable when the Zotero lookup fails', async () => {
    // The link layer cannot tell "not held" from "could not ask"; the tool must
    // not let an unanswered lookup read as absence.
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.openalex.org/works')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W1',
                doi: 'https://doi.org/10.1234/fail.1',
                display_name: 'A Paper Whose Library Status Cannot Be Read',
                publication_year: 2020,
                authorships: [{ author: { display_name: 'A. Author' } }],
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })

    const failingZotero: ZoteroServiceLike = {
      search: async () => {
        throw new Error('local API down')
      },
    }
    const tool = createScholarlySearchTool(createMockHost(mockHttp, failingZotero))
    const result = (await tool.execute(
      { query: 'library status unavailable', sources: ['openalex'] },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).toContain('Library status unavailable for 1 of 1 results')
  })

  it('skips an unparseable library ref instead of fabricating one', async () => {
    // A ref outside the grammar is not a match: recovering a key from it would
    // assert a library the record never named.
    const mockHttp = createMockHttp((url) => {
      if (url.includes('api.openalex.org/works')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'https://openalex.org/W2',
                doi: 'https://doi.org/10.1234/odd.1',
                display_name: 'A Paper With An Unparseable Library Ref',
                publication_year: 2021,
                authorships: [{ author: { display_name: 'B. Author' } }],
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })

    const oddZotero: ZoteroServiceLike = {
      search: async () => ({
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        items: [
          {
            ref: 'zotero://user/0/items/ITEM1234',
            title: 'A Paper With An Unparseable Library Ref',
            creatorSummary: 'B. Author',
            itemType: 'journalArticle',
          },
        ],
        total: 1,
        returned: 1,
        offset: 0,
      }),
    }

    const tool = createScholarlySearchTool(createMockHost(mockHttp, oddZotero))
    const result = (await tool.execute(
      { query: 'unparseable ref', sources: ['openalex'] },
      EXEC_CONTEXT as any,
    )) as { text: string }

    expect(result.text).not.toContain('In Zotero')
  })
})

describe('ScholarlyService construction', () => {
  it('registers enabled scholarly tools and exposes a live store', async () => {
    const ctx = new Context()
    const names: string[] = []
    ;(ctx as any).tools = {
      register: (tool: { name: string }) => (names.push(tool.name), () => {}),
    }

    const service = new ScholarlyService(ctx, { enabled: createVolatile(true) })
    // Registry order, not alphabetical: cite follows citations in the factory.
    expect(names).toEqual([
      'scholarly_search',
      'scholarly_get',
      'scholarly_citations',
      'scholarly_read',
      'scholarly_cite',
      'scholarly_verify',
      'scholarly_save_to_zotero',
    ])
    expect(service.store).toBeDefined()
    expect(service.http).toBeDefined()
  })

  it('resolves the in-library link to nothing when no Zotero service is composed', async () => {
    const ctx = new Context()
    ;(ctx as any).tools = { register: () => () => {} }
    const service = new ScholarlyService(ctx, { enabled: createVolatile(false) })
    // The link is an optional dependency read through `ctx.get`; absent means
    // "no local library", which the search tool renders as no annotation.
    expect(ctx.get('zotero')).toBeUndefined()
    expect(service).toBeDefined()
  })

  it('reconciles the tool surface when the enabled flag flips live', async () => {
    // The loader writes the volatile reference and then emits the update; the
    // service must retire the old definitions and register the new set on the
    // same instance, never leaving two live copies of one tool name.
    const ctx = new Context()
    const names: string[] = []
    ;(ctx as any).tools = {
      register: (tool: { name: string }) => (names.push(tool.name), () => {}),
    }
    const enabled = createVolatile(true)
    new ScholarlyService(ctx, { enabled })
    expect(names).toHaveLength(7)

    names.length = 0
    writeVolatile(enabled, false)
    ctx.emit('loader/volatile-update', [['enabled']])
    expect(names).toHaveLength(0)

    writeVolatile(enabled, true)
    ctx.emit('loader/volatile-update', [['enabled']])
    expect(names).toHaveLength(7)
  })

  it('turns the automatic settings page off for its own namespace', async () => {
    // The component ships its own settings page (the `plugins.row.config`
    // surface), so the schema-generated one would be a second, conflicting
    // surface for the same namespace. The policy names this plugin fiber,
    // exactly as the zotero row does (`packages/settings/settings/README.md`).
    const ctx = new Context()
    ;(ctx as any).tools = { register: () => () => {} }
    const configured: Array<{ auto?: boolean; fiber: unknown }> = []
    class StubSettings extends Service {
      constructor(host: Context) {
        super(host, 'settings')
      }
      configure(presentation: { auto?: boolean }, owner: unknown): () => void {
        configured.push({ auto: presentation.auto, fiber: owner })
        return () => {}
      }
    }
    new StubSettings(ctx)
    new ScholarlyService(ctx, {})
    // The service's own `ctx.inject(['settings'], ...)` child starts once the
    // dependency is available; awaiting a child of the same dependency runs
    // the pending children first.
    await ctx.inject(['settings'], () => {})
    expect(configured).toEqual([{ auto: false, fiber: ctx.fiber }])
  })
})

describe('scholarly tool declarations', () => {
  it('declares every tool concurrency-safe and bounded by a timeout', async () => {
    const tools = createAllScholarlyTools(createMockHost(createMockHttp(() => new Response('{}'))))
    // `defineTool` validates arguments before handing them to a predicate, so
    // each declaration is exercised with the minimum valid input it accepts.
    const minimal: Record<string, Record<string, unknown>> = {
      scholarly_search: { query: 'x' },
      scholarly_get: { id: '10.1/x' },
      scholarly_citations: { id: '10.1/x', direction: 'citations' },
      scholarly_read: { id: '2301.07041' },
      scholarly_cite: { ids: ['10.1/x'], format: 'bibtex' },
      scholarly_verify: { references: ['A. Author (2020). Title.'] },
      scholarly_save_to_zotero: { title: 'A paper' },
    }
    for (const tool of tools) {
      const args = minimal[tool.name]
      expect(args, `${tool.name} needs a fixture`).toBeDefined()
      expect(tool.isConcurrencySafe?.(args as never), tool.name).toBe(
        tool.name === 'scholarly_save_to_zotero' ? false : true,
      )
      expect(tool.timeoutMs, tool.name).toBeGreaterThan(0)
      expect(tool.presentCall?.(args as never), tool.name).toBeDefined()
    }
  })

  it('renders read tools’ text bodies as a single text block', async () => {
    const tools = createAllScholarlyTools(createMockHost(createMockHttp(() => new Response('{}'))))
    for (const tool of tools.filter((tool) => tool.name !== 'scholarly_save_to_zotero')) {
      expect(tool.output.render({}, { text: 'body' }), tool.name).toEqual([
        { type: 'text', text: 'body' },
      ])
    }
  })
})
