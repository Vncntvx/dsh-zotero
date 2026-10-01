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
/**
 * A normalized attachment child row, before ref provenance is attached.
 * Ref-free on purpose: callers own the `?server=` qualifier.
 */
export interface ZoteroAttachmentCandidate {
    readonly key: string;
    readonly title: string;
    readonly contentType: string;
    readonly linkMode?: string;
    /** `data.url`; meaningful for `linked_url` attachments. */
    readonly url?: string;
}
/** Extract a Zotero object key from an API `links.attachment.href`. */
export declare function extractAttachmentKey(href: string | undefined): string | undefined;
/**
 * Read Zotero's own best-attachment link from an item response.
 * @returns the attachment key and content type, or undefined when the item
 * has no attachment link (or its href carries no valid Zotero key).
 */
export declare function bestAttachmentFromLinks(json: unknown): {
    key: string;
    contentType: string;
} | undefined;
/**
 * Normalize one attachment item JSON object.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export declare function normalizeAttachmentRecord(json: unknown): ZoteroAttachmentCandidate;
export declare function selectAttachments(rows: readonly unknown[], kind: string): readonly ZoteroAttachmentCandidate[];
//# sourceMappingURL=attachments.d.ts.map