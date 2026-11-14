/**
 * The core-owned, read-only artifact seam. Enrichment may fill this slot;
 * ordinary readers cannot acquire document bytes or submit parsing work.
 * @module dsh-zotero/local/fulltext-enhancer
 */
/** Minimum useful text size for the scholarly reader's local PDF extractor. */
export const FULLTEXT_ENHANCER_MIN_TEXT_CHARS = 500;
/**
 * Whether a source is a PDF `candidate`: an absent MIME type counts, because
 * byte validation belongs to active parsing.
 *
 * It is not the same question as `media-types.isPdfContentType`, which asks
 * whether a *known* MIME type is exactly PDF. The two used to share a name, and
 * a caller that imported the wrong one silently changed the answer for a missing
 * or parameterized content type.
 */
export function isPdfCandidateContentType(contentType) {
    if (contentType === undefined || contentType.trim() === '')
        return true;
    const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    return base === 'application/pdf';
}
//# sourceMappingURL=fulltext-enhancer.js.map