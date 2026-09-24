/**
 * Shared presentation helpers for the model-facing tool renders.
 * @module dsh-zotero/tools/present
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { asRecord } from '../json.js'

/**
 * The completed-result metadata as a record: undefined for failed calls
 * (which keep the raw error content), for absent metadata on nested code
 * dispatch or malformed replay records, and for non-object shapes. Every
 * `presentResult` funnels through here so the completed card falls back to
 * the generic card the same way on every tool.
 * @param result - the settled tool result.
 * @returns the metadata record, or undefined for the generic fallback.
 */
export function metaRecordOf(result: ToolResult): Record<string, unknown> | undefined {
  if (result.isError) return undefined
  return asRecord(result.meta)
}

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
 * The declined-write content: the user answered the plan without approving,
 * so nothing was written. Shared by the three write tools so the wording
 * cannot drift between them.
 * @returns the single declined text block.
 */
export function renderDeclined(): ContentBlock[] {
  return [
    {
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    },
  ]
}
