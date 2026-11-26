/**
 * BibTeX/BibLaTeX convenience helpers for the exports lens: citation-key
 * extraction and the `\cite{}` command. Extraction is best-effort: a body
 * the regex cannot parse leaves the artifact itself untouched, and only the
 * convenience button disappears.
 * @module dsh-zotero/sources/bibtex
 */
import { BIBTEX_KEY_SOURCE } from '../export-items.js';
const BIBTEX_KEY = new RegExp(BIBTEX_KEY_SOURCE, 'g');
/** Extract the citation keys of a BibTeX/BibLaTeX export body, first-seen order. */
export function bibTexKeysOf(text) {
    const keys = [];
    const seen = new Set();
    for (const match of text.matchAll(BIBTEX_KEY)) {
        // The key source pins exactly one required capture group, so a
        // successful match always carries group 1; indexing is safe.
        const key = match[1];
        if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
        }
    }
    return keys;
}
/** The LaTeX cite command for extracted keys; empty for none. */
export function citeCommandOf(keys) {
    return keys.length === 0 ? '' : `\\cite{${keys.join(', ')}}`;
}
//# sourceMappingURL=bibtex.js.map