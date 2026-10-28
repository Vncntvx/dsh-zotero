/**
 * `scholarly_read` addressing: section selection, chunk continuation, and the
 * outline/chunk trade-off a structured paper forces.
 *
 * @module tests/scholarly/read/read-addressing
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScholarlyTextStore } from '../../../src/scholarly/fulltext/store.js'
import { createScholarlyReadTool } from '../../../src/scholarly/tools/index.js'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from '../fixtures.js'

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
  function hostOf(): ReturnType<typeof createMockHost> {
    const cache = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-read-')))
    void cache.set('arxiv-2301.07041', {
      text: readableDoc,
      source: 'arxiv_html',
      structured: true,
      url: 'https://arxiv.org/abs/2301.07041',
    })
    return {
      ...createMockHost(
        createMockHttp(() => new Response('{}')),
        undefined,
      ),
      cache,
    } as never
  }

  it('reads a section by its number', async () => {
    const tool = createScholarlyReadTool(hostOf())
    const result = (await tool.execute(
      { id: '2301.07041', section: '2' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Section 2')
    expect(result.text).toContain('Methods paragraph')
  })

  it('reads a section by its title', async () => {
    const tool = createScholarlyReadTool(hostOf())
    const result = (await tool.execute(
      { id: '2301.07041', section: 'Results' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Results paragraph')
  })

  it('names the available sections when a section is not found', async () => {
    const tool = createScholarlyReadTool(hostOf())
    await expect(
      tool.execute({ id: '2301.07041', section: 'Nonexistent' }, EXEC_CONTEXT as never),
    ).rejects.toThrow(/Section "Nonexistent" not found\. Available main sections/)
  })

  it('continues from a character offset and reports whether more remains', async () => {
    const tool = createScholarlyReadTool(hostOf())
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
    const tool = createScholarlyReadTool(hostOf())
    const result = (await tool.execute(
      { id: '2301.07041', start: 0, max_chars: 120 },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('use outline=true')
  })
})

describe('scholarly_read outline and unstructured paths', () => {
  /** A structured document long enough to clear the resolver floor. */
  const structuredDoc = `# 1. Introduction

${'Intro text about attention mechanisms. '.repeat(20)}

# 2. Methods

${'Methods text about optimization. '.repeat(20)}`

  /** An unstructured document (a PDF-shaped body with no headings). */
  const flatDoc = `${'Continuous prose with no section headings at all. '.repeat(40)}`

  /**
   * A read host whose store holds one document under a fixed key.
   * @param text - the document body.
   * @param structured - whether the body carries markdown headings.
   * @returns the host.
   */
  function hostWith(text: string, structured: boolean): ReturnType<typeof createMockHost> {
    const cache = new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-read2-')))
    void cache.set('arxiv-2301.07050', {
      text,
      source: structured ? 'arxiv_html' : 'a PDF',
      structured,
      url: 'https://arxiv.org/abs/2301.07050',
    })
    return {
      ...createMockHost(
        createMockHttp(() => new Response('{}')),
        undefined,
      ),
      cache,
    } as never
  }

  it('lists the outline and its character spans', async () => {
    const tool = createScholarlyReadTool(hostWith(structuredDoc, true))
    const result = (await tool.execute(
      { id: '2301.07050', outline: true },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Sections (use section="..." to read)')
    expect(result.text).toContain('chars')
  })

  it('says an unstructured document has no outline', async () => {
    const tool = createScholarlyReadTool(hostWith(flatDoc, false))
    const result = (await tool.execute(
      { id: '2301.07050', outline: true },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('no section headings')
  })

  it('explains that an unstructured document cannot be addressed by section', async () => {
    const tool = createScholarlyReadTool(hostWith(flatDoc, false))
    await expect(
      tool.execute({ id: '2301.07050', section: 'Methods' }, EXEC_CONTEXT as never),
    ).rejects.toThrow(/no structured headings/)
  })

  it('reports when a query matches no passage', async () => {
    const tool = createScholarlyReadTool(hostWith(flatDoc, false))
    const result = (await tool.execute(
      { id: '2301.07050', query: 'zzzz nonexistent token' },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('No relevant passage found')
  })

  it('uses the default chunk when the caller sets no size', async () => {
    const tool = createScholarlyReadTool(hostWith(structuredDoc, true))
    const result = (await tool.execute({ id: '2301.07050', start: 0 }, EXEC_CONTEXT as never)) as {
      text: string
    }
    expect(result.text).toMatch(/Characters \d+–\d+/)
  })

  it('clamps a negative start offset to the beginning', async () => {
    const tool = createScholarlyReadTool(hostWith(structuredDoc, true))
    const result = (await tool.execute(
      { id: '2301.07050', start: -50, max_chars: 100 },
      EXEC_CONTEXT as never,
    )) as { text: string }
    expect(result.text).toContain('Characters 0–')
  })
})
