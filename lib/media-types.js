/**
 * Media-type literals shared by the host and browser halves. The module has
 * no imports, so the client graph may inline it.
 * @module dsh-zotero/media-types
 */
/** The content type that makes an attachment a PDF. */
export const PDF_CONTENT_TYPE = 'application/pdf';
/** The content type that makes an attachment an HTML snapshot. */
export const HTML_CONTENT_TYPE = 'text/html';
/** Whether a content type names a PDF. */
export function isPdfContentType(contentType) {
    return contentType === PDF_CONTENT_TYPE;
}
//# sourceMappingURL=media-types.js.map