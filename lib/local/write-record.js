/** Versioned record mutations share authorization, preconditions and uncertain-commit settlement. */
import { writeObjectRefusedMessage, ZOTERO_NOT_FOUND, ZoteroError } from '../errors.js';
import { formatRef, libraryPrefix, PERSONAL_LIBRARY } from '../refs.js';
import { readRecordForWrite, requireLibraryVersion, withWriteKey } from './write-domain.js';
import { receiptOfCommitUnknown } from './write-verdicts.js';
async function mutateRecord(deps, target, version, patch, signal) {
    const path = `${libraryPrefix(PERSONAL_LIBRARY)}/${target.kind === 'collection' ? 'collections' : 'searches'}/${target.key}`;
    try {
        const result = await withWriteKey(deps, target.serverId, signal, async (apiKey) => {
            const options = {
                serverId: target.serverId,
                apiKey,
                ifUnmodifiedSinceVersion: version,
                signal,
            };
            try {
                return patch === undefined
                    ? await deps.writer.delete(path, options)
                    : await deps.writer.patch(path, patch, options);
            }
            catch (error) {
                if (patch === undefined && error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND)
                    throw new ZoteroError(writeObjectRefusedMessage(`The ${target.kind === 'collection' ? 'collection' : 'saved search'} no longer exists.`, 404), ZOTERO_NOT_FOUND, { cause: error });
                throw error;
            }
        });
        return { status: 'acknowledged', libraryVersion: result.libraryVersion };
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        return { status: 'unverified', value: receiptOfCommitUnknown(error, target) };
    }
}
export async function patchRecordForWrite(deps, target, version, patch, signal) {
    return await mutateRecord(deps, target, version, patch, signal);
}
export async function deleteRecordForWrite(deps, target, signal) {
    const read = await readRecordForWrite(deps, target.kind, target.key, target.serverId, signal);
    const pinned = { ...target, serverId: read.serverId };
    const outcome = await mutateRecord(deps, pinned, requireLibraryVersion(read.libraryVersion), undefined, signal);
    if (outcome.status === 'unverified')
        return outcome.value;
    return {
        kind: 'deleted',
        ref: formatRef({
            library: PERSONAL_LIBRARY,
            kind: target.kind,
            key: target.key,
            serverId: read.serverId,
        }),
        key: target.key,
        deleted: true,
        libraryVersion: outcome.libraryVersion,
        serverId: read.serverId,
    };
}
//# sourceMappingURL=write-record.js.map