import type { ZoteroHttpClient } from '../http-client.js'
import type {
  ZoteroCollectionPathRequestView,
  ZoteroCollectionPathResultView,
  ZoteroCollectionRowView,
} from '../contract.js'
import {
  ZoteroError,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_UNEXPECTED,
  isNotFoundError,
} from '../errors.js'
import {
  libraryPrefix,
  parseRef,
  requireSupportedLocalRef,
  sameLibrary,
  refStringFor,
} from '../refs.js'
import { normalizeScopeEntry } from '../normalize-scope.js'
import { asRecord } from '../json.js'
import { serverIdFromHeaders } from './identity.js'

export function requireNavigationVersion(headers: Headers): number {
  const raw = headers.get('Last-Modified-Version')
  if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new ZoteroError('Navigation response lacks a valid library version.', ZOTERO_UNEXPECTED)
  return Number(raw)
}

/** Fresh parent reads: object versions never stand in for the library fence. */
export async function readCollectionPath(
  client: ZoteroHttpClient,
  request: ZoteroCollectionPathRequestView,
  signal?: AbortSignal,
): Promise<ZoteroCollectionPathResultView> {
  const ref = requireSupportedLocalRef(parseRef(request.ref), ['collection'])
  if (!sameLibrary(ref.library, request.library))
    throw new ZoteroError('Collection belongs to another library.', ZOTERO_INVALID_ARGUMENT)
  const prefix = libraryPrefix(request.library)
  let key: string | undefined = ref.key
  let serverId = ref.serverId
  const seen = new Set<string>()
  const chain: ReturnType<typeof normalizeScopeEntry>[] = []
  while (key !== undefined) {
    if (seen.has(key))
      throw new ZoteroError('Collection parent chain contains a cycle.', ZOTERO_UNEXPECTED)
    seen.add(key)
    let response
    try {
      response = await client.getJson<unknown>(`${prefix}/collections/${key}`, undefined, {
        signal,
        serverId,
      })
    } catch (error) {
      if (chain.length && isNotFoundError(error))
        throw new ZoteroError('Collection ancestor is missing.', ZOTERO_UNEXPECTED)
      throw error
    }
    serverId = serverIdFromHeaders(response.headers, serverId)
    const entry = normalizeScopeEntry(response.json)
    const parent = asRecord(asRecord(response.json)?.data)?.parentCollection
    if (
      entry.key !== key ||
      (parent !== undefined && parent !== false && entry.parentKey === undefined)
    )
      throw new ZoteroError('Collection parent relationship is invalid.', ZOTERO_UNEXPECTED)
    chain.unshift(entry)
    key = entry.parentKey
  }
  const probe = await client.getJson<unknown>(
    `${prefix}/collections/top`,
    new URLSearchParams({ limit: '1' }),
    { signal, serverId },
  )
  const libraryVersion = requireNavigationVersion(probe.headers)
  if (libraryVersion !== request.libraryVersion)
    throw new ZoteroError(
      'Library changed while locating the collection. Reload navigation.',
      ZOTERO_UNEXPECTED,
    )
  const path: ZoteroCollectionRowView[] = chain.map((entry, index) => ({
    kind: 'collection',
    ref: refStringFor(request.library, 'collection', entry.key, serverId),
    name: entry.name,
    ...(entry.parentKey
      ? { parentRef: refStringFor(request.library, 'collection', entry.parentKey, serverId) }
      : {}),
    path: chain.slice(0, index + 1).map((row) => row.name),
    depth: index,
  }))
  return { library: request.library, libraryVersion, path }
}
