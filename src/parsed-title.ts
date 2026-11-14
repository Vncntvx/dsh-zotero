/**
 * The Markdown H1 naming a parsed document, shared by the host commit path
 * (stored into artifact meta) and the client tab title. Pure string handling
 * only: no host authority, no React.
 * @module dsh-zotero/parsed-title
 */

/** The first Markdown H1 of a document, with emphasis and code spans stripped. */
export function extractMarkdownTitleOf(markdown: string): string | undefined {
  const match = markdown.match(/^\s*#\s+(.+)$/m)
  if (!match) return undefined
  return match[1]!
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

/**
 * Zotero's default attachment names carry no paper identity; the stored
 * Markdown title is the better tab name for them.
 */
export function isGenericParsedTitle(value: string | undefined): boolean {
  return value === undefined || value === '' || value === 'PDF' || value === 'Full Text PDF'
}
