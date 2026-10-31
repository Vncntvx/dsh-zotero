/**
 * Normalize Local API rows into compact search records and shared item facts.
 * @module dsh-zotero/normalize-search
 */
import { type NormalizeContext } from './normalize-context.js';
import type { ZoteroCreator, ZoteroSearchItem } from './types.js';
/** The publication year of a parsed date string (`YYYY-…`), or undefined. */
export declare function parsedYearOf(parsedDate: string | undefined): number | undefined;
export declare function normalizeSearchItem(json: unknown, context?: NormalizeContext): ZoteroSearchItem;
export declare function normalizeCreators(data: Record<string, unknown> | undefined): ZoteroCreator[];
export declare function citekeyOf(extra?: string): string | undefined;
export declare function normalizeVenue(data: Record<string, unknown> | undefined): string | undefined;
export declare function collectionKeysOf(json: unknown): string[];
//# sourceMappingURL=normalize-search.d.ts.map