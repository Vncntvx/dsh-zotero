/**
 * The shared evidence-passage projection shape.
 *
 * Host presentation (`presentation-meta`) and the browser Sources panel
 * (`client/presenters`) must agree on one item vocabulary; this module is the
 * single definition and is CLIENT_SAFE (no refs, no errors, no codecs).
 * @module dsh-zotero/evidence-item
 */
/** The source vocabulary as a runtime whitelist, for decoders on both sides. */
const EVIDENCE_SOURCES = new Set([
    'annotation',
    'note',
    'fulltext',
    'abstract',
]);
/** Narrow a decoded source string over the whitelist. */
export function isEvidenceSource(source) {
    return EVIDENCE_SOURCES.has(source);
}
//# sourceMappingURL=evidence-item.js.map