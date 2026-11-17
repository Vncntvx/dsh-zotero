/** Read and verify the complete object graph for a recoverable item deletion. */
import type { ZoteroHttpClient } from '../http-client.js'
import { mapWithConcurrency } from '../concurrency.js'
import { asRecord, asString, isObjectKey } from '../json.js'
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import { fetchChildrenForTrash } from './children-wire.js'
import { proveItemRead } from './write-item-proof.js'

export interface TrashSnapshot {
  key: string
  version: number
  itemType: string
  deleted: boolean
  parentKey?: string
}

/** Sibling child listings are independent reads; this bounds their parallelism. */
const TRASH_GRAPH_CONCURRENCY = 4

function snapshotOf(json: unknown, key: string): TrashSnapshot {
  const message = `Zotero returned an invalid Trash snapshot for ${key}.`
  const { data, version, itemType } = proveItemRead(json, key, {
    version: message,
    identity: message,
    itemType: message,
  })
  if (
    data?.deleted !== undefined &&
    data.deleted !== 0 &&
    data.deleted !== 1 &&
    typeof data.deleted !== 'boolean'
  ) {
    throw new ZoteroError(
      `Zotero returned an invalid Trash snapshot for ${key}.`,
      ZOTERO_UNEXPECTED,
    )
  }
  return {
    key,
    version,
    itemType,
    deleted: data.deleted === true || data.deleted === 1,
    ...(typeof data.parentItem === 'string' && data.parentItem !== ''
      ? { parentKey: data.parentItem }
      : {}),
  }
}

async function readTrashSnapshot(
  client: ZoteroHttpClient,
  key: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<TrashSnapshot> {
  const { json, headers } = await client.getJson<unknown>(`users/0/items/${key}`, undefined, {
    serverId,
    signal,
  })
  assertServerIdMatches(serverIdFromHeaders(headers), serverId)
  return snapshotOf(json, key)
}

/**
 * Children precede their parent so a failed child never hides an untrashed
 * object, and sibling order follows the listing order. One round trip per
 * graph level: the child listings of one node's children are independent
 * reads and run concurrently.
 */
async function readGraph(
  client: ZoteroHttpClient,
  key: string,
  serverId: string,
  signal?: AbortSignal,
  childReads?: Map<string, Promise<unknown[]>>,
): Promise<TrashSnapshot[]> {
  const seen = new Set<string>()
  const visit = async (node: TrashSnapshot): Promise<TrashSnapshot[]> => {
    if (seen.has(node.key))
      throw new ZoteroError(
        `Zotero repeated child ${node.key} in the Trash graph.`,
        ZOTERO_UNEXPECTED,
      )
    seen.add(node.key)
    if (node.itemType === 'annotation') return [node]
    let pending = childReads?.get(node.key)
    if (pending === undefined) {
      pending = fetchChildrenForTrash(
        { client },
        node.key,
        serverId,
        node.itemType === 'attachment',
        signal,
      )
      childReads?.set(node.key, pending)
    }
    const children = await pending
    const childSnapshots = children.map((json) => {
      const data = asRecord(asRecord(json)?.data)
      const childKey = asString(asRecord(json)?.key)
      if (childKey === undefined || !isObjectKey(childKey) || data?.parentItem !== node.key) {
        throw new ZoteroError(`Zotero returned an invalid child of ${node.key}.`, ZOTERO_UNEXPECTED)
      }
      return snapshotOf(json, childKey)
    })
    const childGraphs = await mapWithConcurrency(childSnapshots, TRASH_GRAPH_CONCURRENCY, visit, {
      signal,
    })
    return [...childGraphs.flat(), node]
  }
  return visit(await readTrashSnapshot(client, key, serverId, signal))
}

/** Read one complete graph from the current server state, including verification reads. */
export function readTrashGraph(
  client: ZoteroHttpClient,
  key: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<TrashSnapshot[]> {
  return readGraph(client, key, serverId, signal)
}

/**
 * Preflight independent roots concurrently and share their child listings.
 * Consuming a graph invalidates overlapping preflights: an earlier write may
 * have changed their versions, even if that write subsequently failed.
 * Verification always uses readTrashGraph and never this snapshot cache.
 */
export async function preflightTrashGraphs(
  client: ZoteroHttpClient,
  keys: readonly string[],
  serverId: string,
  signal?: AbortSignal,
): Promise<{ take(key: string): Promise<TrashSnapshot[]> }> {
  type Outcome = { graph: TrashSnapshot[] } | { error: unknown }
  const childReads = new Map<string, Promise<unknown[]>>()
  const prepared = new Map<string, Outcome>()
  await mapWithConcurrency(
    [...new Set(keys)],
    TRASH_GRAPH_CONCURRENCY,
    async (key) => {
      try {
        prepared.set(key, { graph: await readGraph(client, key, serverId, signal, childReads) })
      } catch (error) {
        signal?.throwIfAborted()
        prepared.set(key, { error })
      }
    },
    { signal },
  )
  const consumed = new Set<string>()
  return {
    async take(key) {
      signal?.throwIfAborted()
      const outcome = prepared.get(key)
      if (outcome === undefined)
        throw new ZoteroError(`No Trash preflight exists for ${key}.`, ZOTERO_UNEXPECTED)
      if ('error' in outcome) throw outcome.error
      const graph = outcome.graph.some((node) => consumed.has(node.key))
        ? await readTrashGraph(client, key, serverId, signal)
        : outcome.graph
      for (const node of graph) consumed.add(node.key)
      return graph
    },
  }
}
