/**
 * One item's wire window: each row list keeps its transcript head up to the
 * shared cap. An item already inside the cap keeps its identity, so a windowed
 * read allocates only for the items it actually cuts.
 * @module dsh-zotero/sources/window
 */
import type { SourceItem, SourceWorkspace } from './model.js';
/**
 * Cut one item's row lists to the wire cap.
 * @param item - the frozen item.
 * @returns the item itself when nothing was cut, else a cut copy.
 */
export declare function windowedItem(item: SourceItem): SourceItem;
/** Cache the compact broadcast view; complete rows stay behind the sourcePage endpoint. */
export declare function createSourceWireView(): (workspace: SourceWorkspace, revision?: number) => SourceWorkspace;
//# sourceMappingURL=window.d.ts.map