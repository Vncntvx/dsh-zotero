/** Outline construction is owned by the modes that consume it. */
import { expect, it, vi } from 'vitest'
import * as bridge from '../../../src/scholarly/fulltext/evidence-bridge.js'
import { createScholarlyReadTool } from '../../../src/scholarly/tools/read.js'
import { createMockHost, createMockHttp } from '../../helpers/scholarly-runtime.js'
import { setupHostLane } from '../../helpers/lanes/host-lane.js'

it('reads subsequent fulltext windows and passage matches without rebuilding the outline', async () => {
  const host = createMockHost(createMockHttp(() => new Response('{}')))
  await host.cache.set('arxiv-2301.07041', {
    provider: 'arxiv-html',
    format: 'markdown',
    text: '# Introduction\n\n' + 'Reliable research evidence. '.repeat(200),
    source: 'arxiv',
    url: 'https://arxiv.org/html/2301.07041',
    sourceIdentity: 'https://arxiv.org/html/2301.07041',
  })
  const lane = await setupHostLane()
  lane.ctx.tools.register(createScholarlyReadTool(host))
  const outline = vi.spyOn(bridge, 'extractOutline')
  try {
    await lane.runTool('scholarly_read', { id: '2301.07041', start: 100, max_chars: 100 })
    await lane.runTool('scholarly_read', { id: '2301.07041', query: 'research evidence' })
    expect(outline).not.toHaveBeenCalled()
    await lane.runTool('scholarly_read', { id: '2301.07041', outline: true })
    expect(outline).toHaveBeenCalledTimes(1)
    await lane.runTool('scholarly_read', { id: '2301.07041', section: 'Introduction' })
    expect(outline).toHaveBeenCalledTimes(2)
  } finally {
    outline.mockRestore()
    await lane.teardown()
  }
})
