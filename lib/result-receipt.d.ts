/**
 * The durable-result receipt line, parsed once for both halves. The host
 * route and the browser reader must agree on what counts as an announcement,
 * or a persisted body becomes unreachable on one side of the wire.
 * @module dsh-zotero/result-receipt
 */
/** One parsed receipt line: the persisted-result announcement a file block carries. */
export type ResultReceipt = Record<string, unknown>;
/**
 * Parse one text block as a persisted-result announcement.
 * @param text - the text block's content.
 * @returns the receipt when the line is a complete, owned delivery receipt.
 */
export declare function parseReceiptLine(text: string): ResultReceipt | undefined;
/**
 * The attachment id a file-shaped record names, or undefined when the value
 * is not a record carrying a string id. The result read route and the ledger
 * receipt projection both narrow through this one check, so what counts as
 * "names an attachment" cannot drift between the two halves.
 * @param value - a candidate `attachment` record, or undefined.
 * @returns the attachment id, or undefined.
 */
export declare function attachmentIdOf(value: unknown): string | undefined;
/**
 * Find the announced receipt for one attachment among a block list.
 * @param blocks - block-shaped records from a tool result or message.
 * @param attachmentId - the attachment the caller intends to read.
 * @returns the matching receipt, or undefined when the block does not announce it.
 */
export declare function announcedReceipt(blocks: readonly unknown[], attachmentId: string | undefined): ResultReceipt | undefined;
//# sourceMappingURL=result-receipt.d.ts.map