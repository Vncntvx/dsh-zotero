/** Every schema layer expires, so Zotero upgrades cannot leave stale writable fields resident. */
import { expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { ItemSchemaDirectory } from '../../src/local/item-schema-directory.js'

it('refreshes item types, fields, creator types and the derived writable set after five minutes', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  let revision = 1
  const getJson = vi.fn(async (path: string) => ({
    json:
      path === 'itemTypes'
        ? [{ itemType: `type${revision}` }]
        : path === 'itemTypeFields'
          ? [{ field: `field${revision}` }]
          : [{ creatorType: `creator${revision}` }],
    headers: new Headers({ 'Zotero-Server-ID': 'S1' }),
  }))
  const directory = new ItemSchemaDirectory({
    serverId: 'S1',
    getJson,
  } as unknown as ZoteroHttpClient)
  try {
    const before = await directory.getItemTypes()
    const fields = await directory.getItemFields('book')
    const writable = await directory.getWritableItemFields('book')
    const reads = getJson.mock.calls.length
    revision = 2
    now.mockReturnValue(300_999)
    expect(await directory.getItemTypes()).toBe(before)
    expect(await directory.getItemFields('book')).toBe(fields)
    expect(await directory.getWritableItemFields('book')).toBe(writable)
    expect(getJson).toHaveBeenCalledTimes(reads)
    now.mockReturnValue(301_000)
    expect((await directory.getItemTypes()).items).toEqual([{ itemType: 'type2' }])
    expect((await directory.getItemFields('book')).items).toEqual([
      { field: 'field2' },
      { creatorType: 'creator2' },
    ])
    expect([...(await directory.getWritableItemFields('book'))]).toEqual(['field2'])
    expect(before.items).toEqual([{ itemType: 'type1' }])
    expect([...writable]).toEqual(['field1'])
  } finally {
    now.mockRestore()
  }
})
