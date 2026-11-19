/**
 * The durable-result receipt line, parsed once for both halves. The host
 * route and the browser reader must agree on what counts as an announcement,
 * or a persisted body becomes unreachable on one side of the wire.
 * @module dsh-zotero/result-receipt
 */
import { RESULT_RECEIPT_PREFIX } from './constants.js';
import { isRecord } from './json.js';
export const RESULT_RECEIPT_REQUIRED_KEYS = [
    'delivery',
    'version',
    'tool',
    'sessionId',
    'callId',
    'summary',
    'createdAt',
    'file',
];
export const RESULT_FILE_REQUIRED_KEYS = ['attachmentId', 'name', 'bytes'];
const RECEIPT_KEYS = new Set([...RESULT_RECEIPT_REQUIRED_KEYS, 'jobId', 'facts']);
const FILE_KEYS = new Set(RESULT_FILE_REQUIRED_KEYS);
/**
 * Parse one text block as a persisted-result announcement.
 * @param text - the text block's content.
 * @returns the receipt when the line is a complete, owned delivery receipt.
 */
export function parseReceiptLine(text) {
    if (!text.startsWith(RESULT_RECEIPT_PREFIX))
        return undefined;
    try {
        const value = JSON.parse(text.slice(RESULT_RECEIPT_PREFIX.length).split('\n')[0]);
        if (!isRecord(value))
            return undefined;
        if (!RESULT_RECEIPT_REQUIRED_KEYS.every((key) => Object.hasOwn(value, key)) ||
            Object.keys(value).some((key) => !RECEIPT_KEYS.has(key)))
            return undefined;
        if (value['delivery'] !== 'file' || value['version'] !== 1)
            return undefined;
        if (typeof value['tool'] !== 'string' ||
            !value['tool'].startsWith('zotero_') ||
            value['tool'].length > 64)
            return undefined;
        if (typeof value['sessionId'] !== 'string' ||
            !value['sessionId'] ||
            typeof value['callId'] !== 'string' ||
            !value['callId'])
            return undefined;
        if (typeof value['summary'] !== 'string' ||
            value['summary'].length > 256 ||
            !Number.isSafeInteger(value['createdAt']) ||
            value['createdAt'] < 0)
            return undefined;
        if (value['jobId'] !== undefined && typeof value['jobId'] !== 'string')
            return undefined;
        if (value['facts'] !== undefined && !isRecord(value['facts']))
            return undefined;
        if (!isRecord(value['file']))
            return undefined;
        const file = value['file'];
        if (!RESULT_FILE_REQUIRED_KEYS.every((key) => Object.hasOwn(file, key)) ||
            Object.keys(file).some((key) => !FILE_KEYS.has(key)))
            return undefined;
        if (typeof file['attachmentId'] !== 'string' ||
            !file['attachmentId'] ||
            typeof file['name'] !== 'string' ||
            !file['name'] ||
            !Number.isSafeInteger(file['bytes']) ||
            file['bytes'] < 0)
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
/**
 * The attachment id a file-shaped record names, or undefined when the value
 * is not a record carrying a string id. The result read route and the ledger
 * receipt projection both narrow through this one check, so what counts as
 * "names an attachment" cannot drift between the two halves.
 * @param value - a candidate `attachment` record, or undefined.
 * @returns the attachment id, or undefined.
 */
export function attachmentIdOf(value) {
    if (!isRecord(value))
        return undefined;
    return typeof value['attachmentId'] === 'string' ? value['attachmentId'] : undefined;
}
/**
 * Find the announced receipt for one attachment among a block list.
 * @param blocks - block-shaped records from a tool result or message.
 * @param attachmentId - the attachment the caller intends to read.
 * @returns the matching receipt, or undefined when the block does not announce it.
 */
export function announcedReceipt(blocks, attachmentId) {
    if (attachmentId === undefined)
        return undefined;
    for (const block of blocks) {
        if (!isRecord(block) || typeof block['text'] !== 'string')
            continue;
        const receipt = parseReceiptLine(block['text']);
        if (receipt === undefined)
            continue;
        const file = receipt['file'];
        if (isRecord(file) && file['attachmentId'] === attachmentId)
            return receipt;
    }
    return undefined;
}
//# sourceMappingURL=result-receipt.js.map