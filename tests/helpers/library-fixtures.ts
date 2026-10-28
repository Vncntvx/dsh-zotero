/**
 * Minimal legal domain records for the library panel's host endpoints. A
 * fixture a test did not override is complete for its type, so no spec needs
 * `as any` to hand a partial object to a spy.
 * @module tests/library-fixtures
 */

import type { ZoteroBrowseResult, ZoteroItemDetail, ZoteroSearchResult } from '../../src/types.js'
import { itemRef } from './server/keys.js'

/** A `collections` browse page with no rows; override any field per test. */
export function browseResult(overrides: Partial<ZoteroBrowseResult> = {}): ZoteroBrowseResult {
  return {
    kind: 'collections',
    items: [],
    total: 0,
    offset: 0,
    returned: 0,
    ...overrides,
  }
}

/** An unfiltered library search page; override any field per test. */
export function searchResult(overrides: Partial<ZoteroSearchResult> = {}): ZoteroSearchResult {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items: [],
    total: 0,
    offset: 0,
    returned: 0,
    ...overrides,
  }
}

/** A bare item detail with no children; override any field per test. */
export function itemDetail(overrides: Partial<ZoteroItemDetail> = {}): ZoteroItemDetail {
  return {
    ref: itemRef(),
    itemType: 'journalArticle',
    title: 'Paper 1',
    creators: [],
    abstractTruncated: false,
    tags: [],
    collections: [],
    children: { total: 0 },
    ...overrides,
  }
}
