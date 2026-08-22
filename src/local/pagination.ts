/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place —
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */

import { ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'

/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud — pagination without
 * an honest total would silently under-report.
 */
export function requireTotalResults(headers: Headers, what: string): number {
  const raw = headers.get('total-results') ?? headers.get('Total-Results')
  if (raw === null || raw.trim() === '' || !/^\d+$/.test(raw.trim())) {
    throw new ZoteroError(
      `Zotero did not return a valid Total-Results header for ${what}`,
      ZOTERO_UNEXPECTED,
    )
  }
  return Number(raw.trim())
}

/**
 * The next page's offset, or undefined when this page reached the reported
 * total. Omitting (rather than null) keeps the result a pure lossless-JSON
 * value for the tool output snapshot.
 */
export function nextOffsetOf(
  offset: number,
  returnedCount: number,
  total: number,
): number | undefined {
  return offset + returnedCount < total ? offset + returnedCount : undefined
}
