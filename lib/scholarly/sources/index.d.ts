/**
 * Unified dispatch registry for all 7 scholarly source adapters.
 * @module dsh-zotero/scholarly/sources/index
 */
import type { ScholarlyHttp } from '../transport/http.js';
import type { ScholarlyKeys, ScholarlyPaper, ScholarlyQuery, ScholarlySourceId } from '../types.js';
export * from './arxiv.js';
export * from './crossref.js';
export * from './dblp.js';
export * from './helpers.js';
export * from './openalex.js';
export * from './pmc.js';
export * from './pubmed.js';
export * from './semanticscholar.js';
type SourceSearcher = (query: ScholarlyQuery, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal) => Promise<ScholarlyPaper[]>;
/** The searcher for one source id; the record is total over {@link ScholarlySourceId}. */
type SourceSearchers = Record<ScholarlySourceId, SourceSearcher>;
export declare const SOURCE_SEARCHERS: SourceSearchers;
//# sourceMappingURL=index.d.ts.map