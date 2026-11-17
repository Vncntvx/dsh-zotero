/** Deterministic, read-only refusals precede approval; execution rechecks current state. */
import type { ZoteroWritePreflight } from '../types.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import type { WriteDomainDeps } from './write-deps.js'
import { prepareCreateCollection } from './write-collections.js'
import {
  collectionState,
  ensureServerId,
  readItemForWrite,
  requireWritableRefAtServer,
} from './write-domain.js'

export async function preflightWrite(
  deps: WriteDomainDeps,
  input: ZoteroWritePreflight,
  signal?: AbortSignal,
): Promise<void> {
  if (input.operation === 'createCollection') {
    await prepareCreateCollection(deps, input.request, signal)
    return
  }
  const serverId = await ensureServerId(deps, signal)
  const item = requireWritableRefAtServer(input.request.item, ['item'], serverId)
  if (input.operation === 'updateItemCollections') {
    await readItemForWrite(deps, item, serverId, collectionState, signal)
    return
  }
  const snapshot = await readItemForWrite(deps, item, serverId, () => ({}), signal)
  if (snapshot.itemType !== 'note')
    throw new ZoteroError('The target item is not a Zotero note.', ZOTERO_INVALID_ARGUMENT)
}
