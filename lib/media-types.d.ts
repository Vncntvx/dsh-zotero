/**
 * Media-type literals shared by the host and browser halves. The module has
 * no imports, so the client graph may inline it.
 * @module dsh-zotero/media-types
 */
/** The content type that makes an attachment a PDF. */
export declare const PDF_CONTENT_TYPE = "application/pdf";
/** The content type that makes an attachment an HTML snapshot. */
export declare const HTML_CONTENT_TYPE = "text/html";
/** Whether a content type names a PDF. */
export declare function isPdfContentType(contentType: string | undefined): boolean;
//# sourceMappingURL=media-types.d.ts.map