/**
 * The `zotero_browse` row shapes, discriminated once for both halves.
 *
 * The browse output is a seven-arm union: the model reads it through
 * `renderBrowse`, and the Chat card reads the same rows off the tool's
 * presentation projection. The classification order is the contract, because
 * which field identifies a row decides what every reader calls it, so it
 * lives here instead of being written twice. `tests/unit/browse-rows.spec.ts` pins
 * the order, and `renderBrowse` is built on this function rather than beside
 * it, so the two cannot drift.
 *
 * The reader is total and defensive in the same way the rest of the
 * presentation layer is: a row missing the field that identifies it still
 * yields a classified row with safe fallbacks, never a throw and never a
 * guessed identity.
 * @module dsh-zotero/browse-rows
 */
import type { ZoteroBrowseKind } from './types.js';
/**
 * The seven arms a browse row can land in, in the order the tool's output
 * schema enumerates them. That is *not* the order `browseRowOf` tests them,
 * since the saved-search arm is that function's fallback and is tried last.
 *
 * Two independent guards keep a new arm from shipping half-wired. The
 * `BROWSE_ROW_ARMS_COMPLETE` assertion below fails the build if an arm is added
 * to `BrowseRow` and not to this list, so `tests/unit/browse-rows.spec.ts`
 * (which walks one row per entry) cannot silently stop covering it. The two
 * exhaustive `switch`es over `BrowseRow` (`browseRowLines` in
 * `src/tools/browse.ts`, `browseRowView` in the Chat card) have no `default` arm,
 * so an arm with no renderer fails to build.
 */
export declare const BROWSE_ROW_ARMS: readonly ["library", "collection", "savedSearch", "tag", "itemType", "field", "creatorType"];
/**
 * Browse listing kinds (`zotero_browse`'s `kind`), as a runtime list both
 * halves share. The type authority stays `ZoteroBrowseKind` in `types.ts`; the
 * `Exclude` pin below fails the build if this list falls behind it.
 */
export declare const BROWSE_KINDS: readonly ["libraries", "collections", "savedSearches", "tags", "itemTypes", "itemFields"];
/** Runtime membership test for a browse kind string. */
export declare function isBrowseKind(value: string | undefined): value is ZoteroBrowseKind;
/** One classified browse row. Which arm a row lands in says which field identified it. */
export type BrowseRow = {
    readonly kind: 'library';
    /** The library's display name; falls back to its own identity when unnamed. */
    readonly name: string;
    /** The canonical `type/id` spelling every library ref is built from. */
    readonly libraryId: string;
} | {
    readonly kind: 'collection';
    /** The full breadcrumb, root first: the useful line, not just the leaf name. */
    readonly breadcrumb: readonly string[];
    readonly ref: string;
    /** Nesting depth below the top level; 0 for a root collection. */
    readonly depth: number;
} | {
    readonly kind: 'savedSearch';
    readonly name: string;
    readonly ref: string;
    /** How many conditions the saved search carries, when the row reports them. */
    readonly conditionCount: number | null;
} | {
    readonly kind: 'tag';
    readonly tag: string;
    /** Items carrying the tag, when the listing was scoped to a count. */
    readonly count: number | null;
} | {
    readonly kind: 'itemType';
    readonly itemType: string;
    readonly localized: string | null;
} | {
    readonly kind: 'field';
    readonly field: string;
    readonly localized: string | null;
} | {
    readonly kind: 'creatorType';
    readonly creatorType: string;
    readonly localized: string | null;
};
/**
 * Classify one raw browse row. The order of the tests below *is* the contract:
 * a row carrying several candidate fields is named by the first that matches,
 * so `renderBrowse` and every card agree on what a row is.
 * @param value - one entry of the browse output's `items` array.
 * @returns the classified row; never null.
 */
export declare function browseRowOf(value: unknown): BrowseRow;
//# sourceMappingURL=browse-rows.d.ts.map