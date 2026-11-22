/**
 * Session-authorized, revision-fenced pages over the core's complete source
 * ledger.
 *
 * The projection's wire view is windowed (a long session must not grow the
 * emission), so the browser reaches the rows behind that window through this
 * module: the fold is read at one synchronous Session cut, the requested list
 * is cut into a bounded page, and the continuation is the next offset bound to
 * that session, list, instance and the revision the page was read at.
 * @module dsh-zotero/source-page
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroSourcePageRequestView, ZoteroSourcePageResultView } from './contract.js';
/**
 * Read one bounded page of the authorized session's complete literature trail.
 *
 * The page is cut from the full fold, never from the projection's windowed
 * view, so a filtered list or a long source is not truncated at the window.
 * Authorization is checked before the fold and again after it, and the
 * continuation is bound to the session, target, instance, revision and page
 * size, so a cursor cannot be replayed against another list or a moved
 * revision.
 * @param ctx - the host context.
 * @param input - the requested page.
 * @param signal - caller cancellation.
 * @returns the bounded page with its exact totals.
 */
export declare function readSourcePage(ctx: Context, input: ZoteroSourcePageRequestView, signal: AbortSignal): Promise<ZoteroSourcePageResultView>;
//# sourceMappingURL=source-page.d.ts.map