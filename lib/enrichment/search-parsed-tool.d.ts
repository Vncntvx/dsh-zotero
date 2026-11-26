/** Search committed MinerU Markdown through the enrichment index. */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolWrapper } from '../result-delivery.js';
import type { ParsedIndex } from './parsed-index.js';
export declare function registerParsedSearchTool(ctx: Context, search: (request: Parameters<ParsedIndex['search']>[1], signal: AbortSignal) => ReturnType<ParsedIndex['search']>, wrap: ToolWrapper): void;
//# sourceMappingURL=search-parsed-tool.d.ts.map