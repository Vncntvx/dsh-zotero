/** Local API spelling shared by versioned reads and item-key batches. */
import { parseNonNegativeSafeInteger } from '../json.js';
export function numericHeader(headers, name) {
    return parseNonNegativeSafeInteger(headers.get(name));
}
/** Zotero splits one comma-joined itemKey value; callers own the 50-key batch bound. */
export function itemKeyList(keys) {
    return keys.join(',');
}
//# sourceMappingURL=wire.js.map