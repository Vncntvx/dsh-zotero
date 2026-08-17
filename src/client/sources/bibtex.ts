/**
 * BibTeX/BibLaTeX convenience helpers for the exports lens: citation-key
 * extraction and the `\cite{}` command. Extraction is best-effort — a body
 * the regex cannot parse leaves the artifact itself untouched, only the
 * convenience button disappears.
 * @module dsh-zotero/client/sources/bibtex
 */

/** Extract the citation keys of a BibTeX/BibLaTeX export body, first-seen order. */
export function bibTexKeysOf(text: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/@[A-Za-z]+\{([^,\s{}]+),/g)) {
    const key = match[1]!
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

/** The LaTeX cite command for extracted keys; empty for none. */
export function citeCommandOf(keys: readonly string[]): string {
  return keys.length === 0 ? '' : `\\cite{${keys.join(', ')}}`
}
