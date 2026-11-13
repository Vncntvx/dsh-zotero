/**
 * `scholarly_read query=`: the ranking scope is admitted before the source
 * read, so an accepted request keeps its committed generation for the whole
 * read, and the caller releases it exactly once.
 * @module tests/scholarly/read/read-ranking-scope
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bm25EvidenceRanker, type EvidenceRankRequest } from '../../../src/local/evidence-ranker.js'
import { ScholarlyTextStore } from '../../../src/scholarly/fulltext/store.js'
import { createScholarlyReadTool } from '../../../src/scholarly/tools/index.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from '../fixtures.js'

const doc = `
# 1. Introduction

The study of transformer attention scaling across computational frontiers.

# 2. Results

Empirical results indicate strong convergence under AdamW schedule.
`

describe('scholarly_read ranking scope', () => {
  it('admits before source I/O and forwards the handle to the ranker', async () => {
    const cache = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-scope-')))
    await cache.set('arxiv-2301.07042', {
      provider: 'arxiv-html',
      format: 'markdown',
      text: doc,
      source: 'arxiv_html',
      url: 'https://arxiv.org/html/2301.07042',
      sourceIdentity: 'https://arxiv.org/html/2301.07042',
    })
    const order: string[] = []
    const originalGet = cache.get.bind(cache)
    ;(cache as unknown as { get: (key: string) => Promise<unknown> }).get = async (key: string) => {
      order.push('source-read')
      return await originalGet(key)
    }
    const handle = Symbol('ranking-scope')
    const ranker = {
      admit: () => {
        order.push('admit')
        return { handle, release: () => order.push('release') }
      },
      rank: async (request: EvidenceRankRequest) => {
        order.push(request.scope === handle ? 'rank:scoped' : 'rank:unscoped')
        return await bm25EvidenceRanker.rank(request)
      },
    }
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    host.cache = cache
    host.evidenceRanker = () => ranker
    const tool = createScholarlyReadTool(host)
    const result = (await tool.execute(
      { id: '2301.07042', query: 'attention' },
      EXEC_CONTEXT as never,
    )) as { text: string }

    expect(result.text).toContain('Top passages matching')
    expect(order[0]).toBe('admit')
    expect(order).toContain('source-read')
    expect(order).toContain('rank:scoped')
    expect(order[order.length - 1]).toBe('release')
  })
})
