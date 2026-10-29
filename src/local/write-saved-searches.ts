/**
 * Write operations for saved-search records.
 * @module dsh-zotero/local/write-saved-searches
 */

import {
  requireNonBlank,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../errors.js'
import { asString } from '../json.js'
import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js'
import { normalizeSavedSearchConditions } from '../normalize-saved-search.js'
import type { WriteDomainDeps } from './write-deps.js'
import { searchRef } from './write-refs.js'
import {
  ensureServerId,
  readRecordForWrite,
  requireLibraryVersion,
  requireWritableRefAtServer,
  withWriteKey,
} from './write-domain.js'
import { settleCreate } from './write-verdicts.js'
import type {
  ZoteroCreateSavedSearchRequest,
  ZoteroDeleteSavedSearchRequest,
  ZoteroDeleteSavedSearchResult,
  ZoteroSavedSearchResult,
  ZoteroUpdateSavedSearchRequest,
  ZoteroWriteCommittedUnverified,
} from '../types.js'

export async function createSavedSearch(
  deps: WriteDomainDeps,
  request: ZoteroCreateSavedSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroSavedSearchResult | ZoteroWriteCommittedUnverified> {
  const name = requireNonBlank('name', request.name)
  if (request.conditions.length === 0)
    throw new ZoteroError('conditions cannot be empty.', ZOTERO_INVALID_ARGUMENT)
  const serverId = await ensureServerId(deps, signal)
  const entry = { name, conditions: request.conditions }
  return await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const settled = await settleCreate(
      deps,
      {
        path: `${libraryPrefix(PERSONAL_LIBRARY)}/searches`,
        entry,
        serverId,
        apiKey,
        signal,
        kind: 'search',
      },
      (data) => {
        const savedName = asString(data.name)
        const conditions = normalizeSavedSearchConditions(data.conditions)
        return savedName === name && conditions !== undefined
          ? { savedName, conditions }
          : undefined
      },
    )
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: searchRef(key, serverId),
      key,
      version,
      name: payload.savedName,
      conditions: payload.conditions,
      libraryVersion: settled.entry.libraryVersion,
      serverId,
    }
  })
}

export async function updateSavedSearch(
  deps: WriteDomainDeps,
  request: ZoteroUpdateSavedSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroSavedSearchResult> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(request.search, ['search'], serverId)
  if (request.name === undefined && request.conditions === undefined)
    throw new ZoteroError(
      'At least one of name or conditions must be provided.',
      ZOTERO_INVALID_ARGUMENT,
    )
  const { data, version } = await readRecordForWrite(deps, 'search', ref.key, serverId, signal)
  const name = request.name ?? asString(data?.name)
  const conditions = request.conditions ?? normalizeSavedSearchConditions(data?.conditions)
  if (name === undefined || conditions === undefined) {
    throw new ZoteroError(
      `The saved search's stored name or conditions are unreadable; refusing to update without an honest report of the search's state.`,
      ZOTERO_UNEXPECTED,
    )
  }
  const patch: Record<string, unknown> = {}
  if (request.name !== undefined) patch.name = requireNonBlank('name', request.name)
  if (request.conditions !== undefined) patch.conditions = request.conditions
  const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
    deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/searches/${ref.key}`, patch, {
      serverId,
      apiKey,
      ifUnmodifiedSinceVersion: version,
      signal,
    }),
  )
  return {
    kind: 'applied',
    ref: searchRef(ref.key, serverId),
    key: ref.key,
    version: libraryVersion,
    name,
    conditions,
    libraryVersion,
    serverId,
  }
}

export async function deleteSavedSearch(
  deps: WriteDomainDeps,
  request: ZoteroDeleteSavedSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteSavedSearchResult> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(request.search, ['search'], serverId)
  const read = await readRecordForWrite(deps, 'search', ref.key, serverId, signal)
  const effectiveServerId = read.serverId
  const precondition = requireLibraryVersion(read.libraryVersion)
  const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, (apiKey) =>
    deps.writer.delete(`${libraryPrefix(PERSONAL_LIBRARY)}/searches/${ref.key}`, {
      serverId: effectiveServerId,
      apiKey,
      ifUnmodifiedSinceVersion: precondition,
      signal,
    }),
  )
  return {
    kind: 'deleted',
    ref: searchRef(ref.key, effectiveServerId),
    key: ref.key,
    deleted: true,
    libraryVersion,
    serverId: effectiveServerId,
  }
}
