import { deleteRecordForWrite, patchRecordForWrite } from './write-record.js';
import { submittedFieldsMatch } from './write-content-proof.js';
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
/**
 * Write operations for saved-search records.
 * @module dsh-zotero/local/write-saved-searches
 */
import { requireNonBlank, ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError, ZoteroWriteCommitUnknownError, } from '../errors.js';
import { asString } from '../json.js';
import { requireUpdateField } from '../write-item-rules.js';
import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js';
import { normalizeSavedSearchConditions } from '../normalize-saved-search.js';
import { searchRef } from './write-refs.js';
import { ensureServerId, readRecordForWrite, requireWritableRefAtServer, withWriteKey, } from './write-domain.js';
import { committedUnverified, settleCreate } from './write-verdicts.js';
export async function createSavedSearch(deps, request, signal) {
    const name = requireNonBlank('name', request.name);
    if (request.conditions.length === 0)
        throw new ZoteroError('conditions cannot be empty.', ZOTERO_INVALID_ARGUMENT);
    const serverId = await ensureServerId(deps, signal);
    const entry = { name, conditions: request.conditions };
    return await withWriteKey(deps, serverId, signal, async (apiKey) => {
        const settled = await settleCreate(deps, {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/searches`,
            entry,
            serverId,
            apiKey,
            signal,
            kind: 'search',
        }, (data) => {
            const savedName = asString(data.name);
            const conditions = normalizeSavedSearchConditions(data.conditions);
            return savedName === name &&
                conditions !== undefined &&
                submittedFieldsMatch({ conditions }, { conditions: request.conditions })
                ? { savedName, conditions }
                : undefined;
        });
        if (settled.status === 'unverified')
            return settled.result;
        const { key, version, payload } = settled.entry;
        return {
            kind: 'applied',
            ref: searchRef(key, serverId),
            key,
            version,
            name: payload.savedName,
            conditions: payload.conditions,
            libraryVersion: settled.entry.libraryVersion,
            serverId,
        };
    });
}
export async function updateSavedSearch(deps, request, signal) {
    requireUpdateField({ name: request.name, conditions: request.conditions });
    if (request.conditions?.length === 0)
        throw new ZoteroError('conditions cannot be empty.', ZOTERO_INVALID_ARGUMENT);
    const serverId = await ensureServerId(deps, signal);
    const ref = requireWritableRefAtServer(request.search, ['search'], serverId);
    const { data, version } = await readRecordForWrite(deps, 'search', ref.key, serverId, signal);
    const name = request.name === undefined ? asString(data?.name) : requireNonBlank('name', request.name);
    const conditions = request.conditions ?? normalizeSavedSearchConditions(data?.conditions);
    if (name === undefined || conditions === undefined) {
        throw new ZoteroError(`The saved search's stored name or conditions are unreadable; refusing to update without an honest report of the search's state.`, ZOTERO_UNEXPECTED);
    }
    const patch = {};
    if (request.name !== undefined)
        patch.name = requireNonBlank('name', request.name);
    if (request.conditions !== undefined)
        patch.conditions = request.conditions;
    const outcome = await patchRecordForWrite(deps, { kind: 'search', key: ref.key, serverId }, version, patch, signal);
    if (outcome.status === 'unverified')
        return outcome.value;
    const { libraryVersion } = outcome;
    const unverified = () => ({
        ...committedUnverified({
            kind: 'search',
            key: ref.key,
            serverId,
            reason: 'saved-state-unverified',
        }),
        libraryVersion,
    });
    try {
        const saved = await readRecordForWrite(deps, 'search', ref.key, serverId, signal);
        signal?.throwIfAborted();
        if (saved.version < version ||
            saved.data === undefined ||
            !submittedFieldsMatch(saved.data, { name, conditions }))
            return unverified();
        return {
            kind: 'applied',
            ref: searchRef(ref.key, serverId),
            key: ref.key,
            version: saved.version,
            name,
            conditions,
            libraryVersion,
            serverId,
        };
    }
    catch (cause) {
        const receipt = unverified();
        if (signal?.aborted) {
            const ref = receipt.ref;
            throw new ZoteroWriteCommitUnknownError(`Zotero acknowledged the dispatched write to ${ref} at library version ${libraryVersion}. Verification was cancelled (committed-unverified). Do not retry; read the saved search to reconcile first.`, TOOL_ABORTED, { cause, receipt, unverifiedRefs: [ref] });
        }
        return receipt;
    }
}
export async function deleteSavedSearch(deps, request, signal) {
    const serverId = await ensureServerId(deps, signal);
    const ref = requireWritableRefAtServer(request.search, ['search'], serverId);
    return await deleteRecordForWrite(deps, { kind: 'search', key: ref.key, serverId }, signal);
}
//# sourceMappingURL=write-saved-searches.js.map