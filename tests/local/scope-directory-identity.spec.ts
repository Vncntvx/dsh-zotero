/** Identity partitions and invalidation across all directory cache surfaces. */
import { describe, expect, it, vi } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import { PERSONAL_LIBRARY } from '../../src/refs.js'
import {
  COLLECTION_KEY,
  SAVED_SEARCH_KEY,
  collectionRef,
  savedSearchRef,
} from '../helpers/server/keys.js'
import { collectionRow, savedSearchRow } from '../helpers/server/objects.js'
import { deferred } from '../helpers/sync.js'

const surfaces = [
  {
    name: 'collection listings',
    plural: 'collections',
    listing: true,
    key: COLLECTION_KEY,
    read: (d: ScopeDirectory, serverId: string) =>
      d.scopeListingOf('collections', { library: PERSONAL_LIBRARY, serverId }, undefined),
  },
  {
    name: 'search listings',
    plural: 'searches',
    listing: true,
    key: SAVED_SEARCH_KEY,
    read: (d: ScopeDirectory, serverId: string) =>
      d.scopeListingOf('searches', { library: PERSONAL_LIBRARY, serverId }, undefined),
  },
  {
    name: 'collection resolutions',
    plural: 'collections',
    listing: false,
    key: COLLECTION_KEY,
    read: (d: ScopeDirectory, serverId: string) =>
      d.resolveNamed(
        'collection',
        collectionRef(COLLECTION_KEY),
        PERSONAL_LIBRARY,
        undefined,
        serverId,
      ),
  },
  {
    name: 'search resolutions',
    plural: 'searches',
    listing: false,
    key: SAVED_SEARCH_KEY,
    read: (d: ScopeDirectory, serverId: string) =>
      d.resolveNamed(
        'search',
        savedSearchRef(SAVED_SEARCH_KEY),
        PERSONAL_LIBRARY,
        undefined,
        serverId,
      ),
  },
  {
    name: 'ancestor nodes',
    plural: 'collections',
    listing: false,
    key: COLLECTION_KEY,
    read: (d: ScopeDirectory, serverId: string) =>
      d.collectionAncestorNames(PERSONAL_LIBRARY, 'CHLD1234', COLLECTION_KEY, serverId, undefined),
  },
] as const

describe.each(surfaces)('$name', ({ read, plural, listing, key }) => {
  const response = (serverId: string, name: string) => {
    const row =
      plural === 'searches'
        ? savedSearchRow({ key, data: { name } })
        : collectionRow({ key, data: { name } })
    return { json: listing ? [row] : row, headers: new Headers({ 'Zotero-Server-ID': serverId }) }
  }

  it('keeps concurrent instance claims and their warm caches separate', async () => {
    const first = deferred<ReturnType<typeof response>>()
    const second = deferred<ReturnType<typeof response>>()
    const getJson = vi.fn((_path: string, _params: unknown, options?: { serverId?: string }) =>
      options?.serverId === 'S1' ? first.promise : second.promise,
    )
    const directory = new ScopeDirectory(
      { getJson } as unknown as ZoteroHttpClient,
      () => 60_000,
      () => 2,
    )
    const a = read(directory, 'S1')
    const b = read(directory, 'S2')
    expect(getJson).toHaveBeenCalledTimes(2)
    second.resolve(response('S2', 'second'))
    const resultB = await b
    first.resolve(response('S1', 'first'))
    const resultA = await a
    expect(JSON.stringify(resultA)).toContain('first')
    expect(JSON.stringify(resultB)).toContain('second')
    expect(await read(directory, 'S1')).toEqual(resultA)
    expect(await read(directory, 'S2')).toEqual(resultB)
    expect(getJson).toHaveBeenCalledTimes(2)
  })

  it('does not refill an invalidated cache with an older response', async () => {
    const old = deferred<ReturnType<typeof response>>()
    const getJson = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(response('S1', 'fresh'))
    const directory = new ScopeDirectory(
      { getJson } as unknown as ZoteroHttpClient,
      () => 60_000,
      () => 2,
    )
    const stale = read(directory, 'S1')
    directory.invalidate(PERSONAL_LIBRARY, plural)
    const fresh = await read(directory, 'S1')
    old.resolve(response('S1', 'stale'))
    await stale
    expect(await read(directory, 'S1')).toEqual(fresh)
    expect(JSON.stringify(fresh)).toContain('fresh')
    expect(getJson).toHaveBeenCalledTimes(2)
  })
})
