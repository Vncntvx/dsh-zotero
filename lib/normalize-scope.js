/**
 * @module dsh-zotero/normalize-scope
 */
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js';
import { asRecord, asString, isObjectKey, numberField } from './json.js';
export function normalizeScopeEntry(json) {
    const record = asRecord(json);
    const key = asString(record?.key);
    if (key === undefined || !isObjectKey(key)) {
        throw new ZoteroError('Zotero returned a scope object without a valid object key.', ZOTERO_UNEXPECTED);
    }
    const data = asRecord(record?.data);
    const meta = asRecord(record?.meta) ?? {};
    const parent = asString(data?.parentCollection);
    const parentKey = parent !== undefined && isObjectKey(parent) ? parent : undefined;
    const childCount = numberField(meta, 'numCollections');
    const itemCount = numberField(meta, 'numItems');
    return {
        key,
        name: asString(data?.name) ?? '',
        ...(parentKey !== undefined ? { parentKey } : {}),
        ...(childCount !== undefined ? { childCount } : {}),
        ...(itemCount !== undefined ? { itemCount } : {}),
    };
}
export function matchScopeName(entries, wanted) {
    const exact = entries.filter((entry) => entry.name === wanted);
    if (exact.length > 0)
        return exact;
    const wantedLower = wanted.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase() === wantedLower);
}
export function nearScopeCandidates(entries, wanted, limit = 5) {
    const wantedLower = wanted.toLowerCase();
    return entries
        .filter((entry) => entry.name.toLowerCase().includes(wantedLower))
        .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        .slice(0, limit);
}
//# sourceMappingURL=normalize-scope.js.map