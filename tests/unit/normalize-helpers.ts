/**
 * The helpers the `normalize`-family unit specs share.
 *
 * The normalize specs are split along the source modules
 * (`normalize-item-detail.spec.ts`, `normalize-search-item.spec.ts`,
 * `normalize-children.spec.ts`, `normalize-scope.spec.ts`), so a helper two of
 * them use cannot live inside either one. Anything only one spec uses stays in
 * that spec.
 * @module tests/unit/normalize-helpers
 */

import { expect } from 'vitest'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../../src/errors.js'
import type { NormalizeContext } from '../../src/normalize.js'

/** Personal-library context with an optional server provenance qualifier. */
export function ctx(serverId?: string): NormalizeContext {
  return { library: { type: 'user', id: 0 }, ...(serverId !== undefined ? { serverId } : {}) }
}

/**
 * Assert that `fn` fails loud with `ZOTERO_UNEXPECTED` and hand the error back
 * so the caller can assert on it further (its code, its message).
 */
export function expectUnexpected(fn: () => unknown): ZoteroError {
  let thrown: unknown
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ZoteroError)
  expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
  return thrown as ZoteroError
}
