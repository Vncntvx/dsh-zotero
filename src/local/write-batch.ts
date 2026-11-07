/**
 * Batched item create, merge, and Trash operations against the Local API.
 * @module dsh-zotero/local/write-batch
 */

import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  writeListTooLongMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../errors.js'
import { formatRef, libraryPrefix, PERSONAL_LIBRARY, requireWritableRef } from '../refs.js'
import { readTrashGraph } from './trash-item.js'
import { batchCreateUnverified, settleBatchCreates } from './write-verdicts.js'
import { ZoteroWriteCommitUnknownError } from '../errors.js'
import type {
  ZoteroBatchCreateItemResult,
  ZoteroBatchOperationUnverified,
  ZoteroBatchDeleteItemResult,
  ZoteroBatchItemsRequest,
  ZoteroBatchItemsResult,
  ZoteroBatchOperationFailure,
  ZoteroBatchUpdateItemResult,
  ZoteroObjectRef,
} from '../types.js'
import type { WriteDomainDeps } from './write-deps.js'
import { collectionRef, itemRef } from './write-refs.js'
import {
  collectionState,
  createWireEntry,
  ensureServerId,
  isWriteUnauthorized,
  mergeList,
  mergeTagList,
  normalizeCreateFields,
  normalizeCollectionInput,
  normalizeWriteList,
  requireWritableRefAtServer,
  tagState,
  withItemStateWrite,
  withWriteKey,
  type CheckedCreateItem,
} from './write-domain.js'

interface CheckedBatchUpdate {
  readonly ref: ZoteroObjectRef
  readonly addTags: string[]
  readonly removeTags: string[]
  readonly addColInputs: string[]
  readonly removeColInputs: string[]
}

type CheckedBatchCreate = CheckedCreateItem

function prevalidateBatchDeletes(
  deletes: readonly NonNullable<ZoteroBatchItemsRequest['delete']>[number][],
  serverId: string,
): ZoteroObjectRef[] {
  return deletes.map((ref) => {
    const writable = requireWritableRef(ref, ['item'])
    return requireWritableRefAtServer(writable, ['item'], serverId)
  })
}

function prevalidateBatchUpdates(
  updates: readonly NonNullable<ZoteroBatchItemsRequest['update']>[number][],
  serverId: string,
): CheckedBatchUpdate[] {
  return updates.map((u) => {
    const writable = requireWritableRef(u.ref, ['item'])
    const ref = requireWritableRefAtServer(writable, ['item'], serverId)
    const addTags = normalizeWriteList('addTags', u.addTags ?? [])
    const removeTags = normalizeWriteList('removeTags', u.removeTags ?? [])
    const addColInputs = (u.addCollections ?? []).map((c) =>
      typeof c === 'string' ? normalizeCollectionInput('addCollections', c) : formatRef(c),
    )
    const removeColInputs = (u.removeCollections ?? []).map((c) =>
      typeof c === 'string' ? normalizeCollectionInput('removeCollections', c) : formatRef(c),
    )
    if (
      addTags.length === 0 &&
      removeTags.length === 0 &&
      addColInputs.length === 0 &&
      removeColInputs.length === 0
    ) {
      throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
    }
    return { ref, addTags, removeTags, addColInputs, removeColInputs }
  })
}

function prevalidateBatchCreates(
  creates: readonly NonNullable<ZoteroBatchItemsRequest['create']>[number][],
): CheckedBatchCreate[] {
  return creates.map((create) => normalizeCreateFields(create, { collections: 'collections' }))
}

async function resolveBatchCollections(
  deps: WriteDomainDeps,
  checkedCreates: readonly CheckedBatchCreate[],
  checkedUpdates: readonly CheckedBatchUpdate[],
  serverId: string,
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const allColInputs = [
    ...checkedCreates.flatMap((create) => create.colInputs),
    ...checkedUpdates.flatMap((update) => [...update.addColInputs, ...update.removeColInputs]),
  ]
  const uniqueColInputs = [...new Set(allColInputs)]
  const resolvedColsMap = new Map<string, string>()
  if (uniqueColInputs.length > 0) {
    const resolved = await deps.resolveCollections(uniqueColInputs, signal)
    for (let i = 0; i < uniqueColInputs.length; i++) {
      const key = requireWritableRefAtServer(resolved[i], ['collection'], serverId).key
      resolvedColsMap.set(uniqueColInputs[i], key)
    }
  }
  return resolvedColsMap
}

