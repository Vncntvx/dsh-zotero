/**
 * `scholarly_read` addressing: section selection, chunk continuation, and the
 * outline/chunk trade-off a structured paper forces.
 *
 * @module tests/scholarly/read/read-addressing
 */

import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { rankPassages } from '../../../src/scholarly/fulltext/evidence-bridge.js'
import { bm25EvidenceRanker } from '../../../src/local/evidence-ranker.js'
import { createScholarlyReadTool } from '../../../src/scholarly/tools/index.js'
import {
  noPassageMessage,
  PLAIN_TEXT_OUTLINE_MESSAGE,
  NO_SECTION_HEADINGS_MESSAGE,
} from '../../../src/scholarly/tools/read.js'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from '../fixtures.js'

const hosts: ReturnType<typeof createMockHost>[] = []
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map(async (host) => {
      await host.http.dispose()
      host.cache?.dispose()
      if (host.cache) await rm(host.cache.root, { recursive: true, force: true })
    }),
  )
})

describe('scholarly_read section addressing', () => {
  /** A doc with a numbered outline and enough body text to clear the floor. */
  const readableDoc = `# 1. Introduction

Intro paragraph about self-attention. ${'Filler text for the introduction. '.repeat(12)}

# 2. Methods

Methods paragraph. ${'Filler text for the methods. '.repeat(12)}

## 2.1 Optimization

AdamW optimizer with a learning rate schedule. ${'Filler for optimization. '.repeat(12)}

# 3. Results

Results paragraph. ${'Filler text for the results. '.repeat(12)}`

  /**
   * A read host whose store already holds the document.
   * @returns the host.
   */
  async function hostOf(): Promise<ReturnType<typeof createMockHost>> {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    hosts.push(host)
    await host.cache!.set('arxiv-2301.07041', {
      provider: 'arxiv-html',
      format: 'markdown',
      text: readableDoc,
      source: 'arxiv_html',
      url: 'https://arxiv.org/html/2301.07041',
      sourceIdentity: 'https://arxiv.org/html/2301.07041',
    })
    return host
  }

  it('reads a section by its number', async () => {
    const tool = createScholarlyReadTool(await hostOf())
    const result = (await tool.execute(
      { id: '2301.07041', section: '2' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Section 2')
    expect(result.text).toContain('Methods paragraph')
  })

  it('reads a section by its title', async () => {
    const tool = createScholarlyReadTool(await hostOf())
    const result = (await tool.execute(
      { id: '2301.07041', section: 'Results' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Results paragraph')
  })

  it('names the available sections when a section is not found', async () => {
    const tool = createScholarlyReadTool(await hostOf())
    await expect(
      tool.execute({ id: '2301.07041', section: 'Nonexistent' }, EXEC_CONTEXT as never),
    ).rejects.toThrow(/Section "Nonexistent" not found\. Available main sections/)
  })

  it('continues from a character offset and reports whether more remains', async () => {
    const tool = createScholarlyReadTool(await hostOf())
    const first = (await tool.execute(
      { id: '2301.07041', start: 0, max_chars: 200 },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(first.text).toContain('is_truncated: true')
    expect(first.text).toMatch(/next_start: \d+/)

    const last = (await tool.execute(
      { id: '2301.07041', start: readableDoc.length - 50, max_chars: 200 },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(last.text).toContain('is_truncated: false')
  })

  it('suggests the outline when chunking a structured paper from the start', async () => {
    const tool = createScholarlyReadTool(await hostOf())
    const result = (await tool.execute(
      { id: '2301.07041', start: 0, max_chars: 120 },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('use outline=true')
  })
})

describe('scholarly_read outline and unstructured paths', () => {
  /** A structured document long enough to clear the resolver floor. */
  const markdownDoc = `# 1. Introduction

${'Intro text about attention mechanisms. '.repeat(20)}

# 2. Methods

${'Methods text about optimization. '.repeat(20)}`

  /** An unstructured document (a PDF-shaped body with no headings). */
  const flatDoc = `${'Continuous prose with no section headings at all. '.repeat(40)}`

  /**
   * A read host whose store holds one document under a fixed key.
   * @param text - the document body.
   * @param format - the source's actual text format.
   * @returns the host.
   */
  async function hostWith(
    text: string,
    format: 'markdown' | 'text',
  ): Promise<ReturnType<typeof createMockHost>> {
    const host = createMockHost(createMockHttp(() => new Response('{}')))
    hosts.push(host)
    const url =
      format === 'markdown'
        ? 'https://arxiv.org/html/2301.07050'
        : 'https://arxiv.org/pdf/2301.07050'
    const body = {
      text,
      source: format === 'markdown' ? 'arxiv_html' : 'a PDF',
      url,
      sourceIdentity: url,
    }
    await host.cache!.set(
      'arxiv-2301.07050',
      format === 'markdown'
        ? { ...body, provider: 'arxiv-html', format }
        : { ...body, provider: 'pdf-extract', format },
    )
    return host
  }

  it('lists the outline and its character spans', async () => {
    const tool = createScholarlyReadTool(await hostWith(markdownDoc, 'markdown'))
    const result = (await tool.execute(
      { id: '2301.07050', outline: true },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Sections (use section="..." to read)')
    expect(result.text).toContain('chars')
  })

  it('says an unstructured document has no outline', async () => {
    const tool = createScholarlyReadTool(await hostWith(flatDoc, 'text'))
    const result = (await tool.execute(
      { id: '2301.07050', outline: true },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain(PLAIN_TEXT_OUTLINE_MESSAGE)
  })

  it('explains that an unstructured document cannot be addressed by section', async () => {
    const tool = createScholarlyReadTool(await hostWith(flatDoc, 'text'))
    await expect(
      tool.execute({ id: '2301.07050', section: 'Methods' }, EXEC_CONTEXT as never),
    ).rejects.toThrow(NO_SECTION_HEADINGS_MESSAGE)
  })

  it('reports when a query matches no passage', async () => {
    const tool = createScholarlyReadTool(await hostWith(flatDoc, 'text'))
    const result = (await tool.execute(
      { id: '2301.07050', query: 'zzzz nonexistent token' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain(noPassageMessage('zzzz nonexistent token', ['lexical']))
    // The message must refuse the stronger claim: an empty match is a fact
    // about this query, not about the paper.
    expect(result.text).toContain('not evidence that the paper says nothing')
    // And it must name a way forward.
    expect(result.text).toContain('queryVariants')
  })

  it('uses the default chunk when the caller sets no size', async () => {
    const tool = createScholarlyReadTool(await hostWith(markdownDoc, 'markdown'))
    const result = (await tool.execute({ id: '2301.07050', start: 0 }, EXEC_CONTEXT as never)) as {
      text: string
    }
    expect(result.text).toMatch(/Characters \d+–\d+/)
  })

  it('clamps a negative start offset to the beginning', async () => {
    const tool = createScholarlyReadTool(await hostWith(markdownDoc, 'markdown'))
    const result = (await tool.execute(
      { id: '2301.07050', start: -50, max_chars: 100 },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Characters 0–')
  })

  it('ranks passages through the host strategy', async () => {
    expect(
      (await rankPassages({ ranker: bm25EvidenceRanker, text: '', query: 'query' })).passages,
    ).toEqual([])
    expect(
      (await rankPassages({ ranker: bm25EvidenceRanker, text: markdownDoc, query: '   ' }))
        .passages,
    ).toEqual([])
    const { passages: ranked } = await rankPassages({
      ranker: bm25EvidenceRanker,
      text: markdownDoc,
      query: 'optimization',
      limit: 2,
    })
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]?.text).toBeDefined()
  })
})
