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
  it.each([{ children: true }, { attachments: true }, { children: false, attachments: true }])(
    'rejects mixed attachment refs and %j before any request',
    async (include) => {
      const result = await lane.runTool('zotero_get_batch', {
        refs: ['zotero://user/0/item/AAAA1111', 'zotero://user/0/attachment/BBBB2222'],
        include,
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain(
        'Split item and attachment refs',
      )
      expect(lane.mock.requests).toEqual([])
    },
  )

  it('reads mixed item and attachment metadata with explicit false child flags', async () => {
    lane.mock.route('GET', /^\/api\/users\/0\/items\/[A-Z0-9]+$/, (req, _res, h) => {
      const key = req.url?.split('?')[0].split('/').at(-1) ?? ''
      h.json(
        item({ key, data: { itemType: key === 'BBBB2222' ? 'attachment' : 'book', title: key } }),
      )
    })
    const result = expectValue(
      await lane.runTool('zotero_get_batch', {
        refs: ['zotero://user/0/item/AAAA1111', 'zotero://user/0/attachment/BBBB2222'],
        include: { children: false, attachments: false },
      }),
      'zotero_get_batch',
    )
    expect(result.value).toMatchObject({ counts: { requested: 2, succeeded: 2, failed: 0 } })
  })
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
