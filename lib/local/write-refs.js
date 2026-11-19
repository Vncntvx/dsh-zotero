/**
 * The `zotero://` ref strings the write paths hand back.
 *
 * A leaf module: the write domains and the write verdicts both need these
 * builders, and the verdicts sit below the domains in the dependency graph,
 * so the builders cannot live in the domain module without a cycle.
 * @module dsh-zotero/local/write-refs
 */
import { PERSONAL_LIBRARY, refStringFor } from '../refs.js';
export function itemRef(key, serverId) {
    return refStringFor(PERSONAL_LIBRARY, 'item', key, serverId);
}
export function collectionRef(key, serverId) {
    return refStringFor(PERSONAL_LIBRARY, 'collection', key, serverId);
}
export function searchRef(key, serverId) {
    return refStringFor(PERSONAL_LIBRARY, 'search', key, serverId);
}
//# sourceMappingURL=write-refs.js.map