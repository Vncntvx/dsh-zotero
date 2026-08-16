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

/** The id the built-in local provider registers under; also the provider config default. */
export const LOCAL_PROVIDER_ID = 'local'

/** The sort fields `zotero_search` accepts, in Zotero's own vocabulary. */
export const ZOTERO_SORT_FIELDS: readonly ZoteroSortField[] = [
  'dateModified',
  'dateAdded',
  'date',
  'title',
  'creator',
] as const

/** `zotero_search` argument defaults; the tool and the corpus's pagination-fold identity share them. */
export const SEARCH_DEFAULT_MODE = 'metadata'
export const SEARCH_DEFAULT_SCOPE = { kind: 'library' } as const
export const SEARCH_DEFAULT_SORT = 'dateModified'
export const SEARCH_DEFAULT_DIRECTION = 'desc'
export const SEARCH_DEFAULT_OFFSET = 0
export const SEARCH_DEFAULT_LIMIT = 10
