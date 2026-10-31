/**
 * Shared proof rules for write results returned by Zotero's batch endpoints.
 * @module dsh-zotero/local/write-verdicts
 */
import { writeObjectRefusedMessage, ZOTERO_INVALID_ARGUMENT, ZOTERO_NOT_FOUND, ZOTERO_UNEXPECTED, ZOTERO_WRITE_CONFLICT, ZoteroError, } from '../errors.js';
import { asRecord, asString, isNonNegativeSafeInteger, isObjectKey } from '../json.js';
import { collectionRef, itemRef, searchRef } from './write-refs.js';
import { ZoteroWriteCommitUnknownError, } from '../write-http.js';
function objectRefusedError(refused) {
    switch (refused.code) {
        case 400:
            return new ZoteroError(writeObjectRefusedMessage(refused.message, refused.code), ZOTERO_INVALID_ARGUMENT);
        case 404:
            return new ZoteroError(writeObjectRefusedMessage(refused.message, refused.code), ZOTERO_NOT_FOUND);
        case 412:
            return new ZoteroError(writeObjectRefusedMessage(refused.message, refused.code), ZOTERO_WRITE_CONFLICT);
        default:
            return new ZoteroError(writeObjectRefusedMessage(refused.message, refused.code), ZOTERO_UNEXPECTED);
    }
}
function committedUnverified(options) {
    const { kind, batch, serverId, key, version, reason = 'saved-state-unverified' } = options;
    const safeKey = key !== undefined && isObjectKey(key) ? key : undefined;
    const ref = safeKey === undefined
        ? undefined
        : kind === 'collection'
            ? collectionRef(safeKey, serverId)
            : kind === 'search'
                ? searchRef(safeKey, serverId)
                : itemRef(safeKey, serverId);
    return {
        kind: 'committed-unverified',
        committed: true,
        retryable: false,
        reason,
        ...(safeKey !== undefined
            ? {
                key: safeKey,
                ...(ref !== undefined ? { ref } : {}),
                ...(version !== undefined ? { version } : {}),
            }
            : {}),
        ...(batch !== undefined ? { libraryVersion: batch.libraryVersion } : {}),
        serverId,
    };
}
async function sendSingleCreate(deps, path, entry, serverId, apiKey, signal, kind) {
    try {
        return await deps.writer.batch(path, [entry], { serverId, apiKey, signal });
    }
    catch (error) {
        if (error instanceof ZoteroWriteCommitUnknownError) {
            return committedUnverified({ kind, serverId, reason: 'commit-unknown' });
        }
        throw error;
    }
}
/**
 * Send one single-object create and settle what the answer proves.
 *
 * Both failure shapes are settled here so every create path reports them
 * alike: a commit whose outcome is unknown, and a batch that does not prove
 * what it was asked to write, each become a committed-unverified receipt —
 * never a retry. Only a proven entry reaches the caller, which then names
 * the object in its own vocabulary.
 */
