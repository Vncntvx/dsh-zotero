/**
 * Zotero's own search-text folding, mirrored for the plugin's own matching.
 *
 * Zotero 10 matches a search term against a normalized form of every field,
 * `Zotero.Utilities.Internal.normalizeForSearch` in
 * `chrome/content/zotero/xpcom/utilities_internal.js` (10.0.2-beta.9): NFKD
 * with combining marks stripped, lowercased, a small map for the letters NFKD
 * leaves whole, typographic quotes and dashes folded to their ASCII forms,
 * then NFC so kana and Hangul recombine. That is why a query typed `cafe`
 * finds `café` server-side, and why `children's` finds a curly apostrophe.
 *
 * The plugin matches text on its own in two places (BM25 passage ranking and
 * the client-side note scan), and both must fold the same way. Otherwise a
 * search that found a paper cannot rank that paper's passages, and a note the
 * search matched by fold is missed by the scan: the same query answers "this
 * paper is relevant" and "nothing in it is".
 *
 * Only the matching side is folded. Passage text, note text, and every other
 * string a tool returns stay verbatim: folding is an index, never a rewrite.
 * @module dsh-zotero/search-text
 */

/**
 * The letters NFKD does not decompose, mapped as Zotero maps them. Every
 * character {@link MAPPED_LETTERS} can match is a key here, which is why the
 * lookup asserts.
 */
const LETTER_MAP: Record<string, string> = {
  '\u00f8': 'o', // ø
  '\u0153': 'oe', // œ
  '\u00e6': 'ae', // æ
  '\u0142': 'l', // ł
  '\u0111': 'd', // đ
  '\u00f0': 'd', // ð
  '\u00fe': 'th', // þ
  '\u00df': 'ss', // ß
  '\u0131': 'i', // ı
  '\u2044': '/', // fraction slash
}

const MAPPED_LETTERS = /[\u00f8\u0153\u00e6\u0142\u0111\u00f0\u00fe\u00df\u0131\u2044]/g

/** The combining marks NFKD splits out of accented letters. */
const COMBINING_MARKS = /[\u0300-\u036f]/g

/** Typographic single quotes, primes included. */
const TYPOGRAPHIC_SINGLE = /[\u2018\u2019\u201a\u201b\u2032]/g
/** Typographic double quotes, double primes included. */
const TYPOGRAPHIC_DOUBLE = /[\u201c\u201d\u201e\u201f\u2033]/g
/** Every dash form, folded to the hyphen a search is typed with. */
const TYPOGRAPHIC_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g

/**
 * The rich-text formatting tags Zotero supports in item fields, stripped
 * before folding (its own whitelist, matched verbatim) so markup neither
 * breaks a phrase nor becomes a searchable token. Only this whitelist is
 * stripped; literal angle brackets in a value stay searchable.
 */
const FORMATTING_TAGS =
  /<\/?(?:i|b|sub|sup)>|<span (?:style="font-variant:small-caps;"|class="nocase")>|<\/span>/g

/** True when a text needs no folding beyond lowercase, i.e. it is pure ASCII. */
const NON_ASCII = /[^\u0000-\u007f]/

/**
 * The form a text is matched in: Zotero's `normalizeForSearch`, so the
 * plugin's own matching agrees with what the server's search already did.
 * @param text - the text to fold (a query, a passage, a note body).
 * @returns the folded form; the input is never modified.
 */
export function normalizeForSearch(text: string): string {
  const plain = text.includes('<') ? text.replace(FORMATTING_TAGS, '') : text
  // ASCII is its own fold: NFKD, the letter map, and the typographic folds
  // are all no-ops there, so the common case costs one lowercase pass.
  if (!NON_ASCII.test(plain)) return plain.toLowerCase()
  return plain
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(MAPPED_LETTERS, (letter) => LETTER_MAP[letter]!)
    .replace(TYPOGRAPHIC_SINGLE, "'")
    .replace(TYPOGRAPHIC_DOUBLE, '"')
    .replace(TYPOGRAPHIC_DASHES, '-')
    .normalize('NFC')
}
