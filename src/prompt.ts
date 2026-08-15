/**
 * The model-facing Zotero policy section: how the five tools compose
 * into a retrieval workflow, what the ref grammar guarantees, and
 * the honesty rules (provenance fails closed, no invented page locators).
 * The section text is a provider evaluated at every assembly, so the tool
 * cap values it states always track the live config — the model never has
 * to guess a limit the plugin will reject.
 * Registered once in the tool-guidance band.
 * @module dsh-zotero/prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.js'

export const ZOTERO_PROMPT_SECTION_NAME = 'zotero:policy'

/** Tool guidance sits in the 100–199 order band; 106 keeps it after the core tool sections. */
export const ZOTERO_PROMPT_SECTION_ORDER = 106

/**
 * The policy body with the configured tool caps interpolated — the values
 * the model must stay within, so out-of-range guesses fail before they hit
 * the validation step.
 * @param config - the resolved config snapshot to state.
 * @returns the section text for one assembly.
 */
export function zoteroPromptTextOf(
  config: Pick<ResolvedConfig, 'maxSearchResults' | 'maxEvidencePassages' | 'maxExportRefs'>,
): string {
  return [
    "Zotero (the user's local library):",
    '- zotero_search discovers papers by title/creator/year, or by indexed full text in everything mode; results carry stable refs of the form zotero://user/0/item/<KEY>, optionally qualified with ?server=<id>. Note bodies are matched client-side on the first page (library/collection scopes, capped by maxNoteScanRecords), and note titles are synthesized from their first line.',
    "- zotero_get reads one item's metadata; a note item returns its own body as noteBody (bounded, truncated flags the cut), and child notes carry parentRef — follow it to the parent item.",
    '- zotero_retrieve ranks evidence passages (annotations, notes, the abstract, full text) against a query; note evidence covers every chunk of long notes (chunkIndex/chunkCount locate each span), and unavailable sources (e.g. no PDF) are skipped into sourcesSkipped instead of failing. To read the rest of a long note, call zotero_get on the note ref for its full noteBody.',
    "- zotero_attachment resolves an item or attachment ref to the best attachment's verified on-disk path or a linked URL.",
    '- zotero_export produces per-ref citations, a joined bibliography, or bibtex/biblatex/ris/csljson output.',
    `- Tool caps (set in the Zotero settings): zotero_search limit up to ${config.maxSearchResults}, zotero_retrieve passages up to ${config.maxEvidencePassages}, and zotero_export refs up to ${config.maxExportRefs}. Exceeding a cap errors, so choose limits within these bounds. truncated and sourcesSkipped are honest flags, never silent edits.`,
    "- Refs are provenance-checked against the running Zotero instance and fail closed on mismatch. Never invent page numbers for full-text passages: only annotations carry Zotero's own page labels.",
    '- Use the Zotero tools only when the user explicitly asks about their local library; never probe, browse, or test Zotero on your own.',
    "- On connectivity failures (Zotero not running, local API disabled, unsupported API version, timeout), the plugin asks you how to proceed with a recommended action; follow the user's choice and do not retry repeatedly.",
  ].join('\n')
}

/**
 * Register the policy section; the registration unwinds with the plugin
 * fiber. The text provider re-reads the live config at each assembly, so
 * settings edits are reflected without re-registration.
 * @param ctx - the plugin context.
 * @param config - the live resolved config getter.
 */
export function registerPromptSection(ctx: Context, config: () => ResolvedConfig): void {
  ctx.systemPrompt.section({
    name: ZOTERO_PROMPT_SECTION_NAME,
    order: ZOTERO_PROMPT_SECTION_ORDER,
    text: () => zoteroPromptTextOf(config()),
  })
}
