/**
 * Unified dispatch registry for all 7 scholarly source adapters.
 * @module dsh-zotero/scholarly/sources/index
 */

import type { ScholarlyHttp } from '../transport/http.js'
import type { ScholarlyKeys, ScholarlyPaper, ScholarlyQuery, ScholarlySourceId } from '../types.js'
import { searchArxiv } from './arxiv.js'
import { searchCrossref } from './crossref.js'
import { searchDblp } from './dblp.js'
import { searchOpenAlex } from './openalex.js'
import { searchEuropePmc } from './pmc.js'
import { searchPubMed } from './pubmed.js'
import { searchSemanticScholar } from './semanticscholar.js'

type SourceSearcher = (
  query: ScholarlyQuery,
  http: ScholarlyHttp,
  keys?: ScholarlyKeys,
  signal?: AbortSignal,
) => Promise<ScholarlyPaper[]>

/** The searcher for one source id; the record is total over {@link ScholarlySourceId}. */
type SourceSearchers = Record<ScholarlySourceId, SourceSearcher>

export const SOURCE_SEARCHERS: SourceSearchers = {
  arxiv: (q, http, _k, s) => searchArxiv(q, http, s),
  openalex: (q, http, k, s) => searchOpenAlex(q, http, k, s),
  crossref: (q, http, k, s) => searchCrossref(q, http, k, s),
  semanticscholar: (q, http, k, s) => searchSemanticScholar(q, http, k, s),
  pubmed: (q, http, k, s) => searchPubMed(q, http, k, s),
  europepmc: (q, http, k, s) => searchEuropePmc(q, http, k, s),
  dblp: (q, http, _k, s) => searchDblp(q, http, s),
}
