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
import { hasPdf } from './source-capabilities.js';
/**
 * Whether one source carries an issue: a failed or stopped call, or an
 * instance mismatch. A running call is in flight, not an issue.
 * @param item - the source to probe.
 * @returns true when the source belongs in the issues filter.
 */
export function hasIssue(item) {
    return (item.operations.failed > 0 || item.operations.stopped > 0 || item.evidenceMatch === 'mismatch');
}
/**
 * One predicate per filter id. Both the filter bar's counts and the filtered
 * listing read this table, so a new filter is added once or the pill count
 * and the listing disagree.
 */
const SOURCE_FILTER_PREDICATES = {
    pdf: (item) => hasPdf(item),
    retrieved: (item) => item.retrievalFacts !== undefined,
    evidence: (item) => item.evidence.length > 0,
    exported: (item) => item.exports.length > 0,
    issues: (item) => hasIssue(item),
};
/** One bit per aggregate-counted filter; the ledger folds these into running totals. */
export const SOURCE_FILTER_BITS = {
    pdf: 1,
    retrieved: 2,
    evidence: 4,
    exported: 8,
};
/** The mask bits and the aggregate counter each one feeds, in a stable order. */
export const SOURCE_FILTER_MASK_FIELDS = [
    [SOURCE_FILTER_BITS.pdf, 'pdf'],
    [SOURCE_FILTER_BITS.retrieved, 'retrieved'],
    [SOURCE_FILTER_BITS.evidence, 'evidence'],
    [SOURCE_FILTER_BITS.exported, 'exported'],
];
/**
 * The aggregate mask of one source: the same predicates the filter bar counts,
 * so a predicate change moves the listing and the running totals together.
 * @param item - the source to probe.
 * @returns the bit mask of the aggregate-counted filters it matches.
 */
export function sourceFilterMaskOf(item) {
    let mask = 0;
    if (SOURCE_FILTER_PREDICATES.pdf(item))
        mask |= SOURCE_FILTER_BITS.pdf;
    if (SOURCE_FILTER_PREDICATES.retrieved(item))
        mask |= SOURCE_FILTER_BITS.retrieved;
    if (SOURCE_FILTER_PREDICATES.evidence(item))
        mask |= SOURCE_FILTER_BITS.evidence;
    if (SOURCE_FILTER_PREDICATES.exported(item))
        mask |= SOURCE_FILTER_BITS.exported;
    return mask;
}
/** The filter ids in their bar order, derived from the predicate table. */
const FILTER_IDS = Object.keys(SOURCE_FILTER_PREDICATES);
/**
 * Narrow the sources to one filter. Callers pass whatever list they render —
 * the full union or the workspace's windowed view; the counts the filter bar
 * shows come from the workspace's aggregates, computed before the window.
 * @param sources - the sources to filter.
 * @param filter - the filter id.
 * @returns the matching sources, in the input order.
 */
export function filterSources(sources, filter) {
    if (filter === 'all')
        return sources;
    const predicate = SOURCE_FILTER_PREDICATES[filter];
    return predicate !== undefined ? sources.filter(predicate) : sources;
}
/** Count the sources matching each filter in one pass. */
export function filterCountsOf(sources) {
    const counts = { all: sources.length, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 };
    for (const item of sources) {
        for (const id of FILTER_IDS) {
            if (SOURCE_FILTER_PREDICATES[id](item))
                counts[id] += 1;
        }
    }
    return counts;
}
//# sourceMappingURL=filters.js.map