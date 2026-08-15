/**
 * The model-facing Zotero policy section: how the research memory tools
 * compose into a retrieval workflow, what the ref grammar guarantees, and
 * the honesty rules (provenance fails closed, no invented page locators).
 * Registered once in the tool-guidance band.
 * @module dsh-zotero/prompt
 */

import type { Context } from '@deepseek-ai/cordis'

export const ZOTERO_PROMPT_SECTION_NAME = 'zotero:policy'

/** Tool guidance sits in the 100–199 order band; 106 keeps it after the core tool sections. */
export const ZOTERO_PROMPT_SECTION_ORDER = 106

export const ZOTERO_PROMPT_SECTION_TEXT = [
  'Zotero research memory (the user\'s local library):',
  '- zotero_search discovers papers by title/creator/year, or by indexed full text in everything mode; results carry stable refs of the form zotero://user/0/item/<KEY>, optionally qualified with ?server=<id>.',
  '- zotero_get reads one item\'s metadata; include notes/annotations/attachments only when child content matters.',
  '- zotero_retrieve ranks evidence passages (annotations, notes, the abstract, full text) against a query; the truncated flag signals omitted passages.',
  '- zotero_attachment resolves an attachment to a verified on-disk path or a linked URL.',
  '- zotero_export produces per-ref citations, a joined bibliography, or bibtex/biblatex/ris/csljson output.',
  '- Refs are provenance-checked against the running Zotero instance and fail closed on mismatch. Never invent page numbers for full-text passages: only annotations carry Zotero\'s own page labels.',
].join('\n')

/** Register the policy section; the registration unwinds with the plugin fiber. */
export function registerPromptSection(ctx: Context): void {
  ctx.systemPrompt.section({
    name: ZOTERO_PROMPT_SECTION_NAME,
    order: ZOTERO_PROMPT_SECTION_ORDER,
    text: ZOTERO_PROMPT_SECTION_TEXT,
  })
}
