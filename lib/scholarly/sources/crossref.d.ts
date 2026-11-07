/**
 * Crossref adapter querying api.crossref.org for official publisher metadata and retractions.
 * @module dsh-zotero/scholarly/sources/crossref
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyKeys, type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
export interface CrossrefWork {
    DOI?: string;
    title?: string[];
    author?: Array<{
        given?: string;
        family?: string;
        name?: string;
    }>;
    issued?: {
        'date-parts'?: Array<Array<number | null>>;
    };
    'published-print'?: {
        'date-parts'?: Array<Array<number | null>>;
    };
    'published-online'?: {
        'date-parts'?: Array<Array<number | null>>;
    };
    'container-title'?: string[];
    abstract?: string;
    type?: string;
    'is-referenced-by-count'?: number;
    URL?: string;
    'update-to'?: Array<{
        type?: string;
        DOI?: string;
    }>;
}
export declare function paperFromCrossref(work: CrossrefWork): ScholarlyPaper;
export declare function searchCrossref(query: ScholarlyQuery, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
export declare function lookupCrossref(doi: string, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper | undefined>;
export declare function crossrefMatchReference(referenceText: string, rows: number, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<CrossrefWork[]>;
//# sourceMappingURL=crossref.d.ts.map