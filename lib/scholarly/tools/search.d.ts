/**
 * The `scholarly_search` tool: multi-source literature retrieval across 6 academic indexes.
 * Supports intelligent routing, weighted RRF fusion, collision check against Zotero, and background promotion.
 * @module dsh-zotero/scholarly/tools/search
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type ScholarlyToolHost } from './common.js';
export declare function createScholarlySearchTool(host: ScholarlyToolHost): ToolDefinition;
//# sourceMappingURL=search.d.ts.map