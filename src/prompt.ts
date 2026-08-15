/**
 * The model-facing Zotero policy section: how the five tools compose
 * into a retrieval workflow, what the ref grammar guarantees, and
 * the honesty rules (provenance fails closed, no invented page locators).
 * Registered once in the tool-guidance band.
 * @module dsh-zotero/prompt
 */

import type { Context } from '@deepseek-ai/cordis'

export const ZOTERO_PROMPT_SECTION_NAME = 'zotero:policy'

/** Tool guidance sits in the 100–199 order band; 106 keeps it after the core tool sections. */
export const ZOTERO_PROMPT_SECTION_ORDER = 106

export const ZOTERO_PROMPT_SECTION_TEXT = [
  "Zotero (the user's local library):",
  '- zotero_search discovers papers by title/creator/year, or by indexed full text in everything mode; results carry stable refs of the form zotero://user/0/item/<KEY>, optionally qualified with ?server=<id>. Note bodies are matched client-side on the first page (library/collection scopes, capped by maxNoteScanRecords), and note titles are synthesized from their first line.',
  "- zotero_get reads one item's metadata; a note item returns its own body as noteBody (bounded, truncated flags the cut), and child notes carry parentRef — follow it to the parent item.",
  '- zotero_retrieve ranks evidence passages (annotations, notes, the abstract, full text) against a query; note evidence covers every chunk of long notes (chunkIndex/chunkCount locate each span), and unavailable sources (e.g. no PDF) are skipped into sourcesSkipped instead of failing. To read the rest of a long note, call zotero_get on the note ref for its full noteBody.',
  "- zotero_attachment resolves an item or attachment ref to the best attachment's verified on-disk path or a linked URL.",
  '- zotero_export produces per-ref citations, a joined bibliography, or bibtex/biblatex/ris/csljson output.',
  '- zotero_search limit and zotero_retrieve passages are capped by the configured maxima and error when exceeded; truncated and sourcesSkipped are honest flags, never silent edits.',
  "- Refs are provenance-checked against the running Zotero instance and fail closed on mismatch. Never invent page numbers for full-text passages: only annotations carry Zotero's own page labels.",
].join('\n')

/** Register the policy section; the registration unwinds with the plugin fiber. */
export function registerPromptSection(ctx: Context): void {
  ctx.systemPrompt.section({
    name: ZOTERO_PROMPT_SECTION_NAME,
    order: ZOTERO_PROMPT_SECTION_ORDER,
    text: ZOTERO_PROMPT_SECTION_TEXT,
  })
}
