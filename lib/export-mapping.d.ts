/**
 * Server-side ref → batch-entry mapping for translator exports. The merged
 * body's entry order belongs to Zotero, and citation keys are generated in
 * the export context, so the browser never guesses again: the provider
 * parses entries directly from the batch export body in memory, locating
 * each requested item by deterministic multi-tier fingerprinting (DOI,
 * normalized title, first author & year disambiguation, extra citekeys),
 * item key, or identifier. Positional guessing is never used.
 * @module dsh-zotero/export-mapping
 */
import type { ZoteroExportFormat, ZoteroObjectRef } from './types.js';
/** One located entry of a translator export body. */
export interface BatchEntry {
    /** The entry's key: BibTeX/BibLaTeX citation key, RIS record id, or CSL JSON id. */
    readonly key?: string;
    /** The entry's start offset within the body. */
    readonly start: number;
    /** The entry's end offset (exclusive) within the body. */
    readonly end: number;
    /** The entry's own text, trimmed. */
    readonly text: string;
}
/** The per-document item of one export call: the ref plus its located entry. */
export interface LocatedExportItem {
    readonly ref: string;
    /** The batch body's real key (BibTeX/BibLaTeX citation key, CSL JSON id). */
    readonly key?: string;
    /** The item's title for display, when the entry carried one. */
    readonly title?: string;
    /** The located entry's index within the parsed CSL JSON array. */
    readonly entryIndex?: number;
    /** The located entry's text span within the trimmed batch body (text formats). */
    readonly start?: number;
    readonly end?: number;
}
/**
 * Split a BibTeX/BibLaTeX body into its entries with their text spans. Each
 * entry's `text` runs from its `@type{` start to its own closing brace, so
 * trailing `%` comments or blank lines before the next entry never join the
 * body; each entry alone is what title parsing reads. The `end` offset
 * still tiles the body to the next entry's start (or the body end) for UI
 * span highlighting. The scan is progressive and brace-aware: every entry's
 * body is skipped to its closing brace before the next start is searched, so
 * an `@type{key,` shape inside a field value, a quoted string, or a comment
 * never starts a new entry.
 * @param text - the export body (offsets are relative to this string).
 * @returns the entries in body order.
 */
export declare function splitBibtexEntries(text: string): BatchEntry[];
/**
 * Split an RIS body into its records with their text spans. Each record
 * runs from the previous terminator (the body start for the first) to the
 * start of the next record, its `ER` terminator line and any blank lines
 * after it included. Every record's own text is a complete RIS record, and
 * the slices tile the body exactly. A trailing record without a
 * terminator runs to the body end.
 * @param text - the export body (offsets are relative to this string).
 * @returns the records in body order.
 */
export declare function splitRisRecords(text: string): BatchEntry[];
/** Normalize title for deterministic cross-format matching. */
export declare function normalizeTitleForAlignment(title: string | undefined): string | undefined;
/** Normalize DOI for exact matching, stripping prefixes and query forms. */
export declare function normalizeDoiForAlignment(doi: string | undefined): string | undefined;
/** Normalize author name to primary surname for disambiguation. */
export declare function normalizeAuthorForAlignment(author: string | undefined): string | undefined;
/** Normalize date or year field to a 4-digit year string. */
export declare function normalizeYearForAlignment(dateOrYear: string | undefined): string | undefined;
/**
 * Locate items directly from the batch export body in memory without
 * secondary per-document HTTP calls.
 */
export declare function locateExportItemsFromBatch(format: ZoteroExportFormat, text: string, refs: readonly ZoteroObjectRef[], rawItems?: readonly unknown[]): LocatedExportItem[];
//# sourceMappingURL=export-mapping.d.ts.map