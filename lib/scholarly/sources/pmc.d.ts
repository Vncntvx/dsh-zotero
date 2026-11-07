/**
 * Europe PMC adapter querying www.ebi.ac.uk for biomedical literature and PMC JATS XML.
 * @module dsh-zotero/scholarly/sources/pmc
 */
import type { ScholarlyHttp } from '../transport/http.js';
import { type ScholarlyKeys, type ScholarlyPaper, type ScholarlyQuery } from '../types.js';
interface EpmcResult {
    id?: string;
    source?: string;
    pmid?: string;
    pmcid?: string;
    doi?: string;
    title?: string;
    authorString?: string;
    pubYear?: string;
    firstPublicationDate?: string;
    abstractText?: string;
    citedByCount?: number;
    isOpenAccess?: string;
    pubType?: string;
    journalInfo?: {
        journal?: {
            title?: string;
        };
    };
    bookOrReportDetails?: {
        publisher?: string;
    };
    fullTextUrlList?: {
        fullTextUrl?: Array<{
            documentStyle?: string;
            availabilityCode?: string;
            url?: string;
        }>;
    };
}
export declare function paperFromEpmc(result: EpmcResult): ScholarlyPaper;
export declare function searchEuropePmc(query: ScholarlyQuery, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper[]>;
export declare function lookupEuropePmc(id: {
    doi?: string;
    pmid?: string;
    pmcid?: string;
}, http: ScholarlyHttp, keys?: ScholarlyKeys, signal?: AbortSignal): Promise<ScholarlyPaper | undefined>;
export declare function fetchPmcFullTextXml(pmcid: string, http: ScholarlyHttp, signal?: AbortSignal): Promise<string | undefined>;
export {};
//# sourceMappingURL=pmc.d.ts.map