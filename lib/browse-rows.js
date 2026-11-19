/**
 * The `zotero_browse` row shapes, discriminated once for both halves.
 *
 * The valid browse output has seven row shapes: the model reads it through
 * `renderBrowse`, and the Chat card reads the same rows off the tool's
 * presentation projection. The classification order is the contract, because
 * which field identifies a row decides what every reader calls it, so it
 * lives here instead of being written twice. `tests/unit/browse-rows.spec.ts` pins
 * the order, and `renderBrowse` is built on this function rather than beside
 * it, so the two cannot drift.
 *
 * The reader is total and defensive in the same way the rest of the
 * presentation layer is: a row missing the field that identifies it still
 * yields an explicit unknown row with its complete JSON, without guessing its identity.
 * @module dsh-zotero/browse-rows
 */
import { asRecord, asString, asStringArray } from './json.js';
import { refFieldsOf } from './ref-grammar.js';
/**
 * The seven valid row kinds plus an explicit unknown kind for malformed input.
 * The two readers render every kind; unknown rows preserve their complete value.
 *
 * Two independent guards keep a new arm from shipping half-wired. The
 * `BROWSE_ROW_ARMS_COMPLETE` assertion below fails the build if an arm is added
 * to `BrowseRow` and not to this list, so `tests/unit/browse-rows.spec.ts`
 * (which walks one row per entry) cannot silently stop covering it. The two
 * exhaustive `switch`es over `BrowseRow` (`browseRowLines` in
 * `src/tools/browse.ts`, `browseRowView` in the Chat card) have no `default` arm,
 * so an arm with no renderer fails to build.
 */
export const BROWSE_ROW_ARMS = [
    'library',
    'collection',
    'savedSearch',
    'tag',
    'itemType',
    'field',
    'creatorType',
    'unknown',
];
/**
 * Browse listing kinds (`zotero_browse`'s `kind`), as a runtime list both
 * halves share. The type authority stays `ZoteroBrowseKind` in `types.ts`; the
 * `Exclude` pin below fails the build if this list falls behind it.
 */
export const BROWSE_KINDS = [
    'libraries',
    'collections',
    'savedSearches',
    'tags',
    'itemTypes',
    'itemFields',
];
const _browseKindsComplete = true;
void _browseKindsComplete;
/** Runtime membership test for a browse kind string. */
export function isBrowseKind(value) {
    return value !== undefined && BROWSE_KINDS.includes(value);
}
/**
 * Build-time proof that this list and the `BrowseRow` union agree. It has no
 * runtime effect; if another arm is added, the `never` no longer holds and the
 * file stops compiling, which is the moment to add it here.
 */
const BROWSE_ROW_ARMS_COMPLETE = true;
void BROWSE_ROW_ARMS_COMPLETE;
function countOf(value, key) {
    const raw = value[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}
/**
 * Classify one raw browse row. The order of the tests below *is* the contract:
 * a row carrying several candidate fields is named by the first that matches,
 * so `renderBrowse` and every card agree on what a row is.
 * @param value - one entry of the browse output's `items` array.
 * @returns the classified row; never null.
 */
export function browseRowOf(value) {
    const row = asRecord(value) ?? {};
    const localized = asString(row['localized']) ?? null;
    const ref = asString(row['ref']) ?? '';
    const library = asRecord(row['library']);
    if (library !== undefined) {
        const type = asString(library['type']) ?? '';
        const id = library['id'];
        const libraryId = `${type}/${typeof id === 'number' ? id : ''}`;
        return { kind: 'library', name: asString(row['name']) ?? libraryId, libraryId };
    }
    const path = asStringArray(row['path']);
    if (path !== undefined) {
        const depth = row['depth'];
        return {
            kind: 'collection',
            breadcrumb: path,
            ref,
            depth: typeof depth === 'number' && Number.isFinite(depth) ? depth : 0,
        };
    }
    const tag = asString(row['tag']);
    if (tag !== undefined)
        return { kind: 'tag', tag, count: countOf(row, 'count') };
    const itemType = asString(row['itemType']);
    if (itemType !== undefined)
        return { kind: 'itemType', itemType, localized };
    const field = asString(row['field']);
    if (field !== undefined)
        return { kind: 'field', field, localized };
    const creatorType = asString(row['creatorType']);
    if (creatorType !== undefined)
        return { kind: 'creatorType', creatorType, localized };
    const conditions = row['conditions'];
    if (!Array.isArray(conditions) && refFieldsOf(ref)?.kind !== 'search')
        return { kind: 'unknown', raw: JSON.stringify(value) ?? String(value) };
    const name = asString(row['name']) ?? (ref === '' ? JSON.stringify(value) : ref);
    return {
        kind: 'savedSearch',
        name,
        ref,
        conditionCount: Array.isArray(conditions) ? conditions.length : null,
    };
}
//# sourceMappingURL=browse-rows.js.map