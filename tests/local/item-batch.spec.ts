/** The shared chunked `itemKey=` reader: dedupe, identity, and version agreement. */
import { describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { ZOTERO_SERVER_MISMATCH, ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { fetchItemKeyBatches } from '../../src/local/item-batch.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { searchHit } from '../helpers/server/objects.js'

const LIBRARY = { type: 'user', id: 0 } as const

function clientOf(
  respond: (params: URLSearchParams) => {
    json: unknown
    headers?: Headers
  },
): { client: ZoteroHttpClient; getJson: ReturnType<typeof vi.fn> } {
  const getJson = vi.fn(async (_path: string, params: URLSearchParams) => {
    const answer = respond(params)
    return {
      json: answer.json,
      headers:
        answer.headers ?? new Headers({ 'Zotero-Server-ID': 'S1', 'Last-Modified-Version': '7' }),
    }
  })
  return { client: { getJson } as unknown as ZoteroHttpClient, getJson }
}

describe('fetchItemKeyBatches', () => {
  it('answers an empty key list without touching the wire', async () => {
    const { client, getJson } = clientOf(() => ({ json: [] }))
    const result = await fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, [], {
      what: 'item batch',
      onMissingKey: 'throw',
      mapRow: (row) => row,
    })
    expect(result.byKey.size).toBe(0)
    expect(result.libraryVersion).toBeUndefined()
    expect(getJson).not.toHaveBeenCalled()
  })

  it('deduplicates keys and chunks at the batch cap', async () => {
    const keys = Array.from({ length: 51 }, (_, index) => `ITEM${String(index).padStart(4, '0')}`)
    const { client, getJson } = clientOf((params) => ({
      json: params
        .get('itemKey')!
        .split(',')
        .map((key) => searchHit({ key })),
    }))
    const result = await fetchItemKeyBatches(
      { client, limits: PROVIDER_LIMITS },
      LIBRARY,
      [...keys, keys[0]!],
      {
        serverId: 'S1',
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      },
    )
    expect(getJson).toHaveBeenCalledTimes(2)
    expect(getJson.mock.calls[0]![1].get('itemKey')!.split(',')).toHaveLength(50)
    expect(getJson.mock.calls[1]![1].get('itemKey')!.split(',')).toHaveLength(1)
    expect(result.byKey.size).toBe(51)
    expect(result.libraryVersion).toBe(7)
  })

  it('sets includeTrashed only when asked', async () => {
    const { client, getJson } = clientOf(() => ({ json: [] }))
    await fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
      includeTrashed: true,
      what: 'item batch',
      onMissingKey: 'throw',
      mapRow: (row) => row,
    })
    expect(getJson.mock.calls[0]![1].get('includeTrashed')).toBe('1')
  })

  it('throws or skips a row without an object key', async () => {
    const { client } = clientOf(() => ({ json: [{ data: { title: 'keyless' } }] }))
    await expect(
      fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
    const skipped = await fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
      what: 'item batch',
      onMissingKey: 'skip',
      mapRow: (row) => row,
    })
    expect(skipped.byKey.size).toBe(0)
  })

  it('refuses an answer from a different instance', async () => {
    const { client } = clientOf(() => ({
      json: [],
      headers: new Headers({ 'Zotero-Server-ID': 'S2' }),
    }))
    await expect(
      fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
        serverId: 'S1',
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_SERVER_MISMATCH })
  })

  it('refuses batches read through different library versions', async () => {
    let call = 0
    const keys = Array.from({ length: 51 }, (_, index) => `ITEM${String(index).padStart(4, '0')}`)
    const { client } = clientOf(() => {
      call += 1
      return {
        json: [],
        headers: new Headers({
          'Zotero-Server-ID': 'S1',
          'Last-Modified-Version': call === 1 ? '7' : '8',
        }),
      }
    })
    await expect(
      fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, keys, {
        serverId: 'S1',
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })
})
