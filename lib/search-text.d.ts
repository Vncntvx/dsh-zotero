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
 * The form a text is matched in: Zotero's `normalizeForSearch`, so the
 * plugin's own matching agrees with what the server's search already did.
 * @param text - the text to fold (a query, a passage, a note body).
 * @returns the folded form; the input is never modified.
 */
export declare function normalizeForSearch(text: string): string;
//# sourceMappingURL=search-text.d.ts.map