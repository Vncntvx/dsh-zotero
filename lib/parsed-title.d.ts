/**
 * The Markdown H1 naming a parsed document, shared by the host commit path
 * (stored into artifact meta) and the client tab title. Pure string handling
 * only: no host authority, no React.
 * @module dsh-zotero/parsed-title
 */
/** The first Markdown H1 of a document, with emphasis and code spans stripped. */
export declare function extractMarkdownTitleOf(markdown: string): string | undefined;
/**
 * Zotero's default attachment names carry no paper identity; the stored
 * Markdown title is the better tab name for them.
 */
export declare function isGenericParsedTitle(value: string | undefined): boolean;
//# sourceMappingURL=parsed-title.d.ts.map