/** Breadcrumb caches are bounded and refresh recency for a repeatedly visited collection. */
import { expect, it, vi } from 'vitest'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { PERSONAL_LIBRARY } from '../../src/refs.js'
import { collectionRow } from '../helpers/server/objects.js'

it('evicts the least recently used breadcrumb after 4096 distinct nodes', async () => {
  const getJson = vi.fn(async (path: string) => {
    const key = path.split('/').at(-1)!
    return {
      json: collectionRow({ key, data: { name: key } }),
      headers: new Headers({ 'Zotero-Server-ID': 'server' }),
    }
  })
  const directory = new ScopeDirectory(
    { getJson } as unknown as ZoteroHttpClient,
    () => 60_000,
    () => 4,
  )
  const name = (key: string) =>
    directory.collectionAncestorNames(PERSONAL_LIBRARY, 'OWN00001', key, 'server', undefined)
  await name('NODE0000')
  await name('NODE0001')
  for (let index = 2; index < 4096; index++) await name(`NODE${String(index).padStart(4, '0')}`)
  await name('NODE0000')
  expect(getJson).toHaveBeenCalledTimes(4096)
  await name('NODE4096')
  await name('NODE0000')
  expect(getJson).toHaveBeenCalledTimes(4097)
  await name('NODE0001')
  expect(getJson).toHaveBeenCalledTimes(4098)
})
