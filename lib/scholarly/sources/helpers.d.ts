/**
 * Shared string and metadata sanitizers for scholarly source adapters.
 * @module dsh-zotero/scholarly/sources/helpers
 */
import type { ScholarlyPaper } from '../types.js';
/**
 * Await a promise and convert HTTP 404 Not Found into `undefined`.
 * Any other HTTP status or network failure is rethrown.
 */
export declare function ignoreNotFound<T>(promise: Promise<T>): Promise<T | undefined>;
/**
 * Papers that carry a non-empty title. Every adapter drops the rest from its
 * result lists; the one spelling keeps the drop rule from drifting between
 * them.
 * @param papers - the mapped results of one source response.
 * @returns the papers with a non-empty title.
 */
export declare function titled(papers: ScholarlyPaper[]): ScholarlyPaper[];
/**
 * Combine a base search query with additional filter clauses.
 * When multiple clauses exist, parenthesizes the base query and joins with AND.
 */
export declare function combineSearchClauses(baseQuery: string, additionalClauses: string[]): string;
export declare function decodeEntities(text: string): string;
export declare function cleanDoi(value: unknown): string | undefined;
export declare function plain(value: unknown): string;
/**
 * Pull the text out of a parsed XML node: either the string itself, or the
 * `#text` member when the parser split it into attributes.
 * @param value - the parsed node or primitive value.
 * @returns cleaned plain string.
 */
export declare function xmlTextVal(value: unknown): string;
export declare function parseYear(value: unknown): number | undefined;
/**
 * Drop the fields an index did not supply.
 *
 * A record with `title: ''` is not a record with a title. Adapters filter on
 * `(title ?? '') !== ''`, so an empty string must leave the field absent rather
 * than present-and-empty. `Object.entries` erases the per-key type, so the
 * result is rebuilt through a typed accumulator instead of a blanket cast.
 * @param raw - the candidate record.
 * @returns the same record without absent or empty fields.
 */
export declare function stripEmptyFields(raw: Partial<ScholarlyPaper>): ScholarlyPaper;
export declare function encodeQueryParams(params: Record<string, string | number | boolean | undefined>): string;
//# sourceMappingURL=helpers.d.ts.map