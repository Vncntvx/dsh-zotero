/**
 * The three saved-search write tools: create, update, and delete one saved
 * search through the write seam. The plan-review cards and the verdict
 * presentation are shared with the other write tools; this module owns only
 * the saved-search arguments and their validation.
 * @module dsh-zotero/tools/saved-search
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from '../service.js';
export declare function registerSavedSearchTools(ctx: Context, service: ZoteroService): Array<() => void>;
//# sourceMappingURL=saved-search.d.ts.map