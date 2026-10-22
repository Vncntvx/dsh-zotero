/** Read and verify the complete object graph for a recoverable item deletion. */
import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_SERVER_ID_HEADER } from '../constants.js'
import { asRecord, asString, isNonNegativeSafeInteger, isObjectKey } from '../json.js'
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js'
import { assertServerIdMatches } from './identity.js'
import { fetchChildrenForTrash } from './children-wire.js'

export interface TrashSnapshot {
  key: string
  version: number
  itemType: string
  deleted: boolean
}

function snapshotOf(json: unknown, key: string): TrashSnapshot {
  const row = asRecord(json)
  const data = asRecord(row?.data)
  const itemType = asString(data?.itemType)
  if (
    row?.key !== key ||
    data?.key !== key ||
    !isNonNegativeSafeInteger(row?.version) ||
    data?.version !== row.version ||
    itemType === undefined ||
    itemType === '' ||
    (data?.deleted !== undefined &&
      data.deleted !== 0 &&
      data.deleted !== 1 &&
      typeof data.deleted !== 'boolean')
  ) {
    throw new ZoteroError(
      `Zotero returned an invalid Trash snapshot for ${key}.`,
      ZOTERO_UNEXPECTED,
    )
  }
  return {
    key,
    version: row.version,
    itemType,
    deleted: data.deleted === true || data.deleted === 1,
  }
}

export async function readTrashSnapshot(
  client: ZoteroHttpClient,
  key: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<TrashSnapshot> {
  const { json, headers } = await client.getJson<unknown>(`users/0/items/${key}`, undefined, {
    serverId,
    signal,
  })
  assertServerIdMatches(headers.get(ZOTERO_SERVER_ID_HEADER), serverId)
  return snapshotOf(json, key)
}

/** Children precede their parent so a failed child never hides an untrashed object. */
export async function readTrashGraph(
  client: ZoteroHttpClient,
  key: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<TrashSnapshot[]> {
  const ordered: TrashSnapshot[] = []
  const seen = new Set<string>()
  const visit = async (node: TrashSnapshot): Promise<void> => {
    if (seen.has(node.key))
      throw new ZoteroError(
        `Zotero repeated child ${node.key} in the Trash graph.`,
        ZOTERO_UNEXPECTED,
      )
    seen.add(node.key)
    if (node.itemType !== 'annotation') {
      const children = await fetchChildrenForTrash(
        { client },
        node.key,
        serverId,
        node.itemType === 'attachment',
        signal,
      )
      for (const json of children) {
        const data = asRecord(asRecord(json)?.data)
        const childKey = asString(asRecord(json)?.key)
        if (childKey === undefined || !isObjectKey(childKey) || data?.parentItem !== node.key) {
          throw new ZoteroError(
            `Zotero returned an invalid child of ${node.key}.`,
            ZOTERO_UNEXPECTED,
          )
        }
        await visit(snapshotOf(json, childKey))
      }
    }
    ordered.push(node)
  }
  await visit(await readTrashSnapshot(client, key, serverId, signal))
  return ordered
}
