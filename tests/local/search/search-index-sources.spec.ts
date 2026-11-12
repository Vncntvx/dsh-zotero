/**
 * Search-index cache and batch-read arms: the index key defaults a missing
 * mode, the attachment-presence walk skips parentless rows and caches a
 * version-less result, and key batches omit an absent server claim while
 * forwarding the caller's cancellation.
 * @module tests/local/search/search-index-sources
 */

import { describe, expect, it, vi } from 'vitest'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { ZoteroHttpClient } from '../../../src/http-client.js'
import {
  attachmentParentKeys,
  createSearchIndexCaches,
  searchIndexKeyOf,
  searchRowsByKeys,
} from '../../../src/local/search-index.js'
import type { ZoteroSearchRequest } from '../../../src/types.js'
import { PROVIDER_LIMITS } from '../../helpers/provider-harness.js'
import { searchHit } from '../../helpers/server/objects.js'

const LIBRARY = { type: 'user', id: 0 } as const

describe('searchIndexKeyOf defaults', () => {
  it('defaults the query mode and absent filters in the index key', () => {
    const request = {
      scope: { kind: 'library' },
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 10,
    } as ZoteroSearchRequest
    const key = searchIndexKeyOf(
      { path: 'users/0/items/top', resolved: { kind: 'library', library: LIBRARY } },
      request,
      undefined,
    )
    expect(JSON.parse(key)).toMatchObject({
      query: '',
      mode: 'metadata',
      itemLevel: 'top',
      tagMatch: 'all',
      attachmentIndexed: false,
      cacheGeneration: 0,
    })
  })
})

describe('attachmentParentKeys walk', () => {
  it('skips attachment rows without a parent item', async () => {
    const getJson = vi.fn(async () => ({
      json: [
        { key: 'ATTA0001', data: { parentItem: '' } },
        { key: 'ATTA0002', data: {} },
        { key: 'ATTA0003', data: { parentItem: 'ITEM0001' } },
      ],
      headers: new Headers({
        'Total-Results': '3',
        'Zotero-Server-ID': 'S1',
        'Last-Modified-Version': '7',
      }),
    }))
    const result = await attachmentParentKeys(
      { client: { getJson } as unknown as ZoteroHttpClient, limits: PROVIDER_LIMITS },
      createSearchIndexCaches(),
      LIBRARY,
      'S1',
      false,
      {},
    )
    expect(result.parents).toEqual(new Set(['ITEM0001']))
    expect(result.libraryVersion).toBe(7)
  })

  it('caches a presence set that carries no library version', async () => {
    const getJson = vi.fn(async () => ({
      json: [{ key: 'ATTA0001', data: { parentItem: 'ITEM0001' } }],
      headers: new Headers({ 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    }))
    const caches = createSearchIndexCaches()
    const deps = { client: { getJson } as unknown as ZoteroHttpClient, limits: PROVIDER_LIMITS }
    const first = await attachmentParentKeys(deps, caches, LIBRARY, 'S1', false, {})
    const second = await attachmentParentKeys(deps, caches, LIBRARY, 'S1', false, {})
    expect(first).toEqual({ parents: new Set(['ITEM0001']), fromCache: false })
    expect(second).toEqual({ parents: new Set(['ITEM0001']), fromCache: true })
    expect(getJson).toHaveBeenCalledTimes(1)
  })
})

describe('searchRowsByKeys claims and cancellation', () => {
  it('omits an absent server claim from the batch read and its rows', async () => {
    let serverId: string | undefined
    const getJson = vi.fn(
      async (_path: string, params: URLSearchParams, options?: { serverId?: string }) => {
        serverId = options?.serverId
        const keys = params.get('itemKey')!.split(',')
        return {
          json: keys.map((key) => searchHit({ key })),
          headers: new Headers({ 'Total-Results': String(keys.length) }),
        }
      },
    )
    const result = await searchRowsByKeys(
      { client: { getJson } as unknown as ZoteroHttpClient, limits: PROVIDER_LIMITS },
      LIBRARY,
      undefined,
      ['ITEM0001'],
      false,
      undefined,
    )
    expect(serverId).toBeUndefined()
    expect(result.libraryVersion).toBeUndefined()
    expect(result.byKey.get('ITEM0001')?.ref).toBe('zotero://user/0/item/ITEM0001')
  })

  it('propagates caller cancellation to the batch read', async () => {
    const getJson = vi.fn()
    const controller = new AbortController()
    controller.abort()
    await expect(
      searchRowsByKeys(
        { client: { getJson } as unknown as ZoteroHttpClient, limits: PROVIDER_LIMITS },
        LIBRARY,
        'S1',
        ['ITEM0001'],
        false,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
    expect(getJson).not.toHaveBeenCalled()
  })
})
