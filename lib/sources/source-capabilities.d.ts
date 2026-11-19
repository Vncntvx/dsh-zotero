/**
 * The PDF capability of one source: which attachment answers the open-PDF
 * action, and whether the openable target is Zotero's own reader (a
 * `zotero://open-pdf` deep link on a file attachment) or the web location
 * of a linked URL PDF. The capability is the single source of truth behind
 * the PDF badge, the "with PDF" filter, and the open-PDF action: one rule,
 * three consumers. It lives under `src/sources/` so the host's filter-count
 * aggregates judge a source with exactly the predicate the browser renders
 * by — a second copy in the client would let the badge and the count
 * disagree. Only facts Zotero proved qualify. A ref whose type is unknown
 * is never promised to be a PDF, and a web-linked URL attachment is never
 * handed to the protocol handler (it silently ignores non-file attachments).
 * @module dsh-zotero/sources/source-capabilities
 */
import { type RefKind } from '../ref-grammar.js';
import type { SourceItem } from './model.js';
/** One identity parse of a Zotero ref embedded in text. */
export interface ParsedRefIdentity {
    readonly libraryType: 'user' | 'group';
    readonly libraryId: string;
    readonly kind: RefKind;
    readonly key: string;
}
/**
 * Clear the reference identity cache. Exported for test isolation.
 */
export declare function clearRefIdentityCacheForTesting(): void;
/**
 * Parse the identity of a Zotero ref embedded in text: library type and id,
 * object kind, and key. Unparseable input yields `null`, memoized like a
 * result — the caller treats both the same way.
 * @param ref - the ref text to parse.
 * @returns the identity, or null when the text is not a supported ref.
 */
export declare function parseRefIdentity(ref: string): ParsedRefIdentity | null;
/** The PDF capability of one source, or null when nothing answers the open-PDF action. */
export type PdfCapability = {
    readonly kind: 'file';
    /** The attachment ref to resolve into a local file path. */
    readonly ref: string;
    /** The local filesystem path when already resolved. */
    readonly filePath?: string;
} | {
    readonly kind: 'url';
    /** The web location of the linked URL PDF. */
    readonly url: string;
};
/**
 * The PDF capability of one source, or null when nothing answers the
 * open-PDF action. Candidates are tried in precedence order (the resolved
 * attachment location, Zotero's own attachment selection, then the
 * attachment a retrieve read), each needing an `application/pdf` fact; a
 * resolved web-linked URL attachment never qualifies for Zotero's reader
 * (the protocol handler silently ignores non-file attachments), but when it
 * is the only PDF fact its web location answers the action instead. A ref
 * whose type is unknown never yields a capability: an older session's
 * untyped hint is not promised to be a PDF. The final gate for file targets
 * is ref identity parseability, so an unparseable ref is no capability at all.
 * @param item - the source to probe.
 * @returns the capability, or null.
 */
export declare function pdfCapabilityOf(item: SourceItem): PdfCapability | null;
/** The item fact: some attachment of the source is (or is openable as) a PDF. */
export declare function hasPdf(item: SourceItem): boolean;
//# sourceMappingURL=source-capabilities.d.ts.map