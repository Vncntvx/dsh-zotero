/**
 * Barrel export creating all scholarly tools.
 * @module dsh-zotero/scholarly/tools/index
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type ScholarlyReadHost } from './read.js';
export * from './cite.js';
export * from './citations.js';
export * from './get.js';
export * from './read.js';
export * from './search.js';
export * from './verify.js';
export * from './save-to-zotero.js';
export declare function createAllScholarlyTools(host: ScholarlyReadHost): ToolDefinition[];
//# sourceMappingURL=index.d.ts.map