/**
 * The source filters, the per-filter counts, and the predicates behind both.
 * Filters narrow the stable union; they never replace it, so clearing a
 * filter restores every source. The table lives under `src/sources/` so the
 * host's workspace aggregates count sources with exactly the predicates the
 * browser's filter bar renders by — a second copy in the client would let
 * the pill count and the listing disagree. The "with PDF" filter shares its
 * single source of truth with the PDF badge and the open-PDF action
 * (`hasPdf`), and "issues" spans every non-running irregularity, so what the
 * bar names is what it shows.
 * @module dsh-zotero/sources/filters
 */
import type { SourceItem } from './model.js';
/** The sources filters; every filter is a subset of the stable union. */
export type SourceFilter = 'all' | 'pdf' | 'retrieved' | 'evidence' | 'exported' | 'issues';
/**
 * Whether one source carries an issue: a failed or stopped call, or an
 * instance mismatch. A running call is in flight, not an issue.
 * @param item - the source to probe.
 * @returns true when the source belongs in the issues filter.
 */
export declare function hasIssue(item: SourceItem): boolean;
/** One bit per aggregate-counted filter; the ledger folds these into running totals. */
export declare const SOURCE_FILTER_BITS: {
    readonly pdf: 1;
    readonly retrieved: 2;
    readonly evidence: 4;
    readonly exported: 8;
};
/** The mask bits and the aggregate counter each one feeds, in a stable order. */
export declare const SOURCE_FILTER_MASK_FIELDS: readonly [readonly [1, 'pdf'], readonly [2, 'retrieved'], readonly [4, 'evidence'], readonly [8, 'exported']];
/**
 * The aggregate mask of one source: the same predicates the filter bar counts,
 * so a predicate change moves the listing and the running totals together.
 * @param item - the source to probe.
 * @returns the bit mask of the aggregate-counted filters it matches.
 */
export declare function sourceFilterMaskOf(item: SourceItem): number;
/**
 * Narrow the sources to one filter. Callers pass whatever list they render —
 * the full union or the workspace's windowed view; the counts the filter bar
 * shows come from the workspace's aggregates, computed before the window.
 * @param sources - the sources to filter.
 * @param filter - the filter id.
 * @returns the matching sources, in the input order.
 */
export declare function filterSources(sources: readonly SourceItem[], filter: SourceFilter): readonly SourceItem[];
/** The per-filter item counts the filter bar displays; a zero count disables its filter. */
export interface SourceFilterCounts {
    readonly all: number;
    readonly pdf: number;
    readonly retrieved: number;
    readonly evidence: number;
    readonly exported: number;
    readonly issues: number;
}
/** Count the sources matching each filter in one pass. */
export declare function filterCountsOf(sources: readonly SourceItem[]): SourceFilterCounts;
//# sourceMappingURL=filters.d.ts.map