async function runBatchCreates(
  deps: WriteDomainDeps,
  checkedCreates: readonly CheckedBatchCreate[],
  resolvedColsMap: ReadonlyMap<string, string>,
  serverId: string,
  signal: AbortSignal | undefined,
  created: ZoteroBatchCreateItemResult[],
  unverified: ZoteroBatchOperationUnverified[],
  failed: ZoteroBatchOperationFailure[],
): Promise<number | undefined> {
  if (checkedCreates.length === 0) return undefined
  const entries = checkedCreates.map((create) => {
    const collectionKeys = create.colInputs
      .map((input) => resolvedColsMap.get(input))
      .filter((key): key is string => key !== undefined)
    return createWireEntry(create, collectionKeys)
  })

  try {
    const batch = await withWriteKey(deps, serverId, signal, (apiKey) =>
      deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/items`, entries, {
        serverId,
        apiKey,
        signal,
      }),
    )
    settleBatchCreates(batch, checkedCreates, serverId, created, unverified, failed)
    return batch.libraryVersion
  } catch (err) {
    if (isWriteUnauthorized(err)) throw err
    if (err instanceof ZoteroWriteCommitUnknownError) {
      // Same split as `sendSingleCreate` in write-verdicts.ts: an aborted
      // caller would never see these receipt buckets (the pipeline masks a
      // settled success with the canonical cancellation), so the commit
      // state must travel as a thrown error result instead.
      if (signal?.aborted) throw err
      for (let i = 0; i < checkedCreates.length; i++) {
        unverified.push(batchCreateUnverified(i, 'commit-unknown', serverId))
      }
    } else {
      signal?.throwIfAborted()
      for (let i = 0; i < checkedCreates.length; i++) {
        failed.push({
          op: 'create',
          index: i,
          code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return undefined
}

async function runBatchUpdates(
  deps: WriteDomainDeps,
  checkedUpdates: readonly CheckedBatchUpdate[],
  resolvedColsMap: ReadonlyMap<string, string>,
  serverId: string,
  signal: AbortSignal | undefined,
  updated: ZoteroBatchUpdateItemResult[],
  unverified: ZoteroBatchOperationUnverified[],
  failed: ZoteroBatchOperationFailure[],
): Promise<number | undefined> {
  let lastLibraryVersion: number | undefined
  for (const update of checkedUpdates) {
    try {
      const wantsTags = update.addTags.length > 0 || update.removeTags.length > 0
      const wantsCollections = update.addColInputs.length > 0 || update.removeColInputs.length > 0
      const readUpdateState = (data: Record<string, unknown>) => ({
        tags: wantsTags ? tagState(data).tags : undefined,
        collectionKeys: wantsCollections ? collectionState(data).collectionKeys : undefined,
      })
      const result = await withItemStateWrite(
        deps,
        update.ref,
        signal,
        readUpdateState,
        async ({ snapshot, serverId: effectiveServerId, resultRef, send }) => {
          let tagsChanged = false
          let nextTags = snapshot.tags
          let addedTags: string[] = []
          let removedTags: string[] = []
          if (snapshot.tags !== undefined) {
            const merged = mergeTagList(snapshot.tags, update.removeTags, update.addTags)
            tagsChanged = merged.changed
            nextTags = merged.merged
            addedTags = merged.added
            removedTags = merged.removed
          }

          let collectionsChanged = false
          let nextCollectionKeys = snapshot.collectionKeys
          let addedCollections: string[] = []
          let removedCollections: string[] = []
          if (snapshot.collectionKeys !== undefined) {
            const addKeys = update.addColInputs
              .map((input) => resolvedColsMap.get(input))
              .filter((key): key is string => key !== undefined)
            const removeKeys = update.removeColInputs
              .map((input) => resolvedColsMap.get(input))
              .filter((key): key is string => key !== undefined)
            const merged = mergeList(snapshot.collectionKeys, removeKeys, addKeys)
            collectionsChanged = merged.changed
            nextCollectionKeys = merged.merged
            addedCollections = merged.added
            removedCollections = merged.removed
          }

          if (!tagsChanged && !collectionsChanged) {
            return {
              ref: resultRef,
              version: snapshot.version,
              addedTags: [],
              removedTags: [],
              addedCollections: [],
              removedCollections: [],
              unchanged: true,
            }
          }

          const patchBody: Record<string, unknown> = {}
          if (tagsChanged) patchBody.tags = nextTags
          if (collectionsChanged) patchBody.collections = nextCollectionKeys
          let libraryVersion: number
          try {
            ;({ libraryVersion } = await send(patchBody))
          } catch (error) {
            if (error instanceof ZoteroWriteCommitUnknownError) {
              unverified.push({
                op: 'update',
                index: checkedUpdates.indexOf(update),
                ref: resultRef,
                committed: true,
                retryable: false,
                reason: 'receipt-unknown',
                serverId: effectiveServerId,
              })
              return undefined
            }
            throw error
          }
          lastLibraryVersion = libraryVersion
          return {
            ref: resultRef,
            version: libraryVersion,
            addedTags,
            removedTags,
            addedCollections: addedCollections.map((key) => collectionRef(key, effectiveServerId)),
            removedCollections: removedCollections.map((key) =>
              collectionRef(key, effectiveServerId),
            ),
            unchanged: false,
          }
        },
      )
      if (result !== undefined) updated.push(result)
    } catch (err) {
      if (err instanceof ZoteroWriteCommitUnknownError) continue
      failed.push({
        op: 'update',
        ref: itemRef(update.ref.key, serverId),
        code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return lastLibraryVersion
}

async function runBatchDeletes(
  deps: WriteDomainDeps,
  checkedDeletes: readonly ZoteroObjectRef[],
  serverId: string,
  signal: AbortSignal | undefined,
  deleted: ZoteroBatchDeleteItemResult[],
  unverified: ZoteroBatchOperationUnverified[],
  failed: ZoteroBatchOperationFailure[],
): Promise<number | undefined> {
  let lastLibraryVersion: number | undefined
  for (const ref of checkedDeletes) {
    const completedRefs: string[] = []
    try {
      const graph = await readTrashGraph(deps.client, ref.key, serverId, signal)
      for (const node of graph) {
        if (node.deleted) continue
        let libraryVersion: number
        try {
          ;({ libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
            deps.writer.patch(
              `${libraryPrefix(PERSONAL_LIBRARY)}/items/${node.key}`,
              { deleted: 1 },
              {
                serverId,
                apiKey,
                ifUnmodifiedSinceVersion: node.version,
                signal,
              },
            ),
          ))
        } catch (error) {
          if (error instanceof ZoteroWriteCommitUnknownError)
            unverified.push({
              op: 'delete',
              index: checkedDeletes.indexOf(ref),
              ref: itemRef(node.key, serverId),
              committed: true,
              retryable: false,
              reason: 'receipt-unknown',
              serverId,
            })
          throw error
        }
        lastLibraryVersion = libraryVersion
        completedRefs.push(itemRef(node.key, serverId))
      }
      const saved = await readTrashGraph(deps.client, ref.key, serverId, signal)
      const keys = new Set(graph.map((node) => node.key))
      if (
        saved.length !== graph.length ||
        saved.some((node) => !node.deleted || !keys.has(node.key))
      ) {
        throw new ZoteroError(
          `Zotero did not verify the complete graph for ${ref.key} in Trash. Check the completed refs before further action.`,
          ZOTERO_UNEXPECTED,
        )
      }
      const version = saved[saved.length - 1].version
      deleted.push({
        ref: itemRef(ref.key, serverId),
        key: ref.key,
        deleted: true,
        version,
        children: graph
          .filter((node) => node.key !== ref.key)
          .map((node) => itemRef(node.key, serverId)),
      })
    } catch (err) {
      if (err instanceof ZoteroWriteCommitUnknownError) continue
      failed.push({
        op: 'delete',
        ref: itemRef(ref.key, serverId),
        code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
        message: err instanceof Error ? err.message : String(err),
        ...(completedRefs.length > 0 ? { completedRefs } : {}),
      })
    }
  }
  return lastLibraryVersion
}

export async function batchItems(
  deps: WriteDomainDeps,
  request: ZoteroBatchItemsRequest,
  signal?: AbortSignal,
): Promise<ZoteroBatchItemsResult> {
  const creates = request.create ?? []
  const updates = request.update ?? []
  const deletes = request.delete ?? []
  const total = creates.length + updates.length + deletes.length
  if (total === 0) throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  if (total > ZOTERO_WRITE_OBJECT_BATCH) {
    throw new ZoteroError(
      writeListTooLongMessage('batch items', ZOTERO_WRITE_OBJECT_BATCH),
      ZOTERO_INVALID_ARGUMENT,
    )
  }

  const serverId = await ensureServerId(deps, signal)
  const checkedDeletes = prevalidateBatchDeletes(deletes, serverId)
  const checkedUpdates = prevalidateBatchUpdates(updates, serverId)
  const checkedCreates = prevalidateBatchCreates(creates)
  const resolvedColsMap = await resolveBatchCollections(
    deps,
    checkedCreates,
    checkedUpdates,
    serverId,
    signal,
  )

  const created: ZoteroBatchCreateItemResult[] = []
  const updated: ZoteroBatchUpdateItemResult[] = []
  const deleted: ZoteroBatchDeleteItemResult[] = []
  const unverified: ZoteroBatchOperationUnverified[] = []
  const failed: ZoteroBatchOperationFailure[] = []
  let latestLibraryVersion: number | undefined
  const versions = [
    await runBatchCreates(
      deps,
      checkedCreates,
      resolvedColsMap,
      serverId,
      signal,
      created,
      unverified,
      failed,
    ),
    await runBatchUpdates(
      deps,
      checkedUpdates,
      resolvedColsMap,
      serverId,
      signal,
      updated,
      unverified,
      failed,
    ),
    await runBatchDeletes(deps, checkedDeletes, serverId, signal, deleted, unverified, failed),
  ]
  for (const version of versions) {
    if (version !== undefined) latestLibraryVersion = version
  }

  return {
    kind: 'applied',
    total,
    created,
    updated,
    deleted,
    unverified,
    failed,
    ...(latestLibraryVersion !== undefined ? { libraryVersion: latestLibraryVersion } : {}),
    serverId,
  }
}
