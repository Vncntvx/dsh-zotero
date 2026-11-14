/**
 * The `scholarly_read` tool: reads open-access full text of papers (arXiv, PMC, OA PDF).
 * Provides section outlines, section extraction, and natural-language passage matching.
 * @module dsh-zotero/scholarly/tools/read
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ScholarlyTextStore } from '../fulltext/store.js';
import { type ScholarlyToolHost } from './common.js';
export interface ScholarlyReadHost extends ScholarlyToolHost {
    cache?: ScholarlyTextStore;
    maxContentChars?(): number;
}
/**
 * The message an empty query match returns. It states what the call found and
 * refuses the stronger claim: a reader told "no relevant passage" reasonably
 * concludes the paper is silent on the subject, which this call cannot know.
 * The meaning clause appears only when the semantic route actually ran —
 * claiming a comparison the call never made would be its own falsehood.
 * @param query - the query that matched nothing.
 * @param routes - the routes that ran; `semantic` present means meaning was scored.
 * @returns the model-facing explanation.
 */
export declare function noPassageMessage(query: string, routes: readonly ('lexical' | 'semantic')[]): string;
export declare const PLAIN_TEXT_OUTLINE_MESSAGE = "This copy contains plain text extracted from a PDF and has no section headings. Read in chunks or search with query.";
export declare const MARKDOWN_OUTLINE_MESSAGE = "This Markdown copy has no section headings. Read in chunks or search with query.";
export declare const NO_SECTION_HEADINGS_MESSAGE = "This copy has no section headings; read in chunks or use query.";
export declare function createScholarlyReadTool(host: ScholarlyReadHost, options?: {
    readonly background?: boolean;
}): ToolDefinition;
//# sourceMappingURL=read.d.ts.map