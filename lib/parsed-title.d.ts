/**
 * The Markdown H1 naming a parsed document, shared by the host commit path
 * (stored into artifact meta) and the client tab title. Pure string handling
 * only: no host authority, no React.
 * @module dsh-zotero/parsed-title
 */
/** ATX headings outside fenced and indented code, with original UTF-16 offsets. */
export declare function markdownHeadingsOf(markdown: string): {
    level: number;
    title: string;
    start: number;
}[];
/** The first real Markdown H1, with emphasis and code spans stripped. */
export declare function extractMarkdownTitleOf(markdown: string): string | undefined;
/**
 * Zotero's default attachment names carry no paper identity; the stored
 * Markdown title is the better tab name for them.
 */
export declare function isGenericParsedTitle(value: string | undefined): boolean;
//# sourceMappingURL=parsed-title.d.ts.map