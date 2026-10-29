/**
 * Library-wide tag deletion and restoration of trashed items.
 * @module dsh-zotero/local/write-library-maintenance
 */

import { ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZoteroError,
  writeListTooLongMessage,
  writeListEmptyMessage,
} from '../errors.js'
import { parseNonNegativeSafeInteger } from '../json.js'
import { libraryPrefix, PERSONAL_LIBRARY, formatRef } from '../refs.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import type { WriteDomainDeps } from './write-deps.js'
import {
  ensureServerId,
  normalizeWriteList,
  requireLibraryVersion,
  requireWritableRefAtServer,
  withItemStateWrite,
  withWriteKey,
} from './write-domain.js'
import type {
  ZoteroBatchOperationFailure,
  ZoteroDeleteLibraryTagsRequest,
  ZoteroDeleteLibraryTagsResult,
  ZoteroRestoreItemsRequest,
  ZoteroRestoreItemsResult,
} from '../types.js'

async function readLibraryVersion(
  deps: WriteDomainDeps,
  serverId: string,
  signal?: AbortSignal,
): Promise<{ libraryVersion: number; serverId: string }> {
  const params = new URLSearchParams({ limit: '1' })
  const response = await deps.client.get(`${libraryPrefix(PERSONAL_LIBRARY)}/items/top`, params, {
    signal,
    serverId,
  })
  const libraryVersion = requireLibraryVersion(
    parseNonNegativeSafeInteger(response.headers.get(ZOTERO_LIBRARY_VERSION_HEADER)),
  )
  const observed = serverIdFromHeaders(response.headers)
  assertServerIdMatches(observed, serverId)
  return { libraryVersion, serverId: observed ?? serverId }
}

/** Restore trashed items by setting Zotero's deleted flag back to zero. */
export async function restoreItems(
  deps: WriteDomainDeps,
  request: ZoteroRestoreItemsRequest,
  signal?: AbortSignal,
): Promise<ZoteroRestoreItemsResult> {
  if (request.items.length === 0)
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  if (request.items.length > ZOTERO_WRITE_OBJECT_BATCH)
    throw new ZoteroError(
      writeListTooLongMessage('restore items', ZOTERO_WRITE_OBJECT_BATCH),
      ZOTERO_INVALID_ARGUMENT,
    )
  const restored: ZoteroRestoreItemsResult['restored'] = []
  const failed: ZoteroBatchOperationFailure[] = []
  const serverId = await ensureServerId(deps, signal)
  for (const item of request.items) {
    try {
      const ref = requireWritableRefAtServer(item, ['item'], serverId)
      const result = await withItemStateWrite(
        deps,
        ref,
        signal,
        () => ({}),
        async ({ serverId: effective, resultRef, send }) => {
          const { libraryVersion } = await send({ deleted: 0 })
          return {
            ref: resultRef,
            restored: true as const,
            version: libraryVersion,
            libraryVersion,
            serverId: effective,
          }
        },
      )
      restored.push(result)
    } catch (error) {
      if (!(error instanceof ZoteroError)) throw error
      failed.push({ op: 'update', ref: formatRef(item), code: error.code, message: error.message })
    }
  }
  return { kind: 'restored', restored, failed, serverId }
}

function tagsDeletePath(tags: readonly string[]): string {
  return `${libraryPrefix(PERSONAL_LIBRARY)}/tags?tag=${tags
    .map((name) => encodeURIComponent(name))
    .join('||')}`
}

/** Delete selected tags library-wide under the version returned by a read. */
export async function deleteLibraryTags(
  deps: WriteDomainDeps,
  request: ZoteroDeleteLibraryTagsRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteLibraryTagsResult> {
  const tags = normalizeWriteList('tags', request.tags ?? [])
  if (tags.length === 0) {
    throw new ZoteroError(writeListEmptyMessage('tags'), ZOTERO_INVALID_ARGUMENT)
  }
  const serverId = await ensureServerId(deps, signal)
  const { libraryVersion: precondition, serverId: effectiveServerId } = await readLibraryVersion(
    deps,
    serverId,
    signal,
  )
  const { libraryVersion } = await withWriteKey(
    deps,
    effectiveServerId,
    signal,
    async (apiKey) =>
      await deps.writer.delete(tagsDeletePath(tags), {
        serverId: effectiveServerId,
        apiKey,
        ifUnmodifiedSinceVersion: precondition,
        tagDeleteLimit: true,
        signal,
      }),
  )
  return {
    kind: 'deleted',
    deletedTags: [...tags].sort(),
    libraryVersion,
    serverId: effectiveServerId,
  }
}
