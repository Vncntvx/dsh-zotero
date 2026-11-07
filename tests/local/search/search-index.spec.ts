/**
 * Filtered-search row reads reject malformed answers and mixed-version pages.
 * Reads without trash visibility go through chunked `itemKey=` scope listings;
 * reads that must see trash go one key at a time through `GET /items/{key}`,
 * because Zotero's `includeTrashed` parameter never reaches the itemKey scope.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../../src/http-client.js'
import { ZOTERO_UNEXPECTED } from '../../../src/errors.js'
import {
  attachmentParentKeys,
  createSearchIndexCaches,
  searchRowsByKeys,
} from '../../../src/local/search-index.js'
import { PROVIDER_LIMITS } from '../../helpers/provider-harness.js'
import { searchHit } from '../../helpers/server/objects.js'

describe('filtered-search row batches', () => {
  it.each([null, [{ data: { title: 'missing key' } }]])(
    'rejects malformed batch response %j instead of returning a partial page',
    async (json) => {
      const getJson = vi.fn(async () => ({
        json,
        headers: new Headers({ 'Zotero-Server-ID': 'S1' }),
      }))
      const client = { getJson } as unknown as ZoteroHttpClient
      await expect(
        searchRowsByKeys(
          { client, limits: PROVIDER_LIMITS },
          { type: 'user', id: 0 },
          'S1',
          ['ITEM0001'],
          false,
          undefined,
        ),
      ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
    },
  )

  it('refuses batches read through different library versions', async () => {
    const getJson = vi.fn(async (_path: string, params: URLSearchParams) => {
      const keys = params.get('itemKey')!.split(',')
      return {
        json: keys.map((key) => searchHit({ key })),
        headers: new Headers({
          'Zotero-Server-ID': 'S1',
          'Last-Modified-Version': keys.length === 50 ? '7' : '8',
        }),
      }
    })
    const client = { getJson } as unknown as ZoteroHttpClient
    const keys = Array.from({ length: 51 }, (_, index) => `ITEM${String(index).padStart(4, '0')}`)
    await expect(
      searchRowsByKeys(
        { client, limits: PROVIDER_LIMITS },
        { type: 'user', id: 0 },
        'S1',
        keys,
        false,
        undefined,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
    expect(getJson).toHaveBeenCalledTimes(2)
  })

  it('serves trashed rows through per-key single reads that carry no query', async () => {
    const getJson = vi.fn(async (path: string) => {
      const key = path.split('/items/')[1]!
      return {
        json: searchHit({ key, data: { deleted: true } }),
        headers: new Headers({ 'Zotero-Server-ID': 'S1', 'Last-Modified-Version': '7' }),
      }
    })
    const client = { getJson } as unknown as ZoteroHttpClient
    const result = await searchRowsByKeys(
      { client, limits: PROVIDER_LIMITS },
      { type: 'user', id: 0 },
      'S1',
      ['ITEM0001', 'ITEM0002'],
      true,
      undefined,
    )
    expect([...result.byKey.keys()].sort()).toEqual(['ITEM0001', 'ITEM0002'])
    expect(result.libraryVersion).toBe(7)
    expect(getJson).toHaveBeenCalledTimes(2)
    for (const [path] of getJson.mock.calls) {
      expect(path).toMatch(/^users\/0\/items\/ITEM\d{4}$/)
    }
  })

  it('includes trashed attachments when building the parent index', async () => {
    const getJson = vi.fn(async (_path: string, params: URLSearchParams) => ({
      json: [{ data: { parentItem: 'ITEM0001' } }],
      headers: new Headers({
        'Zotero-Server-ID': 'S1',
        'Last-Modified-Version': '7',
        'Total-Results': '1',
      }),
    }))
    const client = { getJson } as unknown as ZoteroHttpClient
    const result = await attachmentParentKeys(
      { client, limits: PROVIDER_LIMITS },
      createSearchIndexCaches(),
      { type: 'user', id: 0 },
      'S1',
      true,
      {},
    )
    expect(getJson).toHaveBeenCalledOnce()
    expect(getJson.mock.calls[0]?.[1].get('includeTrashed')).toBe('1')
    expect(result.parents).toEqual(new Set(['ITEM0001']))
  })
})
