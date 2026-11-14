/**
 * Durable result handles are recovered only from recorded tool blocks. The
 * parser lives with the source ledger so the host projection and the browser
 * fallback read receipts the same way.
 * @module dsh-zotero/sources/receipt
 */
import type { ToolBlockLike } from './block-types.js';
/**
 * The durable-result receipt a settled block carries, or null when it carries
 * none. A failed block never carries a usable handle.
 * @param block - the tool block to read.
 * @returns the receipt record, or null.
 */
export declare function receiptOf(block: ToolBlockLike): Record<string, unknown> | null;
//# sourceMappingURL=receipt.d.ts.map