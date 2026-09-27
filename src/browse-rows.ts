/**
 * The `zotero_browse` row shapes, discriminated once for both halves.
 *
 * The browse output is a seven-arm union: the model reads it through
 * `renderBrowse`, and the Chat card reads the same rows off the tool's
 * presentation projection. The classification order is the contract — which
 * field identifies a row decides what every reader calls it — so it lives
 * here instead of being written twice. `tests/unit/browse-rows.spec.ts` pins
 * the order, and `renderBrowse` is built on this function rather than beside
 * it, so the two cannot drift.
 *
 * The reader is total and defensive in the same way the rest of the
 * presentation layer is: a row missing the field that identifies it still
 * yields a classified row with safe fallbacks, never a throw and never a
 * guessed identity.
 * @module dsh-zotero/browse-rows
 */

import { asRecord, asString, asStringArray } from './json.js'
import type { ZoteroBrowseKind } from './types.js'

/**
 * The seven arms a browse row can land in, in the order the tool's output schema
 * enumerates them — which is *not* the order `browseRowOf` tests them, since
 * the saved-search arm is that function's fallback and is tried last.
 *
 * Two independent guards keep a new arm from shipping half-wired. The
 * `BROWSE_ROW_ARMS_COMPLETE` assertion below fails the build if an arm is added
 * to `BrowseRow` and not to this list, so `tests/unit/browse-rows.spec.ts` — which
 * walks one row per entry — cannot silently stop covering it. And the two
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
] as const

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
] as const

type MissingBrowseKind = Exclude<ZoteroBrowseKind, (typeof BROWSE_KINDS)[number]>
const _browseKindsComplete: MissingBrowseKind extends never ? true : never = true
void _browseKindsComplete

/** Runtime membership test for a browse kind string. */
export function isBrowseKind(value: string | undefined): value is ZoteroBrowseKind {
  return value !== undefined && (BROWSE_KINDS as readonly string[]).includes(value)
}

/**
 * Build-time proof that this list and the `BrowseRow` union agree. It has no
 * runtime effect; if an eighth arm is added, the `never` no longer holds and the
 * file stops compiling, which is the moment to add it here.
 */
const BROWSE_ROW_ARMS_COMPLETE: Exclude<
  BrowseRowKind,
  (typeof BROWSE_ROW_ARMS)[number]
> extends never
  ? true
  : never = true
void BROWSE_ROW_ARMS_COMPLETE

/** One classified browse row. Which arm a row lands in says which field identified it. */
export type BrowseRow =
  | {
      readonly kind: 'library'
      /** The library's display name; falls back to its own identity when unnamed. */
      readonly name: string
      /** The canonical `type/id` spelling every library ref is built from. */
      readonly libraryId: string
    }
  | {
      readonly kind: 'collection'
      /** The full breadcrumb, root first — the useful line, not just the leaf name. */
      readonly breadcrumb: readonly string[]
      readonly ref: string
      /** Nesting depth below the top level; 0 for a root collection. */
      readonly depth: number
    }
  | {
      readonly kind: 'savedSearch'
      readonly name: string
      readonly ref: string
      /** How many conditions the saved search carries, when the row reports them. */
      readonly conditionCount: number | null
    }
  | {
      readonly kind: 'tag'
      readonly tag: string
      /** Items carrying the tag, when the listing was scoped to a count. */
      readonly count: number | null
    }
  | {
      readonly kind: 'itemType'
      readonly itemType: string
      readonly localized: string | null
    }
  | {
      readonly kind: 'field'
      readonly field: string
      readonly localized: string | null
    }
  | {
      readonly kind: 'creatorType'
      readonly creatorType: string
      readonly localized: string | null
    }

/** The seven arms, as a union of their discriminants. */
type BrowseRowKind = BrowseRow['kind']

function countOf(value: Record<string, unknown>, key: string): number | null {
  const raw = value[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/**
 * Classify one raw browse row. The order of the tests below *is* the contract:
 * a row carrying several candidate fields is named by the first that matches,
 * so `renderBrowse` and every card agree on what a row is.
 * @param value - one entry of the browse output's `items` array.
 * @returns the classified row; never null.
 */
export function browseRowOf(value: unknown): BrowseRow {
  const row = asRecord(value) ?? {}
  const localized = asString(row['localized']) ?? null
  const ref = asString(row['ref']) ?? ''
  const library = asRecord(row['library'])
  if (library !== undefined) {
    const type = asString(library['type']) ?? ''
    const id = library['id']
    const libraryId = `${type}/${typeof id === 'number' ? id : ''}`
    return { kind: 'library', name: asString(row['name']) ?? libraryId, libraryId }
  }

  const path = asStringArray(row['path'])
  if (path !== undefined) {
    const depth = row['depth']
    return {
      kind: 'collection',
      breadcrumb: path,
      ref,
      depth: typeof depth === 'number' && Number.isFinite(depth) ? depth : 0,
    }
  }

  const tag = asString(row['tag'])
  if (tag !== undefined) return { kind: 'tag', tag, count: countOf(row, 'count') }

  const itemType = asString(row['itemType'])
  if (itemType !== undefined) return { kind: 'itemType', itemType, localized }

  const field = asString(row['field'])
  if (field !== undefined) return { kind: 'field', field, localized }

  const creatorType = asString(row['creatorType'])
  if (creatorType !== undefined) return { kind: 'creatorType', creatorType, localized }

  // The schema's remaining arm, and the only one with no field of its own: a
  // saved search is identified by carrying a name and a ref. A row that names
  // neither still renders — as its own JSON, so nothing is silently dropped.
  // The original value is stringified, not the normalized record: a non-record
  // input has no fields to lose, and echoing back `{}` would discard the very
  // thing the reader needed to see.
  const name = asString(row['name']) ?? (ref === '' ? JSON.stringify(value) : ref)
  const conditions = row['conditions']
  return {
    kind: 'savedSearch',
    name,
    ref,
    conditionCount: Array.isArray(conditions) ? conditions.length : null,
  }
}
