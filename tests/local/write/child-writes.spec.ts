/** Operation-specific snapshots must accept real child-item wire shapes. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { restoreItems } from '../../../src/local/write-library-maintenance.js'
import { updateNote } from '../../../src/local/write-notes.js'
import { batchItems } from '../../../src/local/write-batch.js'
import { updateItemCollections, updateItemTags } from '../../../src/local/write-item-lists.js'
import {
  batchHeaders,
  COLLECTION_KEY,
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'

let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
})
afterEach(async () => {
  await mock.close()
})

function child(itemType = 'note', data: Record<string, unknown> = {}) {
  mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, h) =>
    h.json(
      itemJson(ITEM_KEY, 10, {
        itemType,
        parentItem: 'PARENT01',
        tags: [{ tag: 'existing', type: 1 }],
        ...data,
      }),
      batchHeaders(10),
    ),
  )
  mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (req, _res, h) => {
    expect(req.headers['if-unmodified-since-version']).toBe('10')
    h.raw(204, batchHeaders(11), '')
  })
  grantAuthorize(mock)
  return writeDeps(mock).deps
}

describe('child item write preconditions', () => {
  it('updates child note HTML without reading tags or collections', async () => {
    const deps = child('note', { tags: undefined })
    await expect(
      updateNote(deps, { item: ITEM_REF, markdown: '**updated**' }),
    ).resolves.toMatchObject({ kind: 'applied', version: 11 })
    expect(JSON.parse(mock.requests.find((r) => r.method === 'PATCH')!.body!)).toEqual({
      note: expect.stringContaining('<strong>updated</strong>'),
    })
  })

  it.each(['note', 'attachment', 'annotation'])(
    'restores child %s without list state',
    async (itemType) => {
      const deps = child(itemType, { tags: undefined, deleted: 1 })
      const result = await restoreItems(deps, { items: [ITEM_REF] })
      expect(result.failed).toEqual([])
      expect(result.restored).toMatchObject([{ restored: true, version: 11 }])
      expect(JSON.parse(mock.requests.find((r) => r.method === 'PATCH')!.body!)).toEqual({
        deleted: 0,
      })
    },
  )

  it('merges child tags without requiring collection membership', async () => {
    const deps = child()
    await updateItemTags(deps, { item: ITEM_REF, add: ['new'] })
    expect(JSON.parse(mock.requests.find((r) => r.method === 'PATCH')!.body!)).toEqual({
      tags: [{ tag: 'existing', type: 1 }, { tag: 'new' }],
    })
  })

  it('accepts tag-only batch updates on children', async () => {
    const deps = child()
    const result = await batchItems(deps, { update: [{ ref: ITEM_REF, addTags: ['new'] }] })
    expect(result.failed).toEqual([])
    expect(result.updated).toMatchObject([{ addedTags: ['new'], addedCollections: [] }])
  })

  it('refuses direct collection membership on children with a typed argument error', async () => {
    const deps = child()
    await expect(
      updateItemCollections(deps, {
        item: ITEM_REF,
        add: [`zotero://user/0/collection/${COLLECTION_KEY}`],
      }),
    ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
    expect(mock.requests.some((r) => r.method === 'PATCH')).toBe(false)
  })

  it.each([undefined, 'invalid'])(
    'still refuses missing or malformed tags (%s) before merging',
    async (tags) => {
      const deps = child('note', { tags })
      await expect(updateItemTags(deps, { item: ITEM_REF, add: ['new'] })).rejects.toMatchObject({
        code: 'ZOTERO_UNEXPECTED',
      })
      expect(mock.requests.some((r) => r.method === 'PATCH')).toBe(false)
    },
  )
})
