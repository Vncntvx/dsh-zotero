/**
 * Attachment records and deterministic attachment selection.
 *
 * Zotero's own best-attachment choice (`links.attachment` on item
 * responses) is preferred wherever it exists; `selectAttachments` is the
 * documented fallback that ranks child rows the same way Zotero's
 * `getBestAttachment` does — PDF over other kinds, imported files first,
 * then earliest addition date, then key order. Single selection is the
 * ranking's first entry.
 * @module dsh-zotero/attachments
 */
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js';
import { asRecord, asString, isObjectKey } from './json.js';
import { ATTACHMENT_HREF_PATTERN } from './ref-grammar.js';
/** Extract a Zotero object key from an API `links.attachment.href`. */
export function extractAttachmentKey(href) {
    if (href === undefined)
        return undefined;
    return ATTACHMENT_HREF_PATTERN.exec(href)?.[1];
}
/**
 * Read Zotero's own best-attachment link from an item response.
 * @returns the attachment key and content type, or undefined when the item
 * has no attachment link (or its href carries no valid Zotero key).
 */
export function bestAttachmentFromLinks(json) {
    const attachment = asRecord(asRecord(asRecord(json)?.links)?.attachment);
    const key = extractAttachmentKey(asString(attachment?.href));
    if (key === undefined)
        return undefined;
    return { key, contentType: asString(attachment?.attachmentType) ?? '' };
}
/**
 * Normalize one attachment item JSON object.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeAttachmentRecord(json) {
    const record = asRecord(json);
    const key = asString(record?.key);
    if (key === undefined || !isObjectKey(key)) {
        throw new ZoteroError('Zotero returned an attachment without a valid object key.', ZOTERO_UNEXPECTED);
    }
    const data = asRecord(record?.data);
    const linkMode = asString(data?.linkMode);
    const url = asString(data?.url);
    return {
        key,
        title: asString(data?.title) ?? '',
        contentType: asString(data?.contentType) ?? '',
        ...(linkMode !== undefined ? { linkMode } : {}),
        ...(url !== undefined ? { url } : {}),
    };
}
/**
 * Select every attachment of the requested kind from raw child rows, ordered
 * by the same deterministic ranking Zotero's `getBestAttachment` uses — so
 * the first entry always equals the single-selection answer, and a work with
 * several PDFs (publisher copy, manuscript, supplement) can enter evidence
 * ranking as several first-class sources.
 */
/** dateAdded stand-in sorting after every real ISO timestamp (unknown is not earliest). */
const UNKNOWN_DATE_LAST = '\uffff';
export function selectAttachments(rows, kind) {
    const wantedContentType = kind === 'pdf' ? 'application/pdf' : kind;
    const scored = [];
    for (const row of rows) {
        const record = asRecord(row);
        const data = asRecord(record?.data);
        if (asString(data?.contentType) === undefined)
            continue;
        const candidate = normalizeAttachmentRecord(row);
        if (candidate.contentType !== wantedContentType)
            continue;
        // Unknown dates sort last: '' would collate before any ISO timestamp and
        // steal the earliest-added fallback, while unknown is not earliest.
        scored.push({ candidate, dateAdded: asString(data?.dateAdded) ?? UNKNOWN_DATE_LAST });
    }
    // dateAdded is an ISO timestamp and key an opaque token: code-unit order
    // is chronological (and Zotero-faithful) without depending on ICU locale.
    scored.sort((a, b) => {
        const rankA = a.candidate.linkMode === 'imported_file' ? 0 : 1;
        const rankB = b.candidate.linkMode === 'imported_file' ? 0 : 1;
        if (rankA !== rankB)
            return rankA - rankB;
        if (a.dateAdded !== b.dateAdded)
            return a.dateAdded < b.dateAdded ? -1 : 1;
        if (a.candidate.key !== b.candidate.key)
            return a.candidate.key < b.candidate.key ? -1 : 1;
        return 0;
    });
    return scored.map((entry) => entry.candidate);
}
//# sourceMappingURL=attachments.js.map