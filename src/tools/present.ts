/**
 * Shared presentation helpers for the model-facing tool renders.
 * @module dsh-zotero/tools/present
 */

/**
 * The canonical search-hit title line: `ref — title (year) [itemType]`.
 * `zotero_search` and `zotero_get` render it identically so a hit reads the
 * same wherever the agent saw it.
 * @param ref - the formatted object ref.
 * @param title - the item title.
 * @param year - the publication year, when known.
 * @param itemType - the Zotero item type.
 * @returns the single-line summary.
 */
export function formatSearchLine(
  ref: string,
  title: string,
  year: number | undefined,
  itemType: string,
): string {
  return `${ref} — ${title}${year === undefined ? '' : ` (${year})`} [${itemType}]`
}
