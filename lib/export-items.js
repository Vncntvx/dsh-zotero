/**
 * Per-document facts of a translator-format export, parsed from one entry of
 * the merged batch body. Parsing one entry is trivial and deterministic. The
 * batch body's entry order belongs to Zotero, so the provider locates
 * each ref's entry in memory (`export-mapping.ts`) and reads its key/title
 * here, never with a second HTTP request per document.
 * @module dsh-zotero/export-items
 */
/**
 * The BibTeX/BibLaTeX entry-header key grammar, shared as a source string
 * because the two halves need different flags: the host parses one entry
 * with stateless `exec`, the client's exports lens scans a whole body with
 * `matchAll` (which requires `g`).
 */
export const BIBTEX_KEY_SOURCE = '@[A-Za-z]+\\{([^,\\s{}]+),';
const BIBTEX_KEY = new RegExp(BIBTEX_KEY_SOURCE);
const KNOWN_FIELD_PATTERNS = {
    title: /\btitle\s*=\s*/i,
    doi: /\bdoi\s*=\s*/i,
    year: /\byear\s*=\s*/i,
    date: /\bdate\s*=\s*/i,
    author: /\bauthor\s*=\s*/i,
};
/**
 * Extract the raw string value of a named field from a single BibTeX entry text,
 * brace-aware (nested `{{...}}` included), double-quoted, or bare numeric/token value.
 */
export function bibtexFieldOf(text, fieldName, allowBareToken = true) {
    const pattern = KNOWN_FIELD_PATTERNS[fieldName] ?? new RegExp(`\\b${fieldName}\\s*=\\s*`, 'i');
    const field = pattern.exec(text);
    if (field === null)
        return undefined;
    let cursor = field.index + field[0].length;
    while (cursor < text.length && /\s/.test(text[cursor]))
        cursor += 1;
    const opener = text[cursor];
    if (opener === '{') {
        let depth = 0;
        const start = cursor + 1;
        for (; cursor < text.length; cursor += 1) {
            if (text[cursor] === '{')
                depth += 1;
            else if (text[cursor] === '}') {
                depth -= 1;
                if (depth === 0)
                    return text.slice(start, cursor);
            }
        }
        return undefined;
    }
    if (opener === '"') {
        const end = text.indexOf('"', cursor + 1);
        return end === -1 ? undefined : text.slice(cursor + 1, end);
    }
    if (!allowBareToken)
        return undefined;
    // Bare numbers or tokens (e.g. year = 2024,)
    let end = cursor;
    while (end < text.length && !/[,\s{}]/.test(text[end]))
        end += 1;
    return end === cursor ? undefined : text.slice(cursor, end);
}
/**
 * The display title of one BibTeX entry: the field value after `title =`,
 * brace-aware (nested `{{…}}` included) or double-quoted. It is display-only,
 * since export pairing never reads it, so an unparseable value yields
 * undefined instead of failing the call.
 */
function bibtexTitleOf(text) {
    return bibtexFieldOf(text, 'title', false);
}
const RIS_TITLE = /^TI  - (.+?)\r?$/m;
/** The BibTeX/BibLaTeX facts: the citation key plus the first title field. */
function bibtexFactsOf(text) {
    const key = BIBTEX_KEY.exec(text)?.[1];
    const title = bibtexTitleOf(text);
    return {
        ...(key === undefined ? {} : { key }),
        ...(title === undefined ? {} : { title }),
    };
}
/** The RIS facts: records carry no citation key, only the title line. */
function risFactsOf(text) {
    const title = RIS_TITLE.exec(text)?.[1];
    return title === undefined ? {} : { title };
}
/** The CSL JSON facts: the export is an array of one record, `id`/`title`. */
function csljsonFactsOf(text) {
    let records;
    try {
        records = JSON.parse(text);
    }
    catch {
        return {};
    }
    if (!Array.isArray(records) || records.length === 0)
        return {};
    const first = records[0];
    if (typeof first !== 'object' || first === null || Array.isArray(first))
        return {};
    const record = first;
    const key = typeof record['id'] === 'string' ? record['id'] : undefined;
    const title = typeof record['title'] === 'string' ? record['title'] : undefined;
    return {
        ...(key === undefined ? {} : { key }),
        ...(title === undefined ? {} : { title }),
    };
}
/**
 * Parse the per-document facts of one translator-format entry.
 * @param format - the requested translator format.
 * @param text - one entry of the batch export body.
 * @returns the parsed key/title facts; empty when the format is unsupported
 *   or the entry carries no usable facts.
 */
export function parseExportItem(format, text) {
    if (format === 'bibtex' || format === 'biblatex')
        return bibtexFactsOf(text);
    if (format === 'ris')
        return risFactsOf(text);
    if (format === 'csljson')
        return csljsonFactsOf(text);
    return {};
}
//# sourceMappingURL=export-items.js.map