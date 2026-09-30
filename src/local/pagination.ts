/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place —
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */

import { parseNonNegativeSafeInteger } from '../json.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'

/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud — pagination without
 * an honest total would silently under-report.
 */
export function requireTotalResults(headers: Headers, what: string): number {
  // `Headers.get` is case-insensitive; one lookup covers both spellings.
  const raw = headers.get('total-results')
  const total = parseNonNegativeSafeInteger(raw)
  if (total === undefined) {
    throw new ZoteroError(
      `Zotero did not return a valid Total-Results header for ${what}`,
      ZOTERO_UNEXPECTED,
    )
  }
  return total
}

/**
 * Require a listing body to be an array. A non-array is a contract breach,
 * not an empty page: folding it to `[]` would silently under-report and can
 * stall pagination against a non-zero total.
 * @param json - the response body.
 * @param what - the listing name for the error message.
 * @returns the array body.
 */
export function requireArrayBody(json: unknown, what: string): unknown[] {
  if (!Array.isArray(json)) {
    throw new ZoteroError(`Zotero returned a non-array body for ${what}`, ZOTERO_UNEXPECTED)
  }
  return json
}

/**
 * The next page's offset, or undefined when this page reached the reported
 * total. Omitting (rather than null) keeps the result a pure lossless-JSON
 * value for the tool output snapshot. An empty page with a non-zero
 * remaining range is a contract breach (the body did not deliver what the
 * header promised), so it terminates pagination rather than stalling at the
 * same offset forever.
 */
export function nextOffsetOf(
  offset: number,
  returnedCount: number,
  total: number,
): number | undefined {
  if (returnedCount === 0) return undefined
  return offset + returnedCount < total ? offset + returnedCount : undefined
}
