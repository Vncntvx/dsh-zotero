/**
 * @module dsh-zotero/local/scope-paths
 */
import type { ZoteroItemLevel } from '../types.js';
/** Path segment for the requested item level: `items` for all items, `items/top` for top-level only. */
export declare function itemsSegmentFor(itemLevel?: ZoteroItemLevel): string;
/** My Publications item listing; Zotero serves it only from the personal library. */
export declare function publicationsItemsPath(): string;
/** My Publications tag facet over the same listing. */
export declare function publicationsTagsPath(): string;
//# sourceMappingURL=scope-paths.d.ts.map