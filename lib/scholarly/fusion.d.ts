/**
 * Weighted Reciprocal Rank Fusion (RRF) and post-ranking blending for scholarly literature.
 * @module dsh-zotero/scholarly/fusion
 */
import { type ScholarlyPaper, type ScholarlyQuery, type ScholarlySourceId } from './types.js';
export interface RankedSourceList {
    sourceId: ScholarlySourceId | string;
    weight?: number;
    papers: readonly ScholarlyPaper[];
}
/**
 * Merges multiple ranked lists from heterogeneous scholarly indexes into a single deduplicated ranking.
 *
 * Identity decides merges; titles only find candidates. A title candidate must
 * share its token set, first author, and a year within one with the candidate
 * entry, with compatible strong identifiers.
 */
export declare function fuseRankedLists(lists: readonly RankedSourceList[]): ScholarlyPaper[];
/**
 * Post-processes fused papers: title exact-match pinning, future-year sanitizing, date/citation sorting.
 */
export declare function postProcessRanked(papers: ScholarlyPaper[], query: ScholarlyQuery, currentYear?: number): ScholarlyPaper[];
interface IdentifierFields {
    arxiv?: string;
    doi?: string;
    pmid?: string;
    pmcid?: string;
    openalex?: string;
    s2?: string;
    url?: string;
    title: string;
}
export declare function bestIdentifierOf(paper: IdentifierFields): string;
export declare function formatAuthorSummary(authors: readonly string[], max?: number): string;
export declare function formatPaperItem(paper: ScholarlyPaper, index: number, abstractChars?: number): string;
export declare function formatPaperDetail(paper: ScholarlyPaper): string;
export {};
//# sourceMappingURL=fusion.d.ts.map