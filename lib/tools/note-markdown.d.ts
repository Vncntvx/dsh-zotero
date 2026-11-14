/**
 * The model-facing description of the note `markdown` parameter.
 *
 * Both note tools take the same markdown, so they state the same support: the
 * create tool used to list a subset and then claim anything else is escaped,
 * which told the model that highlight, math and task lists were unsupported,
 * and the update tool carried one generic sentence. The list here matches what
 * `markdownToNoteHtml` actually renders.
 * @module dsh-zotero/tools/note-markdown
 */
/** What the note body supports; anything else is escaped as literal text. */
export declare const NOTE_MARKDOWN_PARAMETER_DESCRIPTION = "The note body in markdown: paragraphs, headings, **bold**, *italic*, `code`, fenced code, ==highlight==, $inline$ and $block$ math, > quotes, - and 1. lists (one level, incl. - [ ] tasks), pipe tables, [text](url) links. Anything else is escaped; raw HTML never passes.";
//# sourceMappingURL=note-markdown.d.ts.map