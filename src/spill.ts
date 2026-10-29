/**
 * Opportunistic spill storage helper for dsh-zotero.
 * Persists oversized text outputs (export documents, full-text reading)
 * via `ctx.spillStore` without hard dependency on its backend.
 *
 * @module dsh-zotero/spill
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'

/** Default threshold (character count) above which tool outputs are considered oversized. */
export const DEFAULT_SPILL_CHAR_THRESHOLD = 16_000

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
 */
export async function trySpillToolOutput(
  ctx: Context,
  exec: ToolExecution,
  suggestedName: string,
  content: string,
  ownerSessionId = exec.agent?.session.header.id,
): Promise<SpillRef | undefined> {
  const sessionId = ownerSessionId
  if (sessionId === undefined) {
    return undefined
  }
  const spillStore = ctx.get('spillStore')
  if (!spillStore) {
    return undefined
  }
  const save: SaveTextSpill = {
    owner: { sessionId },
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
