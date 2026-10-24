/**
 * Research notes travel to Zotero as HTML: the note field is HTML, Zotero
 * performs no format conversion on writes, and markdown text stored verbatim
 * renders as raw markup (the failure mode community integrations hit). The
 * plugin therefore converts the model's markdown itself, under a restricted
 * grammar with one absolute rule: anything the grammar does not recognize is
 * HTML-escaped and shown as literal text. There is no raw-HTML passthrough,
 * no attribute inventing, and no scheme outside `https://`, `http://` and
 * `zotero://` can become a link, so a hostile or merely confused model
 * output degrades to visible text, never to markup.
 *
 * The grammar (documented for users in `docs/tools.md`):
 * - paragraphs: blank-line separated; soft-wrapped lines join with spaces;
 * - headings: ATX `#`–`####`; five or more hashes stay literal text;
 * - emphasis: `**bold**` and `*italic*`; `_underscore_` stays literal so
 *   identifiers like `max_export_refs` survive research notes;
 * - highlights: `==highlight==` mapped to `<mark>`;
 * - math: `$$` blocks mapped to `<math-display>` and `$math$` spans mapped to
 *   `<math-inline>` for native Zotero 7+ KaTeX rendering;
 * - code: `` `spans` `` and ``` fenced blocks; no formatting inside;
 * - links: `[text](url)` with `https://`, `http://` or `zotero://` URLs;
 *   other schemes render as literal text;
 * - lists: `-`/`*` bullets and `1.`/`1)` numbers, one nesting level;
 *   task list items `- [ ]` / `- [x]` map to `<ul class="task-list">` with
 *   `<li class="task-list-item"><input type="checkbox" ... />`;
 * - quotes: `>` lines, one paragraph per block;
 * - tables: pipe tables with a `---` separator row; without one, the lines
 *   stay literal paragraph text;
 * - rules: `---` / `***` on their own line.
 *
 * The output is the block sequence only: Zotero wraps saved notes in its own
 * schema-versioned envelope, so this module never emits one.
 * @module dsh-zotero/note-format
 */
/**
 * Convert research-note markdown to the HTML a Zotero note stores. Unknown
 * syntax never becomes markup: it is escaped and shown as written.
 */
export declare function markdownToNoteHtml(markdown: string): string;
//# sourceMappingURL=note-format.d.ts.map