/**
 * Runtime constants of the Zotero domain. Kept out of `types.ts` so that
 * module stays types-only. `ZOTERO_SORT_FIELDS` is typed against the
 * `ZoteroSortField` union in `types.ts`, so the two cannot drift — the
 * typecheck rejects a field absent from the union and a union member absent
 * from the array; `tests/refs.spec.ts` additionally pins the exact array
 * because the search tool's `sort` enum derives from it.
 * @module dsh-zotero/constants
 */

import type { ZoteroSortField } from './types.js'

/** The sort fields `zotero_search` accepts, in Zotero's own vocabulary. */
export const ZOTERO_SORT_FIELDS: readonly ZoteroSortField[] = [
  'dateModified',
  'dateAdded',
  'date',
  'title',
  'creator',
] as const
