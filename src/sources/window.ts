/**
 * One item's wire window: each row list keeps its transcript head up to the
 * shared cap. An item already inside the cap keeps its identity, so a windowed
 * read allocates only for the items it actually cuts.
 * @module dsh-zotero/sources/window
 */

import { ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS } from '../constants.js'
import type { SourceItem } from './model.js'

/**
 * Cut one item's row lists to the wire cap.
 * @param item - the frozen item.
 * @returns the item itself when nothing was cut, else a cut copy.
 */
export function windowedItem(item: SourceItem): SourceItem {
  const rowCap = ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS
  const searches = item.searches.length > rowCap ? item.searches.slice(0, rowCap) : item.searches
  const evidence = item.evidence.length > rowCap ? item.evidence.slice(0, rowCap) : item.evidence
  const exports = item.exports.length > rowCap ? item.exports.slice(0, rowCap) : item.exports
  // Windows of one long read are the list most likely to grow past the cap.
  const fulltextReads =
    item.fulltextReads.length > rowCap ? item.fulltextReads.slice(0, rowCap) : item.fulltextReads
  if (
    searches === item.searches &&
    evidence === item.evidence &&
    exports === item.exports &&
    fulltextReads === item.fulltextReads
  ) {
    return item
  }
  return { ...item, searches, evidence, exports, fulltextReads }
}
