/** Overlong questions stop before source I/O in both ranking tools. */
import { describe, expect, it, vi } from 'vitest'
import { queryTextsOf } from '../../src/local/evidence-ranker.ts'
import { queryVariantsOf } from '../../src/tools/query-variants.ts'
import { createScholarlyReadTool } from '../../src/scholarly/tools/read.ts'
import { createMockHost, createMockHttp } from '../helpers/scholarly-runtime.ts'
import { setupHostLane } from '../helpers/lanes/host-lane.ts'

const long = 'q'.repeat(2001)
const args = [{ query: long }, { query: 'valid', queryVariants: [long] }]

describe('evidence query admission', () => {
  it.each(args)('refuses Zotero query arguments before HTTP', async (query) => {
    const lane = await setupHostLane()
    try {
      const result = await lane.runTool('zotero_retrieve', {
        ref: 'zotero://user/0/item/ITEM0001',
        ...query,
      })
      expect(result.isError).toBe(true)
      expect(lane.mock.requests).toEqual([])
    } finally {
      await lane.teardown()
    }
  })

  it.each(args)('refuses scholarly query arguments before HTTP', async (query) => {
    const fetch = vi.fn(async () => new Response('{}'))
    const host = createMockHost(createMockHttp(fetch))
    const tool = createScholarlyReadTool(host)
    const lane = await setupHostLane()
    const unregister = lane.ctx.tools.register(tool)
    try {
      const result = await lane.runTool('scholarly_read', { id: '10.1234/valid', ...query })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('at most 2000 characters')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      unregister()
      await lane.teardown()
    }
  })

  it('enforces the same bound for direct ranker calls and accepts the boundary intact', () => {
    expect(() => queryTextsOf(long)).toThrow(/at most 2000 characters/)
    expect(() => queryVariantsOf([long])).toThrow(/at most 2000 characters/)
    expect(queryTextsOf('q'.repeat(2000))).toEqual(['q'.repeat(2000)])
  })
})
