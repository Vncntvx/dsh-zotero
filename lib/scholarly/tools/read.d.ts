/**
 * The `scholarly_read` tool: reads open-access full text of papers (arXiv, PMC, OA PDF).
 * Provides section outlines, section extraction, and natural-language BM25 passage matching.
 * @module dsh-zotero/scholarly/tools/read
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ScholarlyTextStore } from '../fulltext/store.js';
import { type ScholarlyToolHost } from './common.js';
export interface ScholarlyReadHost extends ScholarlyToolHost {
    cache?: ScholarlyTextStore;
    maxContentChars?(): number;
}
export declare function createScholarlyReadTool(host: ScholarlyReadHost): ToolDefinition;
//# sourceMappingURL=read.d.ts.map