/**
 * OpenAlex adapter querying api.openalex.org for global scholarly graph metadata.
 * @module dsh-zotero/scholarly/sources/openalex
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyKeys, type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
interface OpenAlexWork {
    id?: string;
    doi?: string | null;
    display_name?: string | null;
    publication_year?: number;
    publication_date?: string;
    type?: string;
    authorships?: Array<{
        author?: {
            display_name?: string;
        };
    }>;
    primary_location?: {
        source?: {
            display_name?: string;
        } | null;
        landing_page_url?: string | null;
    } | null;
    best_oa_location?: {
        pdf_url?: string | null;
        landing_page_url?: string | null;
    } | null;
    open_access?: {
        is_oa?: boolean;
        oa_url?: string | null;
    };
    cited_by_count?: number;
    is_retracted?: boolean;
    abstract_inverted_index?: Record<string, number[]> | null;
    ids?: {
        pmid?: string;
        pmcid?: string;
    };
}
export declare function reconstructInvertedAbstract(index: Record<string, number[]> | null | undefined): string | undefined;
export declare function paperFromOpenAlex(work: OpenAlexWork): ScholarlyPaper;
export declare function searchOpenAlex(query: ScholarlyQuery, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
export declare function lookupOpenAlex(id: string, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper | undefined>;
export declare function openalexLinkedWorks(openalexId: string, relation: 'cites' | 'cited_by' | 'related_to', limit: number, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<{
    papers: ScholarlyPaper[];
    total?: number;
}>;
export {};
//# sourceMappingURL=openalex.d.ts.map