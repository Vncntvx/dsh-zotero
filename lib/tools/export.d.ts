/**
 * The `zotero_export` tool: turn item refs into citations or formatted
 * exports. Citation mode pairs every requested ref with Zotero's own HTML
 * citation, ordered as requested; bibliography mode yields the joined
 * CSL-sorted bibliography. BibTeX, BibLaTeX, RIS and CSV pass Zotero's batch
 * body through; CSL JSON combines the requested items' translator records.
 * Per-item entries carry their refs and export keys where available.
 * Export output is never mid-truncated:
 * it either fits the provider's character limit or fails with a typed error.
 * @module dsh-zotero/tools/export
 */
import { type ToolWrapper } from '../result-delivery.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from '../service.js';
/** The model-facing message for an empty refs list. */
export declare const EXPORT_REFS_EMPTY_MESSAGE = "refs must list at least one zotero:// item ref";
export { exportRefsOverCapMessage } from '../export-limits.js';
/** The model-facing messages for a blank style or locale argument. */
export declare const EXPORT_STYLE_BLANK_MESSAGE = "style must be a non-empty CSL style id when provided";
export declare const EXPORT_LOCALE_BLANK_MESSAGE = "locale must be a non-empty CSL locale when provided";
/**
 * Register `zotero_export` for the plugin lifetime. Each call checks the
 * current background policy and job registry.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 * @param wrap - the delivery envelope.
 */
export declare function registerExportTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): () => void;
//# sourceMappingURL=export.d.ts.map