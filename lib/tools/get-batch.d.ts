/** The `zotero_get_batch` tool: bounded metadata reads with isolated failures. */
import type { Context } from '@deepseek-ai/cordis';
import { type ToolWrapper } from '../result-delivery.js';
import type { ZoteroService } from '../service.js';
export declare function registerGetBatchTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): void;
//# sourceMappingURL=get-batch.d.ts.map