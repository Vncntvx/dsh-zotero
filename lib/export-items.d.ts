/**
 * Per-document facts of a translator-format export, parsed from one entry of
 * the merged batch body. Parsing one entry is trivial and deterministic. The
 * batch body's entry order belongs to Zotero, so the provider locates
 * each ref's entry in memory (`export-mapping.ts`) and reads its key/title
 * here, never with a second HTTP request per document.
 * @module dsh-zotero/export-items
 */
import type { ZoteroExportFormat } from './types.js';
/** The parsed per-document facts of one single-item export. */
export interface ExportItemFacts {
    /**
     * The format-local identifier: the BibTeX/BibLaTeX citation key or the
     * CSL JSON id; absent when the format has none (RIS) or it cannot be
     * parsed.
     */
    readonly key?: string;
    /** The item's title for display, when the entry carries one. */
    readonly title?: string;
}
/**
 * The BibTeX/BibLaTeX entry-header key grammar, shared as a source string
 * because the two halves need different flags: the host parses one entry
 * with stateless `exec`, the client's exports lens scans a whole body with
 * `matchAll` (which requires `g`).
 */
export declare const BIBTEX_KEY_SOURCE = "@[A-Za-z]+\\{([^,\\s{}]+),";
/**
 * Extract the raw string value of a named field from a single BibTeX entry text,
 * brace-aware (nested `{{...}}` included), double-quoted, or bare numeric/token value.
 */
export declare function bibtexFieldOf(text: string, fieldName: string, allowBareToken?: boolean): string | undefined;
/**
 * Parse the per-document facts of one translator-format entry.
 * @param format - the requested translator format.
 * @param text - one entry of the batch export body.
 * @returns the parsed key/title facts; empty when the format is unsupported
 *   or the entry carries no usable facts.
 */
export declare function parseExportItem(format: ZoteroExportFormat, text: string): ExportItemFacts;
//# sourceMappingURL=export-items.d.ts.map