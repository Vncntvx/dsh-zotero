/**
 * Semantic Scholar adapter querying api.semanticscholar.org Graph API.
 * Provides TLDRs, citation counts, and open-access PDF links.
 * @module dsh-zotero/scholarly/sources/semanticscholar
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyKeys, type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
interface S2Paper {
    paperId?: string;
    title?: string;
    year?: number;
    venue?: string;
    abstract?: string | null;
    publicationDate?: string | null;
    authors?: Array<{
        name?: string;
    }>;
    citationCount?: number;
    externalIds?: {
        DOI?: string;
        ArXiv?: string;
        PubMed?: string;
        PubMedCentral?: string;
    } | null;
    openAccessPdf?: {
        url?: string;
    } | null;
    tldr?: {
        text?: string;
    } | null;
}
export declare function paperFromS2(paper: S2Paper): ScholarlyPaper;
export declare function searchSemanticScholar(query: ScholarlyQuery, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
export declare function lookupSemanticScholar(id: string, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper | undefined>;
export {};
//# sourceMappingURL=semanticscholar.d.ts.map