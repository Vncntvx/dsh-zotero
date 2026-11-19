/**
 * Opportunistic spill storage helper for dsh-zotero.
 * Persists oversized scholarly full-text reads via `ctx.spillStore` without a
 * hard dependency on its backend. Export delivery does not go through here:
 * it rides `src/result-delivery.ts`.
 *
 * @module dsh-zotero/spill
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import { type SpillRef } from '@deepseek-ai/dsh-spill';
/**
 * Whether one complete result outgrows the inline token budget.
 *
 * The same `estimateContent` the result delivery prices results with, and
 * the same budget it compares against: a caller deciding whether a document
 * is worth spilling asks the delivery's own question, so "fits inline" means
 * one thing across the plugin and a settings edit moves every threshold.
 * @param text - the complete result's text.
 * @param maxInlineResultTokens - the live inline token budget.
 * @returns true when the text would not ride inline.
 */
export declare function exceedsInlineTokenBudget(text: string, maxInlineResultTokens: number): boolean;
/**
 * The persisted-spill notice for one result, in the harness spelling every
 * spill-aware consumer recognizes (`hasSpillNotice`).
 * @param ref - the saved text's locator and retrieval guidance; the locator
 *   may arrive as the plain string a wire projection carries.
 * @param omittedBytes - UTF-8 bytes of the result left out of this answer.
 * @returns the notice, prefixed with a blank line for appending.
 */
export declare function spilledNoticeOf(ref: {
    readonly locator: string;
    readonly retrievalHint: string;
}, omittedBytes: number): string;
/**
 * Opportunistically spills a large tool result to `ctx.spillStore`.
 * If `ctx.spillStore` is not loaded, the call has no session owner,
 * or saving fails, it returns `undefined` gracefully so the tool can
 * fall back to inline output without erroring.
 *
 * @param ctx - the plugin context.
 * @param exec - tool execution context.
 * @param suggestedName - file name hint for the backend (e.g. `export-bibtex.bib`).
 * @param content - complete text to persist.
 * @param ownerSessionId - the session that owns the spill; defaults to the
 *   execution's own session.
 */
export declare function trySpillToolOutput(ctx: Context, exec: ToolExecution, suggestedName: string, content: string, ownerSessionId?: import("@deepseek-ai/dsh-session").SessionId | undefined): Promise<SpillRef | undefined>;
//# sourceMappingURL=spill.d.ts.map