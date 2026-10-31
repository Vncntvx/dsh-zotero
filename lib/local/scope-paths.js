/**
 * @module dsh-zotero/local/scope-paths
 */
import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js';
/** Path segment for the requested item level: `items` for all items, `items/top` for top-level only. */
export function itemsSegmentFor(itemLevel) {
    return itemLevel === 'all' ? 'items' : 'items/top';
}
/** My Publications item listing; Zotero serves it only from the personal library. */
export function publicationsItemsPath() {
    return `${libraryPrefix(PERSONAL_LIBRARY)}/publications/items`;
}
/** My Publications tag facet over the same listing. */
export function publicationsTagsPath() {
    return `${publicationsItemsPath()}/tags`;
}
//# sourceMappingURL=scope-paths.js.map