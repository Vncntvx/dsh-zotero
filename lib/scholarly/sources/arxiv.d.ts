/**
 * arXiv adapter querying the Atom API at export.arxiv.org/api/query.
 * @module dsh-zotero/scholarly/sources/arxiv
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
export declare function extractArxivId(input: string): string | undefined;
interface ArxivAtomEntry {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    published: string;
    doi?: string;
    journalRef?: string;
    categories: string[];
}
export declare function parseArxivAtom(xml: string): ArxivAtomEntry[];
export declare function paperFromArxiv(entry: ArxivAtomEntry): ScholarlyPaper;
export declare function buildArxivSearchQuery(query: ScholarlyQuery, anyWord?: boolean): string;
export declare function searchArxiv(query: ScholarlyQuery, http: ScholarlyHttp, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
export declare function lookupArxiv(arxivId: string, http: ScholarlyHttp, signal?: AbortSignal): Promise<ScholarlyPaper | undefined>;
export {};
//# sourceMappingURL=arxiv.d.ts.map