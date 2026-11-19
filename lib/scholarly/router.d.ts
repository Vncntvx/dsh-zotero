/**
 * Query routing: which indexes a search should ask.
 *
 * The keyword tables below are **phrase-level**, not word-level. The earlier
 * version matched bare `graph`, `vision`, `attention`, `cell`, and `drug`,
 * which sent "attention economy", "vision of the firm", and "graph of social
 * relations" to arXiv and DBLP — a routing decision no configuration could
 * override, made on a word that is ordinary English everywhere else.
 *
 * The rule: a term enters these tables only when it is a domain phrase that
 * does not read as general language, and `attention` qualifies only with its
 * technical neighbor. Anything genuinely ambiguous falls through to the broad
 * default, which asks the general indexes instead of guessing.
 *
 * @module dsh-zotero/scholarly/router
 */
import { type ScholarlySourceId } from './types.js';
/**
 * Determines which scholarly sources to search.
 * @param query - the user's query text.
 * @param explicitSources - a caller's explicit list, which wins when non-empty.
 * @returns the source ids to ask, never empty.
 */
export declare function routeQuery(query: string, explicitSources?: readonly string[]): ScholarlySourceId[];
//# sourceMappingURL=router.d.ts.map