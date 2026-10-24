/**
 * Types and canonical interfaces for the scholarly literature subsystem.
 * @module dsh-zotero/scholarly/types
 */
export declare const SCHOLARLY_SOURCE_IDS: readonly ["arxiv", "openalex", "crossref", "semanticscholar", "pubmed", "europepmc", "dblp"];
export type ScholarlySourceId = (typeof SCHOLARLY_SOURCE_IDS)[number];
export declare const SCHOLARLY_SOURCE_NAMES: Record<ScholarlySourceId, string>;
export interface InLibraryInfo {
    itemKey: string;
    libraryId: string;
    collections: string[];
}
export interface ScholarlyPaper {
    title: string;
    authors: string[];
    year?: number;
    /** ISO date string if known by the index. */
    date?: string;
    venue?: string;
    abstract?: string;
    /** One-sentence summary from Semantic Scholar. */
    tldr?: string;
    type?: string;
    doi?: string;
    arxiv?: string;
    pmid?: string;
    pmcid?: string;
    openalex?: string;
    s2?: string;
    url?: string;
    /** Lawful open-access copy URL. */
    pdfUrl?: string;
    citations?: number;
    openAccess?: boolean;
    retracted?: boolean;
    sources: string[];
    inLibrary?: InLibraryInfo;
}
export interface ScholarlyQuery {
    query: string;
    sources?: ScholarlySourceId[];
    limit: number;
    yearFrom?: number;
    yearTo?: number;
    openAccess?: boolean;
    sort: 'relevance' | 'date' | 'citations';
    /** arXiv categories (e.g. cs.LG, cs.CL, stat.ML). */
    categories?: string[];
}
export interface ScholarlyKeys {
    email?: string;
    s2Key?: string;
    openalexKey?: string;
    ncbiKey?: string;
}
//# sourceMappingURL=types.d.ts.map