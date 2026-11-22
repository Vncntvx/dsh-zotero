import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js';
import { prepareCreateCollection } from './write-collections.js';
import { collectionState, ensureServerId, readItemForWrite, requireWritableRefAtServer, } from './write-domain.js';
export async function preflightWrite(deps, input, signal) {
    if (input.operation === 'createCollection') {
        await prepareCreateCollection(deps, input.request, signal);
        return;
    }
    const serverId = await ensureServerId(deps, signal);
    const item = requireWritableRefAtServer(input.request.item, ['item'], serverId);
    if (input.operation === 'updateItemCollections') {
        await readItemForWrite(deps, item, serverId, collectionState, signal);
        return;
    }
    const snapshot = await readItemForWrite(deps, item, serverId, () => ({}), signal);
    if (snapshot.itemType !== 'note')
        throw new ZoteroError('The target item is not a Zotero note.', ZOTERO_INVALID_ARGUMENT);
}
//# sourceMappingURL=write-preflight.js.map