/**
 * PubMed adapter querying NCBI E-Utilities (esearch.fcgi and efetch.fcgi).
 * @module dsh-zotero/scholarly/sources/pubmed
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyKeys, type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
export declare function parsePubmedXml(xml: string): ScholarlyPaper[];
export declare function searchPubMed(query: ScholarlyQuery, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
//# sourceMappingURL=pubmed.d.ts.map