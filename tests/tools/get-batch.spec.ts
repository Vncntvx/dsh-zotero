import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { item } from '../helpers/server/objects.js'

let lane: HostLane

beforeEach(async () => {
  lane = await setupHostLane()
})

afterEach(async () => {
  await lane.teardown()
})

describe('zotero_get_batch', () => {
  it('registers and returns ordered per-ref results with an isolated failure', async () => {
    expect(lane.tool('zotero_get_batch')).toBeDefined()
    lane.mock.route('GET', /^\/api\/users\/0\/items\/[A-Z0-9]+$/, (req, res, helpers) => {
      const key = req.url?.split('/').at(-1) ?? ''
      if (key === 'BBBB2222') {
        helpers.raw(404, {}, '')
        return
      }
      helpers.json(item({ key, data: { itemType: 'journalArticle', title: `Title ${key}` } }))
    })
    const result = expectValue(
      await lane.runTool('zotero_get_batch', {
        refs: [
          'zotero://user/0/item/AAAA1111',
          'zotero://user/0/item/BBBB2222',
          'zotero://user/0/item/CCCC3333',
        ],
      }),
      'zotero_get_batch',
    )
    const value = result.value as { items: Array<Record<string, unknown>>; counts: unknown }
    const items = value.items
    expect(items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/AAAA1111',
      'zotero://user/0/item/BBBB2222',
      'zotero://user/0/item/CCCC3333',
    ])
    expect(items.map((entry) => entry.status)).toEqual(['ok', 'error', 'ok'])
    expect(value.counts).toEqual({ requested: 3, succeeded: 2, failed: 1 })
    expect((result.content[0] as { text: string }).text).toContain('BBBB2222')
  })

  it('rejects duplicate, empty, and oversized batches before Local API access', async () => {
    const duplicate = await lane.runTool('zotero_get_batch', {
      refs: ['zotero://user/0/item/AAAA1111', 'zotero://user/0/item/AAAA1111'],
    })
    expect(duplicate.isError).toBe(true)
    const empty = await lane.runTool('zotero_get_batch', { refs: [] })
    expect(empty.isError).toBe(true)
    const oversized = await lane.runTool('zotero_get_batch', {
      refs: Array.from(
        { length: 51 },
        (_, index) => `zotero://user/0/item/${String(index).padStart(8, '0')}`,
      ),
    })
    expect(oversized.isError).toBe(true)
    expect(lane.mock.requests).toEqual([])
  })
})
