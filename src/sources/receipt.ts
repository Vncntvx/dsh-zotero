/**
 * Durable result handles are recovered only from recorded tool blocks. The
 * parser lives with the source ledger so the host projection and the browser
 * fallback read receipts the same way.
 * @module dsh-zotero/sources/receipt
 */

import { parseReceiptLine } from '../result-receipt.js'
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
  if (file?.type !== 'file') return null
  for (const entry of block.content) {
    if (entry.type !== 'text') continue
    const receipt = parseReceiptLine(entry.text)
    if (
      receipt !== undefined &&
      isRecord(receipt['file']) &&
      receipt['file']['attachmentId'] === file.attachment.attachmentId
    )
      return receipt
  }
  return null
}
