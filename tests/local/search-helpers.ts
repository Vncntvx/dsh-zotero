/**
 * The fixtures the two `zotero_search` specs share: the library's collection
 * listing, its saved-search listing, and the second-provider constructor.
 *
 * The scan spec's own note fixtures stay in that spec, because the note bodies
 * are what its tests read; these three are what both files would otherwise
 * declare twice, in shapes that could drift apart. `COLLECTIONS` is the exact
 * listing the scope resolution reads (a name that matches twice must stay
 * ambiguous for the spec that proves it), so it is one value, not one per file.
 * @module tests/local/search-helpers
 */

import type { LocalApiLimits } from '../../src/local/limits.js'
import type { LocalApiProvider } from '../../src/local/provider.js'
import type { MockZotero } from '../helpers/mock-zotero.js'
import { createProvider } from '../helpers/provider-harness.js'
import { collectionRow, savedSearchRow } from '../helpers/server/objects.js'

/**
 * The collections listing: the canonical collection, a second name that folds
 * to the same letters as the first (`Llm Papers` vs `LLM Papers`), and a third
 * that shares no prefix with either.
 */
export const COLLECTIONS = [
  collectionRow(),
  collectionRow({ key: 'COLL5678', data: { name: 'Llm Papers' } }),
  collectionRow({ key: 'COLL9012', data: { name: 'Reasoning' } }),
]

/** The saved-search listing: the canonical `Unread Papers`. */
export const SEARCHES = [savedSearchRow()]

/**
 * A provider over a spec's own mock server, with optional limit overrides.
 *
 * The mock is a parameter rather than module state: each spec boots its own
 * server per test, so a helper closing over one module-level `mock` would bind
 * the server of whichever spec imported it first.
 * @param mock - the mock server this provider talks to.
 * @param limits - the limits to override on top of the harness defaults.
 * @returns the provider.
 */
export function makeProvider(
  mock: MockZotero,
  limits: Partial<LocalApiLimits> = {},
): LocalApiProvider {
  return createProvider(mock, limits)
}
