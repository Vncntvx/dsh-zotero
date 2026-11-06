/**
 * The shared exact key-set reader: chunked scope listings without a `limit`,
 * per-key single reads for trash visibility, dedupe, identity, and version
 * agreement. Zotero's `itemKey=` scope expands children and cannot answer
 * trashed keys, so both shapes are the reader's contract, not an optimization.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../../src/errors.js'
import { fetchItemKeyBatches } from '../../src/local/item-batch.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { searchHit } from '../helpers/server/objects.js'

const LIBRARY = { type: 'user', id: 0 } as const

interface Answer {
  json: unknown
  headers?: Headers
}

function clientOf(respond: (path: string, params: URLSearchParams | undefined) => Answer): {
  client: ZoteroHttpClient
  getJson: ReturnType<typeof vi.fn>
} {
  const getJson = vi.fn(async (path: string, params?: URLSearchParams) => {
    const answer = respond(path, params)
    return {
      json: answer.json,
      headers:
        answer.headers ?? new Headers({ 'Zotero-Server-ID': 'S1', 'Last-Modified-Version': '7' }),
    }
  })
  return { client: { getJson } as unknown as ZoteroHttpClient, getJson }
}

const scopeCalls = (getJson: ReturnType<typeof vi.fn>) =>
  getJson.mock.calls.filter((call) => typeof call[1] === 'object')
const singleCalls = (getJson: ReturnType<typeof vi.fn>) =>
  getJson.mock.calls.filter((call) => call[1] === undefined)

describe('fetchItemKeyBatches: scope listings', () => {
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
    const { client, getJson } = clientOf((_path, params) => ({
      json: params!
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
    expect(scopeCalls(getJson)).toHaveLength(2)
    expect(getJson.mock.calls[0]![1]!.get('itemKey')!.split(',')).toHaveLength(50)
    expect(getJson.mock.calls[1]![1]!.get('itemKey')!.split(',')).toHaveLength(1)
    expect(result.byKey.size).toBe(51)
    expect(result.libraryVersion).toBe(7)
  })

  it('sends no limit: scope-expanded children must not displace requested keys', async () => {
    const { client, getJson } = clientOf((_path, params) => {
      expect(params!.get('limit')).toBeNull()
      const keys = params!.get('itemKey')!.split(',')
      // The first key carries a child: the scope answers it beside its parent.
      const rows = keys.map((key) => searchHit({ key }))
      rows.splice(1, 0, searchHit({ key: 'CHLD0001', data: { parentItem: keys[0] } }))
      return { json: rows }
    })
    const result = await fetchItemKeyBatches(
      { client, limits: PROVIDER_LIMITS },
      LIBRARY,
      ['PARE0001', 'PARE0002'],
      {
        serverId: 'S1',
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      },
    )
    // The scope's extra rows land in the map too; the callers look their keys
    // up, so the invariant that matters is that nothing requested is missing.
    expect([...result.byKey.keys()].sort()).toEqual(['CHLD0001', 'PARE0001', 'PARE0002'])
    expect(scopeCalls(getJson)).toHaveLength(1)
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

  it('refuses scope listings read through different library versions', async () => {
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

describe('fetchItemKeyBatches: per-key single reads', () => {
  it('routes includeTrashed reads through GET /items/{key}, not the scope listing', async () => {
    const { client, getJson } = clientOf((path) => {
      expect(path).toBe('users/0/items/A')
      return { json: searchHit({ key: 'A' }) }
    })
    const result = await fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
      includeTrashed: true,
      serverId: 'S1',
      what: 'item batch',
      onMissingKey: 'throw',
      mapRow: (row) => row,
    })
    expect(result.byKey.has('A')).toBe(true)
    expect(scopeCalls(getJson)).toHaveLength(0)
    expect(singleCalls(getJson)).toHaveLength(1)
  })

  it('answers a trashed key the scope listing cannot see', async () => {
    const trashed = searchHit({ key: 'A', data: { deleted: true } })
    const { client } = clientOf((path) => {
      expect(path).toBe('users/0/items/A')
      return { json: trashed }
    })
    const result = await fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
      includeTrashed: true,
      what: 'item batch',
      onMissingKey: 'throw',
      mapRow: (row) => row,
    })
    expect(result.byKey.has('A')).toBe(true)
    expect(result.libraryVersion).toBe(7)
  })

  it('keeps a key the object listing lost as missing instead of failing', async () => {
    const { client } = clientOf(() => {
      throw new ZoteroError('not found', ZOTERO_NOT_FOUND)
    })
    const result = await fetchItemKeyBatches(
      { client, limits: PROVIDER_LIMITS },
      LIBRARY,
      ['A', 'B'],
      {
        includeTrashed: true,
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      },
    )
    expect(result.byKey.size).toBe(0)
    expect(result.libraryVersion).toBeUndefined()
  })

  it('refuses a single-object answer that names a different key', async () => {
    const { client } = clientOf(() => ({ json: searchHit({ key: 'OTHER' }) }))
    await expect(
      fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A'], {
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })

  it('refuses single reads read through different library versions', async () => {
    let call = 0
    const { client } = clientOf((path) => {
      call += 1
      return {
        json: searchHit({ key: path.endsWith('/A') ? 'A' : 'B' }),
        headers: new Headers({
          'Zotero-Server-ID': 'S1',
          'Last-Modified-Version': call === 1 ? '7' : '8',
        }),
      }
    })
    await expect(
      fetchItemKeyBatches({ client, limits: PROVIDER_LIMITS }, LIBRARY, ['A', 'B'], {
        what: 'item batch',
        onMissingKey: 'throw',
        mapRow: (row) => row,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_UNEXPECTED })
  })
})
