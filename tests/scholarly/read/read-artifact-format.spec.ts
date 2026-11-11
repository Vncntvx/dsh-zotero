/** Scholarly read format, artifact provenance, and raw source offsets. */
import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { createScholarlyReadTool } from '../../../src/scholarly/tools/read.ts'
import type { FulltextLookupResult } from '../../../src/local/fulltext-enhancer.ts'
import { createMockHost, createMockHttp, EXEC_CONTEXT } from '../fixtures.ts'

const url = 'https://example.org/markdown.pdf'
const markdown =
  '# 1. Introduction\n\nBackground attention evidence.\n\n## 2. Methods\n\n  Attention preserves raw whitespace.\n\n# 3. Results\n\nEnd.'
const provenance = {
  parser: 'mineru' as const,
  mode: 'free' as const,
  artifactId: 'verified-artifact',
  fingerprint: 'b'.repeat(64),
  sourceId: 'a'.repeat(64),
  generation: '24e3e1af-1b8e-4da3-933d-0139d6f748bf',
}
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

function toolOf(text: string) {
  const host = createMockHost(
    createMockHttp(() => {
      throw new Error('artifact hit must not download')
    }),
  )
  host.enrichmentEnhancer = () => ({
    lookup: async (): Promise<FulltextLookupResult> => ({
      kind: 'hit',
      text,
      format: 'markdown',
      source: 'MinerU (free)',
      provenance,
    }),
  })
  hosts.push(host)
  return createScholarlyReadTool(host)
}

describe('scholarly_read Markdown artifacts', () => {
  it('lists MinerU Markdown headings with the actual provider and provenance', async () => {
    const result = await toolOf(markdown).execute({ id: url, outline: true }, EXEC_CONTEXT as never)
    expect(result).toMatchObject({
      document: {
        provider: 'mineru',
        format: 'markdown',
        sourceIdentity: url,
        provenance,
        sections: [
          { id: '1', title: 'Introduction' },
          { id: '2', title: 'Methods' },
          { id: '3', title: 'Results' },
        ],
      },
    })
  })

  it('reads a Markdown section without rewriting its raw body', async () => {
    const result = await toolOf(markdown).execute(
      { id: url, section: 'Methods' },
      EXEC_CONTEXT as never,
    )
    expect(result).toMatchObject({
      document: {
        provider: 'mineru',
        format: 'markdown',
        provenance,
        text: markdown.slice(markdown.indexOf('## 2. Methods'), markdown.indexOf('# 3. Results')),
      },
    })
  })

  it('reports query offsets in the complete raw artifact even within a section', async () => {
    const result = await toolOf(markdown).execute(
      { id: url, section: 'Methods', query: 'attention' },
      EXEC_CONTEXT as never,
    )
    expect(result).toMatchObject({
      document: {
        passages: [
          expect.objectContaining({
            text: expect.stringContaining('  Attention preserves raw whitespace'),
          }),
        ],
      },
    })
    const document = (
      result as { document: { passages: Array<{ start: number; end: number; text: string }> } }
    ).document
    for (const passage of document.passages) {
      expect(markdown.slice(passage.start, passage.end)).toBe(passage.text)
      expect(passage.start).toBeGreaterThanOrEqual(markdown.indexOf('## 2. Methods'))
    }
  })

  it('describes heading-free Markdown truthfully without labeling it as a PDF extraction', async () => {
    const result = await toolOf('A short Markdown artifact without headings.').execute(
      { id: url, outline: true },
      EXEC_CONTEXT as never,
    )
    expect(result).toMatchObject({
      document: { provider: 'mineru', format: 'markdown', sections: [] },
    })
    expect((result as { text: string }).text).not.toContain('unstructured PDF')
    expect((result as { text: string }).text).toContain('Markdown')
  })
})
