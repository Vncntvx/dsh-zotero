/**
 * Durable result handles are recovered only from recorded tool blocks. The
 * parser lives with the source ledger so the host projection and the browser
 * fallback read receipts the same way.
 * @module dsh-zotero/sources/receipt
 */

import { announcedReceipt, attachmentIdOf } from '../result-receipt.js'
import { isRecord } from '../json.js'
import type { ToolBlockLike } from './block-types.js'

/**
 * The durable-result receipt a settled block carries, or null when it carries
 * none. A failed block never carries a usable handle.
 * @param block - the tool block to read.
 * @returns the receipt record, or null.
 */
export function receiptOf(block: ToolBlockLike): Record<string, unknown> | null {
  if (!('content' in block) || block.isError) return null
  const file = block.content.find((entry) => entry.type === 'file')
  const attachmentId = attachmentIdOf(file?.attachment)
  if (attachmentId === undefined) return null
  const receipt = announcedReceipt(block.content, attachmentId)
  return isRecord(receipt) ? receipt : null
}
