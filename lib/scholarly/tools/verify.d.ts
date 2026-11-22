/**
 * The `scholarly_verify` tool: checks reference lists against official registry records.
 * Catches fake DOIs, mismatched titles/authors/years, and retracted publications.
 *
 * An entry may be a full bibliographic reference or a bare DOI. A DOI-only
 * entry establishes identifier resolution and retraction state; its title,
 * author, and year fields are reported as `not-compared`.
 * @module dsh-zotero/scholarly/tools/verify
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type ScholarlyToolHost } from './common.js';
/** Whether the entry was just an identifier or carried bibliographic text. */
type ReferenceInputKind = 'doi' | 'reference';
interface ParsedReference {
    inputKind: ReferenceInputKind;
    doi?: string;
    year?: number;
    leadingName?: string;
    nameTokens: string[];
    /** The leading span is followed by a comma: the surname-first citation form. */
    surnamesFirst: boolean;
    /** The input with the DOI stripped: the text title/year/author checks read. */
    remainder: string;
}
/**
 * Parse one submitted entry as either a bare DOI or a bibliographic reference.
 *
 * The DOI is removed before year and author parsing: a DOI suffix can contain
 * a year-shaped number, and a doi.org URL would otherwise be read as an author
 * named "https".
 */
export declare function parseReferenceSnippet(text: string): ParsedReference;
export declare function createScholarlyVerifyTool(host: ScholarlyToolHost, options?: {
    readonly background?: boolean;
}): ToolDefinition;
export {};
//# sourceMappingURL=verify.d.ts.map