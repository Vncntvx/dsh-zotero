/**
 * Batched item create, tag/membership update, and Trash operations against the Local API.
 * @module dsh-zotero/local/write-batch
 */

import { HarnessError } from '@deepseek-ai/dsh-error'
import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  writeListTooLongMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../errors.js'
import { formatRef, libraryPrefix, PERSONAL_LIBRARY, requireWritableRef } from '../refs.js'
import { preflightTrashGraphs, type TrashSnapshot } from './trash-item.js'
import { patchTrashNodes, trashWalkProgress, verifyTrashGraph } from './write-trash-graph.js'
import {
  batchCreateUnverified,
  batchOperationUnverified,
  settleBatchCreates,
} from './write-verdicts.js'
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
import { writeKeyedItems, type KeyedItemUpdate } from './write-keyed-batch.js'
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
  const keys = new Set<string>()
  return deletes.map((ref) => {
    const writable = requireWritableRef(ref, ['item'])
    const checked = requireWritableRefAtServer(writable, ['item'], serverId)
    if (keys.has(checked.key))
      throw new ZoteroError(`Batch delete repeats item ${checked.key}.`, ZOTERO_INVALID_ARGUMENT)
    keys.add(checked.key)
    return checked
  })
}

function prevalidateBatchUpdates(
  updates: readonly NonNullable<ZoteroBatchItemsRequest['update']>[number][],
  serverId: string,
): CheckedBatchUpdate[] {
  const keys = new Set<string>()
  return updates.map((u) => {
    const writable = requireWritableRef(u.ref, ['item'])
    const ref = requireWritableRefAtServer(writable, ['item'], serverId)
    if (keys.has(ref.key))
      throw new ZoteroError(
        'A batch cannot update one item more than once.',
        ZOTERO_INVALID_ARGUMENT,
      )
    keys.add(ref.key)
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
    settleBatchCreates(batch, entries, serverId, created, unverified, failed)
    return batch.libraryVersion
  } catch (err) {
    if (isWriteUnauthorized(err)) throw err
    if (err instanceof ZoteroWriteCommitUnknownError) {
      // Matches `sendSingleCreate` in write-verdicts.ts: cancellations mask
      // settled receipts, so commit state travels through the thrown error.
      for (let i = 0; i < checkedCreates.length; i++) {
        unverified.push(batchCreateUnverified(i, 'commit-unknown', serverId))
      }
      if (signal?.aborted) throw err
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
  const pending: {
    index: number
    entry: KeyedItemUpdate
    receipt: ZoteroBatchUpdateItemResult
    send: () => Promise<{ libraryVersion: number }>
  }[] = []
  for (const [index, update] of checkedUpdates.entries()) {
    signal?.throwIfAborted()
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
          pending.push({
            index,
            entry: { key: update.ref.key, version: snapshot.version, fields: patchBody },
            send: () => send(patchBody),
            receipt: {
              ref: resultRef,
              version: snapshot.version,
              addedTags,
              removedTags,
              addedCollections: addedCollections.map((key) =>
                collectionRef(key, effectiveServerId),
              ),
              removedCollections: removedCollections.map((key) =>
                collectionRef(key, effectiveServerId),
              ),
              unchanged: false,
            },
          })
          return undefined
        },
      )
      if (result !== undefined) updated.push(result)
    } catch (err) {
      if (signal?.aborted || isWriteUnauthorized(err)) throw err
      // Planning only queues sends; the dispatch below settles commit-unknown outcomes.
      if (err instanceof ZoteroWriteCommitUnknownError) continue
      failed.push({
        op: 'update',
        ref: itemRef(update.ref.key, serverId),
        code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (pending.length === 0) return lastLibraryVersion
  try {
    // One changed object needs no batch envelope; multiple independent objects
    // use Zotero's native keyed POST under one single-use authorization.
    if (pending.length === 1) {
      const only = pending[0]!
      const saved = await only.send()
      updated.push({ ...only.receipt, version: saved.libraryVersion })
      return saved.libraryVersion
    }
    const batch = await writeKeyedItems(
      deps,
      pending.map((entry) => entry.entry),
      serverId,
      signal,
    )
    lastLibraryVersion = batch.libraryVersion
    batch.verdicts.forEach((verdict, index) => {
      const entry = pending[index]!
      if (verdict.kind === 'unverified')
        unverified.push(
          batchOperationUnverified('update', entry.index, entry.receipt.ref, serverId),
        )
      else if (verdict.kind === 'failed')
        failed.push({
          op: 'update',
          ref: entry.receipt.ref,
          code: verdict.error.code,
          message: verdict.error.message,
        })
      else
        updated.push({ ...entry.receipt, version: verdict.version, unchanged: verdict.unchanged })
    })
  } catch (error) {
    if (isWriteUnauthorized(error)) throw error
    if (error instanceof ZoteroWriteCommitUnknownError) {
      for (const entry of pending) {
        unverified.push(
          batchOperationUnverified('update', entry.index, entry.receipt.ref, serverId),
        )
      }
      if (signal?.aborted) throw error
    } else {
      if (signal?.aborted) throw error
      for (const entry of pending) {
        failed.push({
          op: 'update',
          ref: entry.receipt.ref,
          code: error instanceof ZoteroError ? error.code : ZOTERO_UNEXPECTED,
          message: error instanceof Error ? error.message : String(error),
        })
      }
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
  committedRefs: string[],
): Promise<number | undefined> {
  let lastLibraryVersion: number | undefined
  const graphs = await preflightTrashGraphs(
    deps.client,
    checkedDeletes.map((ref) => ref.key),
    serverId,
    signal,
  )

  interface PlannedDelete {
    deleteIndex: number
    ref: ZoteroObjectRef
    graph: TrashSnapshot[]
  }
  const planned: PlannedDelete[] = []
  for (const [deleteIndex, ref] of checkedDeletes.entries()) {
    signal?.throwIfAborted()
    try {
      const graph = await graphs.take(ref.key)
      planned.push({ deleteIndex, ref, graph })
    } catch (err) {
      if (signal?.aborted || isWriteUnauthorized(err)) throw err
      failed.push({
        op: 'delete',
        ref: itemRef(ref.key, serverId),
        code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (planned.length === 0) return lastLibraryVersion

  const uniqueNodes = new Map<string, TrashSnapshot>()
  const nodeRoots = new Map<string, PlannedDelete[]>()
  for (const item of planned) {
    for (const node of item.graph) {
      if (!uniqueNodes.has(node.key)) {
        uniqueNodes.set(node.key, node)
      }
      let roots = nodeRoots.get(node.key)
      if (!roots) {
        roots = []
        nodeRoots.set(node.key, roots)
      }
      roots.push(item)
    }
  }

  const progress = trashWalkProgress()
  let patchError: unknown
  try {
    await patchTrashNodes(deps, serverId, signal, [...uniqueNodes.values()], {
      wantDeleted: true,
      progress,
      onCommitUnknown: (node) => {
        const roots = nodeRoots.get(node.key)
        if (roots) {
          for (const item of roots) {
            unverified.push(
              batchOperationUnverified(
                'delete',
                item.deleteIndex,
                itemRef(node.key, serverId),
                serverId,
              ),
            )
          }
        }
      },
    })
  } catch (err) {
    patchError = err
  } finally {
    // Preserves library versions and completed refs from settled patches if later operations fail.
    if (progress.libraryVersion !== undefined) lastLibraryVersion = progress.libraryVersion
    committedRefs.push(...progress.completedRefs)
  }

  if (patchError !== undefined && (signal?.aborted || isWriteUnauthorized(patchError))) {
    throw patchError
  }

  const completedRefsSet = new Set(progress.completedRefs)

  for (const item of planned) {
    signal?.throwIfAborted()
    const itemAllCompleted =
      patchError === undefined ||
      item.graph.every((node) => node.deleted || completedRefsSet.has(itemRef(node.key, serverId)))
    if (itemAllCompleted) {
      try {
        const saved = await verifyTrashGraph(
          deps.client,
          item.ref.key,
          serverId,
          item.graph,
          {
            wantDeleted: true,
            message: `Zotero did not verify the complete graph for ${item.ref.key} in Trash. Check the completed refs before further action.`,
          },
          signal,
        )
        const version = saved[saved.length - 1].version
        deleted.push({
          ref: itemRef(item.ref.key, serverId),
          key: item.ref.key,
          deleted: true,
          version,
          children: item.graph
            .filter((node) => node.key !== item.ref.key)
            .map((node) => itemRef(node.key, serverId)),
        })
      } catch (err) {
        if (signal?.aborted || isWriteUnauthorized(err)) throw err
        if (err instanceof ZoteroWriteCommitUnknownError) continue
        const completedChildren = item.graph
          .map((n) => itemRef(n.key, serverId))
          .filter((ref) => completedRefsSet.has(ref))
        failed.push({
          op: 'delete',
          ref: itemRef(item.ref.key, serverId),
          code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
          message: err instanceof Error ? err.message : String(err),
          ...(completedChildren.length > 0 ? { completedRefs: completedChildren } : {}),
        })
      }
    } else {
      // A commit-unknown already reports the node it could not prove through
      // `unverified`; an item that never reached that node (another root whose
      // wave stopped behind it) still needs its own failure row, or it would
      // vanish from every receipt bucket.
      const unknownReported = unverified.some(
        (entry) => entry.op === 'delete' && entry.index === item.deleteIndex,
      )
      if (patchError instanceof ZoteroWriteCommitUnknownError && unknownReported) continue
      const completedChildren = item.graph
        .map((n) => itemRef(n.key, serverId))
        .filter((ref) => completedRefsSet.has(ref))
      failed.push({
        op: 'delete',
        ref: itemRef(item.ref.key, serverId),
        code: patchError instanceof ZoteroError ? patchError.code : ZOTERO_UNEXPECTED,
        message: patchError instanceof Error ? patchError.message : String(patchError),
        ...(completedChildren.length > 0 ? { completedRefs: completedChildren } : {}),
      })
    }
  }

  return lastLibraryVersion
}

/**
 * Append the receipts that survived a throw to its model-facing message. The
 * error object alone never reaches the model: the tool pipeline renders
 * `Error: <message>` and drops the extra fields, so the refs have to be in the
 * text or the caller cannot know which writes landed.
 */
function partialProgressMessage(
  base: string,
  parts: {
    readonly completedRefs: readonly string[]
    readonly unverified: readonly ZoteroBatchOperationUnverified[]
    readonly failed: readonly ZoteroBatchOperationFailure[]
  },
): string {
  const completedRefs = [...new Set(parts.completedRefs)]
  const unverifiedRefs = [
    ...new Set(
      parts.unverified.map((entry) => entry.ref).filter((ref): ref is string => ref !== undefined),
    ),
  ]
  const unverifiedWithoutRef = parts.unverified
    .filter((entry) => entry.ref === undefined)
    .map((entry) => `${entry.op} index ${entry.index}`)
  const failures = parts.failed.map(
    (entry) => `${entry.op} ${entry.ref ?? `index ${entry.index}`} (${entry.code})`,
  )
  const lines = [
    ...(completedRefs.length === 0 ? [] : [`Completed refs: ${completedRefs.join(', ')}`]),
    ...(unverifiedRefs.length === 0 ? [] : [`Unverified refs: ${unverifiedRefs.join(', ')}`]),
    ...(unverifiedWithoutRef.length === 0
      ? []
      : [`Unverified operations: ${unverifiedWithoutRef.join(', ')}`]),
    ...(failures.length === 0 ? [] : [`Failed operations: ${failures.join('; ')}`]),
  ]
  return `${base}\nPartial progress before this failure:\n${lines.join('\n')}\nReconcile these facts in Zotero before any further write; never retry a completed ref.`
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
  const committedDeletes: string[] = []
  let latestLibraryVersion: number | undefined

  try {
    const v1 = await runBatchCreates(
      deps,
      checkedCreates,
      resolvedColsMap,
      serverId,
      signal,
      created,
      unverified,
      failed,
    )
    if (v1 !== undefined) latestLibraryVersion = v1

    const v2 = await runBatchUpdates(
      deps,
      checkedUpdates,
      resolvedColsMap,
      serverId,
      signal,
      updated,
      unverified,
      failed,
    )
    if (v2 !== undefined) latestLibraryVersion = v2

    const v3 = await runBatchDeletes(
      deps,
      checkedDeletes,
      serverId,
      signal,
      deleted,
      unverified,
      failed,
      committedDeletes,
    )
    if (v3 !== undefined) latestLibraryVersion = v3
  } catch (error) {
    const completedRefs = [
      ...new Set([
        ...created.map((c) => c.ref),
        ...updated.map((u) => u.ref),
        ...deleted.map((d) => d.ref),
        ...committedDeletes,
      ]),
    ]
    const unverifiedRefs = [
      ...new Set(unverified.map((u) => u.ref).filter((ref): ref is string => ref !== undefined)),
    ]

    if (
      completedRefs.length > 0 ||
      unverifiedRefs.length > 0 ||
      unverified.length > 0 ||
      failed.length > 0
    ) {
      const code =
        error instanceof HarnessError
          ? error.code
          : signal?.aborted
            ? 'TOOL_ABORTED'
            : ZOTERO_UNEXPECTED
      const baseMessage =
        error instanceof Error
          ? error.message
          : 'The write operation failed or was cancelled after partial progress.'

      const allCompletedRefs =
        error instanceof ZoteroWriteCommitUnknownError && error.completedRefs
          ? [...new Set([...error.completedRefs, ...completedRefs])]
          : completedRefs
      const allUnverifiedRefs =
        error instanceof ZoteroWriteCommitUnknownError && error.unverifiedRefs
          ? [...new Set([...error.unverifiedRefs, ...unverifiedRefs])]
          : unverifiedRefs

      const partialResult: ZoteroBatchItemsResult = {
        kind: 'partial',
        total,
        created,
        updated,
        deleted,
        unverified,
        failed,
        ...(latestLibraryVersion !== undefined ? { libraryVersion: latestLibraryVersion } : {}),
        serverId,
      }

      throw new ZoteroWriteCommitUnknownError(
        partialProgressMessage(baseMessage, {
          completedRefs: allCompletedRefs,
          unverified,
          failed,
        }),
        code,
        {
          cause: error instanceof Error && 'cause' in error && error.cause ? error.cause : error,
          completedRefs: allCompletedRefs,
          unverifiedRefs: allUnverifiedRefs,
          partial: partialResult,
        },
      )
    }
    throw error
  }

  const successful = created.length + updated.length + deleted.length
  const kind: ZoteroBatchItemsResult['kind'] =
    failed.length > 0 && successful === 0 && unverified.length === 0
      ? 'failed'
      : failed.length > 0 || unverified.length > 0
        ? 'partial'
        : 'applied'
  return {
    kind,
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
