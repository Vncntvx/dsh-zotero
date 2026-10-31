/**
 * The `zotero_export` tool: turn item refs into citations or formatted
 * exports. Citation mode pairs every requested ref with Zotero's own HTML
 * citation, ordered as requested; bibliography mode yields the joined
 * CSL-sorted bibliography; bibtex/biblatex/ris/csljson pass the translator
 * output through verbatim and itemize each exported document (its citation
 * key and title) paired with its ref. Export output is never mid-truncated:
 * it either fits the provider's character limit or fails with a typed error.
 * @module dsh-zotero/tools/export
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from '../service.js';
/** The model-facing message for an empty refs list. */
export declare const EXPORT_REFS_EMPTY_MESSAGE = "refs must list at least one zotero:// item ref";
export { exportRefsOverCapMessage } from '../export-limits.js';
/** The model-facing messages for a blank style or locale argument. */
export declare const EXPORT_STYLE_BLANK_MESSAGE = "style must be a non-empty CSL style id when provided";
export declare const EXPORT_LOCALE_BLANK_MESSAGE = "locale must be a non-empty CSL locale when provided";
/**
 * Register the `zotero_export` tool once, statically: the
 * `run_in_background` parameter is always declared, and a background request
 * the composition cannot serve (the flag off, or no jobs service mounted) is
 * refused from execute with a structured error instead of the parameter being
 * hidden from the schema. The service's live config is read per request so a
 * settings edit takes effect on the next call without re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export declare function registerExportTool(ctx: Context, service: ZoteroService): () => void;
//# sourceMappingURL=export.d.ts.map