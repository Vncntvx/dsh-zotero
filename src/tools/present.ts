/**
 * Shared presentation helpers for the model-facing tool renders.
 * @module dsh-zotero/tools/present
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
export { metaRecordOf, renderDeclined } from '../write-present.js'

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

/**
 * Flatten render blocks to the plain text a job outcome stores.
 * Non-text blocks are dropped, because job_output is a text receipt.
 */
export function textOfBlocks(blocks: ContentBlock[]): string {
  return blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}
