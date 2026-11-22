/**
 * The shared write walk over one Trash object graph. Restore and batch
 * delete drive the same children-first per-node PATCH and the same read-back
 * proof; polarity, receipts, and error policy stay with the callers, whose
 * failure contracts genuinely differ.
 * @module dsh-zotero/local/write-trash-graph
 */

import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js'
import {
  ZoteroError,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroWriteCommitUnknownError,
} from '../errors.js'
import type { ZoteroHttpClient } from '../http-client.js'
import { readTrashGraph, type TrashSnapshot } from './trash-item.js'
import type { WriteDomainDeps } from './write-deps.js'
import { itemRef } from './write-refs.js'
import { withWriteKey } from './write-domain.js'
import { writeKeyedItems, throwKeyedVerdict } from './write-keyed-batch.js'
import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'

/** The bookkeeping one graph's patch accumulates as its nodes settle. */
interface TrashWalkProgress {
  /** Refs of the nodes patched so far, in patch order. */
  readonly completedRefs: string[]
  /** The library version of the newest acknowledged PATCH, when one landed. */
  libraryVersion?: number
}

/** The empty progress a caller owns for one graph's walk. */
export function trashWalkProgress(): TrashWalkProgress {
  return { completedRefs: [] }
}

interface PatchTrashNodesOptions {
  /** The polarity the PATCH writes and the settled nodes must end up in. */
  readonly wantDeleted: boolean
  /** Caller-owned; mutated in place so partial progress survives a throw. */
  readonly progress: TrashWalkProgress
  /**
   * Called before a commit-unknown rethrows, so the caller records its own
   * receipt shape for the node whose outcome is unknown.
   */
  readonly onCommitUnknown?: (node: TrashSnapshot) => void
}

/**
 * Patch every node whose deleted state differs from `wantDeleted` under its
 * own version precondition. A commit-unknown aborts the walk: the hook
 * observes the node, then the error rethrows to the caller's policy with the
 * progress so far intact.
 *
 * A settled refusal (a version conflict, for example) blocks that node's
 * ancestors instead: a parent must never be patched over a child whose write
 * did not settle. Independent branches keep going, so one root's refusal in a
 * merged cross-root wave does not leave every other root unwritten; the first
 * refusal is rethrown once no independent node remains.
 */
export async function patchTrashNodes(
  deps: WriteDomainDeps,
  serverId: string,
  signal: AbortSignal | undefined,
  nodes: readonly TrashSnapshot[],
  options: PatchTrashNodesOptions,
): Promise<void> {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const remaining = new Map(
    nodes.filter((node) => node.deleted !== options.wantDeleted).map((node) => [node.key, node]),
  )
  const blocked = new Set<string>()
  const blockAncestors = (key: string): void => {
    remaining.delete(key)
    let parent = byKey.get(key)?.parentKey
    while (parent !== undefined && !blocked.has(parent)) {
      blocked.add(parent)
      parent = byKey.get(parent)?.parentKey
    }
  }
  let failure: unknown

  while (remaining.size > 0) {
    signal?.throwIfAborted()
    const parents = new Set(
      [...remaining.values()].map((node) => node.parentKey).filter((key) => key !== undefined),
    )
    const frontier = [...remaining.values()]
      .filter((node) => !parents.has(node.key) && !blocked.has(node.key))
      .slice(0, ZOTERO_WRITE_OBJECT_BATCH)
    if (frontier.length === 0) {
      if ([...remaining.values()].some((node) => !blocked.has(node.key)))
        throw new ZoteroError('The Trash graph contains a dependency cycle.', ZOTERO_UNEXPECTED)
      break
    }
    if (frontier.length > 1) {
      let batch
      try {
        batch = await writeKeyedItems(
          deps,
          frontier.map((node) => ({
            key: node.key,
            version: node.version,
            fields: { deleted: options.wantDeleted ? 1 : 0 },
          })),
          serverId,
          signal,
        )
      } catch (error) {
        if (error instanceof ZoteroWriteCommitUnknownError)
          for (const node of frontier) options.onCommitUnknown?.(node)
        throw error
      }
      options.progress.libraryVersion = batch.libraryVersion
      let commitUnknown: ZoteroWriteCommitUnknownError | undefined
      let refused: unknown
      batch.verdicts.forEach((verdict, index) => {
        const node = frontier[index]!
        if (verdict.kind === 'applied') {
          options.progress.completedRefs.push(itemRef(node.key, serverId))
          remaining.delete(node.key)
          return
        }
        if (verdict.kind === 'unverified') options.onCommitUnknown?.(node)
        try {
          throwKeyedVerdict(verdict)
        } catch (error) {
          if (error instanceof ZoteroWriteCommitUnknownError) commitUnknown ??= error
          else if (refused === undefined) refused = error
        }
        blockAncestors(node.key)
      })
      if (commitUnknown !== undefined) throw commitUnknown
      if (refused !== undefined && failure === undefined) failure = refused
      continue
    }
    const node = frontier[0]!
    try {
      const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
        deps.writer.patch(
          `${libraryPrefix(PERSONAL_LIBRARY)}/items/${node.key}`,
          { deleted: options.wantDeleted ? 1 : 0 },
          {
            serverId,
            apiKey,
            ifUnmodifiedSinceVersion: node.version,
            signal,
          },
        ),
      )
      options.progress.libraryVersion = libraryVersion
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof ZoteroWriteCommitUnknownError) {
        options.onCommitUnknown?.(node)
        throw error
      }
      if (error instanceof ZoteroError && error.code === ZOTERO_WRITE_UNAUTHORIZED) throw error
      if (!(error instanceof ZoteroError)) throw error
      if (failure === undefined) failure = error
      blockAncestors(node.key)
      continue
    }
    options.progress.completedRefs.push(itemRef(node.key, serverId))
    remaining.delete(node.key)
  }
  if (failure !== undefined) throw failure
}

/**
 * Read the graph back and prove every node settled into `wantDeleted` with
 * the same key set the baseline read saw. Returns the read-back for the
 * caller's success receipts; a mismatch throws the caller's message as a
 * ZOTERO_UNEXPECTED refusal.
 */
export async function verifyTrashGraph(
  client: ZoteroHttpClient,
  rootKey: string,
  serverId: string,
  baseline: readonly TrashSnapshot[],
  options: { readonly wantDeleted: boolean; readonly message: string },
  signal: AbortSignal | undefined,
): Promise<readonly TrashSnapshot[]> {
  const saved = await readTrashGraph(client, rootKey, serverId, signal)
  const keys = new Set(baseline.map((node) => node.key))
  if (
    saved.length !== baseline.length ||
    saved.some((node) => node.deleted !== options.wantDeleted || !keys.has(node.key))
  ) {
    throw new ZoteroError(options.message, ZOTERO_UNEXPECTED)
  }
  return saved
}
