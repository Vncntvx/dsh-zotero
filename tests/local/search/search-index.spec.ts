/** Batched filtered-search reads reject malformed rows and mixed-version pages. */
import { describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../../src/http-client.js'
import { ZOTERO_UNEXPECTED } from '../../../src/errors.js'
import { searchRowsByKeys } from '../../../src/local/search-index.js'
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
        true,
        undefined,
      ),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
    expect(getJson).toHaveBeenCalledTimes(2)
    for (const [, params] of getJson.mock.calls) expect(params.get('includeTrashed')).toBe('1')
  })
})
