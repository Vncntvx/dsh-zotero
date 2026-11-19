/**
 * BibTeX/BibLaTeX convenience helpers for the exports lens: citation-key
 * extraction and the `\cite{}` command. Extraction is best-effort: a body
 * the regex cannot parse leaves the artifact itself untouched, and only the
 * convenience button disappears.
 * @module dsh-zotero/sources/bibtex
 */
/** Extract the citation keys of a BibTeX/BibLaTeX export body, first-seen order. */
export declare function bibTexKeysOf(text: string): string[];
/** The LaTeX cite command for extracted keys; empty for none. */
export declare function citeCommandOf(keys: readonly string[]): string;
//# sourceMappingURL=bibtex.d.ts.map