export async function settleCreate(deps, request, proven) {
    const batch = await sendSingleCreate(deps, request.path, request.entry, request.serverId, request.apiKey, request.signal, request.kind);
    if ('kind' in batch)
        return { status: 'unverified', result: batch };
    return settleSingleEntryBatch(batch, request.kind, request.serverId, proven);
}
function settleSingleEntryBatch(batch, kind, serverId, proven) {
    const has = (bucket, index) => Object.hasOwn(bucket, index);
    const hasUnexpectedIndex = (bucket) => Object.keys(bucket).some((index) => index !== '0');
    const failed = has(batch.failed, '0');
    const successful = has(batch.successful, '0');
    const success = has(batch.success, '0');
    const unchanged = has(batch.unchanged, '0');
    if (hasUnexpectedIndex(batch.failed) ||
        hasUnexpectedIndex(batch.successful) ||
        hasUnexpectedIndex(batch.success) ||
        hasUnexpectedIndex(batch.unchanged) ||
        (failed && (successful || success || unchanged)) ||
        (unchanged && (successful || success)) ||
        (!failed && !successful && !success && !unchanged)) {
        return {
            status: 'unverified',
            result: committedUnverified({ kind, batch, serverId, reason: 'commit-unknown' }),
        };
    }
    const refused = batch.failed['0'];
    if (refused !== undefined)
        throw objectRefusedError(refused);
    const written = batch.successful['0'];
    const writtenKey = written === undefined ? undefined : asString(written.key);
    const successKey = asString(batch.success['0']);
    const key = writtenKey !== undefined && isObjectKey(writtenKey)
        ? writtenKey
        : successKey !== undefined && isObjectKey(successKey)
            ? successKey
            : undefined;
    const keyConflict = writtenKey !== undefined &&
        successKey !== undefined &&
        isObjectKey(writtenKey) &&
        isObjectKey(successKey) &&
        writtenKey !== successKey;
    if ((writtenKey !== undefined && !isObjectKey(writtenKey)) ||
        (successKey !== undefined && !isObjectKey(successKey)) ||
        (written !== undefined && writtenKey === undefined) ||
        keyConflict) {
        return {
            status: 'unverified',
            result: committedUnverified({ kind, batch, serverId, key: keyConflict ? undefined : key }),
        };
    }
    if (key === undefined) {
        return { status: 'unverified', result: committedUnverified({ kind, batch, serverId }) };
    }
    const version = isNonNegativeSafeInteger(written?.version) ? written.version : undefined;
    if (version === undefined) {
        return { status: 'unverified', result: committedUnverified({ kind, batch, serverId, key }) };
    }
    const data = asRecord(written.data);
    if (data === undefined || data.key !== key || data.version !== version) {
        return {
            status: 'unverified',
            result: committedUnverified({ kind, batch, serverId, key, version }),
        };
    }
    const payload = proven(data, key, version);
    if (payload === undefined) {
        return {
            status: 'unverified',
            result: committedUnverified({ kind, batch, serverId, key, version }),
        };
    }
    return {
        status: 'applied',
        entry: { key, version, data, libraryVersion: batch.libraryVersion, payload },
    };
}
export function batchCreateUnverified(index, reason, serverId) {
    return { op: 'create', index, committed: true, retryable: false, reason, serverId };
}
export function settleBatchCreates(batch, creates, serverId, created, unverified, failed) {
    const indices = new Set(creates.map((_, index) => String(index)));
    const buckets = [batch.successful, batch.success, batch.failed, batch.unchanged];
    const unexpectedIndex = buckets.some((bucket) => Object.keys(bucket).some((index) => !indices.has(index)));
    const owners = new Map();
    for (let index = 0; index < creates.length; index++) {
        for (const key of [asString(batch.successful[index]?.key), batch.success[index]]) {
            if (key === undefined || !isObjectKey(key))
                continue;
            const indicesForKey = owners.get(key) ?? new Set();
            indicesForKey.add(index);
            owners.set(key, indicesForKey);
        }
    }
    const at = (bucket, index) => Object.hasOwn(bucket, String(index)) ? { '0': bucket[index] } : {};
    for (let index = 0; index < creates.length; index++) {
        const duplicateKey = [asString(batch.successful[index]?.key), batch.success[index]].some((key) => key !== undefined && (owners.get(key)?.size ?? 0) > 1);
        if (unexpectedIndex || duplicateKey) {
            unverified.push(batchCreateUnverified(index, 'commit-unknown', serverId));
            continue;
        }
        try {
            const settled = settleSingleEntryBatch({
                successful: at(batch.successful, index),
                success: at(batch.success, index),
                failed: at(batch.failed, index),
                unchanged: at(batch.unchanged, index),
                libraryVersion: batch.libraryVersion,
            }, 'item', serverId, (data) => {
                const itemType = asString(data.itemType);
                return itemType === creates[index].itemType
                    ? { itemType, title: asString(data.title), url: asString(data.url) }
                    : undefined;
            });
            if (settled.status === 'unverified') {
                const { kind: _kind, ...receipt } = settled.result;
                unverified.push({ ...receipt, op: 'create', index });
            }
            else {
                const { key, version, payload } = settled.entry;
                created.push({
                    index,
                    ref: itemRef(key, serverId),
                    key,
                    version,
                    itemType: payload.itemType,
                    ...(payload.title !== undefined ? { title: payload.title } : {}),
                    ...(payload.url !== undefined ? { url: payload.url } : {}),
                });
            }
        }
        catch (error) {
            if (!(error instanceof ZoteroError))
                throw error;
            failed.push({ op: 'create', index, code: error.code, message: error.message });
        }
    }
}
//# sourceMappingURL=write-verdicts.js.map