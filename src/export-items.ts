/**
 * The BibTeX/BibLaTeX entry field grammar, shared by the host's entry
 * fingerprinting (`export-mapping.ts`) and the client's exports lens.
 *
 * This module is the one home of the shared *source* string: the two halves
 * need different flags for the same key grammar, so the grammar travels as a
 * string and each side compiles its own `RegExp`. Field extraction lives beside
 * it because the host reads titles, DOIs, years, and authors out of one entry
 * with it. RIS and CSL JSON entries are parsed by the locators in
 * `export-mapping.ts`, which are their only readers; this module holds no
 * per-format parser.
 * @module dsh-zotero/export-items
 */

/**
 * The BibTeX/BibLaTeX entry-header key grammar, shared as a source string
 * because the two halves need different flags: the host parses one entry
 * with stateless `exec`, the client's exports lens scans a whole body with
 * `matchAll` (which requires `g`).
 */
export const BIBTEX_KEY_SOURCE = '@[A-Za-z]+\\{([^,\\s{}]+),'

const KNOWN_FIELD_PATTERNS: Readonly<Record<string, RegExp>> = {
  title: /\btitle\s*=\s*/i,
  doi: /\bdoi\s*=\s*/i,
  year: /\byear\s*=\s*/i,
  date: /\bdate\s*=\s*/i,
  author: /\bauthor\s*=\s*/i,
}

/**
 * Extract the raw string value of a named field from a single BibTeX entry text,
 * brace-aware (nested `{{...}}` included), double-quoted, or bare numeric/token value.
 * @param text - one BibTeX/BibLaTeX entry body.
 * @param fieldName - the field to read; unknown names fall back to a generic pattern.
 * @param allowBareToken - whether a bare `year = 2024` value counts, or only braced and quoted ones.
 * @returns the raw field value, or undefined when the entry has no such usable field.
 */
export function bibtexFieldOf(
  text: string,
  fieldName: string,
  allowBareToken = true,
): string | undefined {
  const pattern = KNOWN_FIELD_PATTERNS[fieldName] ?? new RegExp(`\\b${fieldName}\\s*=\\s*`, 'i')
  const field = pattern.exec(text)
  if (field === null) return undefined
  let cursor = field.index + field[0].length
  while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1
  const opener = text[cursor]
  if (opener === '{') {
    let depth = 0
    const start = cursor + 1
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1
      else if (text[cursor] === '}') {
        depth -= 1
        if (depth === 0) return text.slice(start, cursor)
      }
    }
    return undefined
  }
  if (opener === '"') {
    const end = text.indexOf('"', cursor + 1)
    return end === -1 ? undefined : text.slice(cursor + 1, end)
  }
  if (!allowBareToken) return undefined
  // Bare numbers or tokens (e.g. year = 2024,)
  return scanBibtexToken(text, cursor)
}

/**
 * Scan a bare BibTeX token (e.g. key, number, or bare value) up to comma, brace, or whitespace.
 */
export function scanBibtexToken(text: string, from: number): string | undefined {
  let end = from
  while (end < text.length && !/[,\s{}]/.test(text[end]!)) end += 1
  return end === from ? undefined : text.slice(from, end)
}
