/** Continuation windows reuse the first window’s complete document instead of writing it again. */
import { expect, it, vi } from 'vitest'
import { SpillLocator, type SaveTextSpill } from '@deepseek-ai/dsh-spill'
import { createMockHost, createMockHttp } from '../../helpers/scholarly-runtime.js'
import { setupHostLane } from '../../helpers/lanes/host-lane.js'
import { createScholarlyReadTool } from '../../../src/scholarly/tools/read.js'

it('names a persisted section for its scope and saves the complete section only', async () => {
  const sectionText = '章'.repeat(30_000)
  const text = `# 1. Introduction\n\nIntroduction only.\n\n# 2. Methods\n\n${sectionText}\n\n# 3. Results\n\nResults only.`
  const save = vi.fn(async (_input: SaveTextSpill) => ({
    locator: SpillLocator('spill://session/section'),
    bytes: Buffer.byteLength(sectionText),
    retrievalHint: 'Read the saved section.',
  }))
  const lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        ctx.provide('spillStore', { saveText: save } as never)
      },
    },
  )
  try {
    const host = createMockHost(
      createMockHttp(() => {
        throw new Error('Cached section must not fetch')
      }),
    )
    host.ctx = lane.ctx
    await host.cache.set('arxiv-2301.07041', {
      provider: 'arxiv-html',
      format: 'markdown',
      text,
      source: 'arxiv-html',
      url: 'https://arxiv.org/html/2301.07041',
      sourceIdentity: 'https://arxiv.org/html/2301.07041',
    })
    lane.ctx.tools.register(createScholarlyReadTool(host))
    const result = await lane.runTool('scholarly_read', {
      id: '2301.07041',
      section: '2',
      max_chars: 100,
    })
    expect(result.isError).toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: '2301.07041-section-2.txt',
        content: expect.stringContaining(sectionText),
      }),
    )
    const saved = save.mock.calls[0]?.[0]
    expect(saved).not.toEqual(
      expect.objectContaining({ content: expect.stringContaining('Introduction only.') }),
    )
    expect(saved).not.toEqual(
      expect.objectContaining({ content: expect.stringContaining('Results only.') }),
    )
  } finally {
    await lane.teardown()
  }
})

it('spills a long scholarly document once across consecutive window reads', async () => {
  const text = '字'.repeat(30_000)
  const save = vi.fn(async () => ({
    locator: SpillLocator('spill://session/fulltext'),
    bytes: Buffer.byteLength(text),
    retrievalHint: 'Read the complete document.',
  }))
  const lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        ctx.provide('spillStore', { saveText: save } as never)
      },
    },
  )
  try {
    const host = createMockHost(
      createMockHttp(() => {
        throw new Error('Cached windows must not fetch the network')
      }),
    )
    host.ctx = lane.ctx
    await host.cache.set('arxiv-2301.07041', {
      provider: 'arxiv-html',
      format: 'markdown',
      text,
      source: 'arxiv-html',
      url: 'https://arxiv.org/html/2301.07041',
      sourceIdentity: 'https://arxiv.org/html/2301.07041',
    })
    lane.ctx.tools.register(createScholarlyReadTool(host))
    for (const start of [0, 1000, 2000]) {
      const result = await lane.runTool('scholarly_read', {
        id: '2301.07041',
        start,
        max_chars: 1000,
      })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result.content)).toContain('字'.repeat(1000))
    }
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: text }))
  } finally {
    await lane.teardown()
  }
})
