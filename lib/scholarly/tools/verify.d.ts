/**
 * The `scholarly_verify` tool: checks reference lists against official registry records.
 * Catches fake DOIs, mismatched titles/authors/years, and retracted publications.
 * @module dsh-zotero/scholarly/tools/verify
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type ScholarlyToolHost } from './common.js';
export declare function parseReferenceSnippet(text: string): {
    doi?: string;
    year?: number;
    firstAuthor?: string;
};
export declare function createScholarlyVerifyTool(host: ScholarlyToolHost): ToolDefinition;
//# sourceMappingURL=verify.d.ts.map