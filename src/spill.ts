/**
 * Opportunistic spill storage helper for dsh-zotero.
 * Persists oversized scholarly full-text reads via `ctx.spillStore` without a
 * hard dependency on its backend. Export delivery does not go through here:
 * it rides `src/result-delivery.ts`.
 *
 * @module dsh-zotero/spill
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { SpillLocator, type SaveTextSpill, type SpillRef } from '@deepseek-ai/dsh-spill'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { formatSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'

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
export function exceedsInlineTokenBudget(text: string, maxInlineResultTokens: number): boolean {
  return estimateContent([{ type: 'text', text }]) > maxInlineResultTokens
}

/**
 * The persisted-spill notice for one result, in the harness spelling every
 * spill-aware consumer recognizes (`hasSpillNotice`).
 * @param ref - the saved text's locator and retrieval guidance; the locator
 *   may arrive as the plain string a wire projection carries.
 * @param omittedBytes - UTF-8 bytes of the result left out of this answer.
 * @returns the notice, prefixed with a blank line for appending.
 */
export function spilledNoticeOf(
  ref: { readonly locator: string; readonly retrievalHint: string },
  omittedBytes: number,
): string {
  return `\n\n${formatSpillNotice(
    { kind: 'exact', count: omittedBytes },
    { locator: SpillLocator(ref.locator), retrievalHint: ref.retrievalHint },
  )}`
}

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
export async function trySpillToolOutput(
  ctx: Context,
  exec: ToolExecution,
  suggestedName: string,
  content: string,
  ownerSessionId = exec.agent?.session.header.id,
): Promise<SpillRef | undefined> {
  if (ownerSessionId === undefined) {
    return undefined
  }
  const spillStore = ctx.get('spillStore')
  if (!spillStore) {
    return undefined
  }
  const save: SaveTextSpill = {
    owner: { sessionId: ownerSessionId },
    source: {
      kind: 'tool',
      toolName: exec.name,
      callId: exec.callId,
      label: 'result',
    },
    suggestedName,
    content,
  }
  try {
    return await spillStore.saveText(save)
  } catch (error: unknown) {
    ctx.logger?.warn?.(`spillStore: failed to save ${exec.name} output: ${String(error)}`)
    return undefined
  }
}
