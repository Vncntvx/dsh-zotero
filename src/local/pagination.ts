/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place:
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */

import { parseNonNegativeSafeInteger } from '../json.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'
import { ZOTERO_LIST_PAGE_ROWS, ZOTERO_TOTAL_RESULTS_HEADER } from '../constants.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import type { ZoteroHttpClient } from '../http-client.js'

/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud: pagination without
 * an honest total would silently under-report.
 */
export function requireTotalResults(headers: Headers, what: string): number {
  // `Headers.get` is case-insensitive; one lookup covers both spellings.
  const raw = headers.get(ZOTERO_TOTAL_RESULTS_HEADER)
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
 * value for the tool output snapshot.
 *
 * This is the client-sliced spelling: an empty slice simply means the request
 * started past the end of a list the caller already has in full. A page read
 * off the server must use {@link nextOffsetOrFail} instead, where an empty
 * page with range left is a body/header mismatch, not an ending.
 */
export function nextOffsetOf(
  offset: number,
  returnedCount: number,
  total: number,
): number | undefined {
  if (returnedCount === 0) return undefined
  return offset + returnedCount < total ? offset + returnedCount : undefined
}

/**
 * The next page's offset for a server-paged listing, failing loud when the
 * body contradicts the header.
 *
 * A server that reports `Total-Results: 500` and then answers an in-range page
 * with zero rows has not ended the listing; it has breached the contract the
 * total is. Silently terminating there reports a truncated result as a
 * complete one, and the model cannot tell the difference.
 * @param offset - the offset this page was requested at.
 * @param returnedCount - how many rows the body carried.
 * @param total - the `Total-Results` total this page was measured against.
 * @param what - the listing name for the error message.
 * @returns the next page's offset, or undefined at the end of the listing.
 */
export function nextOffsetOrFail(
  offset: number,
  returnedCount: number,
  total: number,
  what: string,
): number | undefined {
  if (returnedCount === 0 && offset < total) {
    throw new ZoteroError(
      `Zotero returned an empty page for ${what} at offset ${offset} but Total-Results is ${total}`,
      ZOTERO_UNEXPECTED,
    )
  }
  return nextOffsetOf(offset, returnedCount, total)
}

/**
 * Write the request's paging window onto the query. The Local API spells the
 * window `start`/`limit`, and every server-paged reader requests it the same
 * way; one setter keeps the wire spelling in one place.
 * @param params - the query being built.
 * @param offset - the page's first row.
 * @param limit - the page's row budget.
 * @returns the same `params`, for call-site readability.
 */
export function setPage(params: URLSearchParams, offset: number, limit: number): URLSearchParams {
  params.set('start', String(offset))
  params.set('limit', String(limit))
  return params
}

/**
 * Walk one server-paged listing to its honest end: every page is read at the
 * standard window, identity-checked against the serving instance (identity
 * before shape: an answer from another instance is refused before its body
 * is judged), and shaped by the shared {@link requireArrayBody}/
 * {@link requireTotalResults} guards before {@link nextOffsetOrFail}
 * advances or ends the walk.
 *
 * The wire spelling of the query is fixed: each page builds a fresh
 * `URLSearchParams` from `initial`, applies the paging window, then hands the
 * params to `decorate` — so a caller's extra parameters land after
 * `start`/`limit` in insertion order, exactly as a hand-rolled loop spelled it.
 * @param client - the transport every page read rides.
 * @param path - the listing's path relative to the API base.
 * @param initial - query parameters every page carries before the window.
 * @param serverId - the serving instance the answer must match.
 * @param signal - caller cancellation, forwarded to every page read.
 * @param what - the listing's own label for body/total errors (`body`) and
 *   the cursor error (`page`); the two may legitimately differ.
 * @param decorate - optional per-page query addition, applied after the
 *   paging window (e.g. the annotation type filter).
 * @param onPage - consumes one validated page; may throw to end the walk.
 */
export async function readAllPages(
  client: ZoteroHttpClient,
  path: string,
  initial: Record<string, string>,
  serverId: string,
  signal: AbortSignal | undefined,
  what: { readonly body: string; readonly page: string },
  decorate: ((params: URLSearchParams) => void) | undefined,
  onPage: (rows: readonly unknown[]) => void,
): Promise<void> {
  let offset = 0
  for (;;) {
    const params = setPage(new URLSearchParams(initial), offset, ZOTERO_LIST_PAGE_ROWS)
    decorate?.(params)
    const { json, headers } = await client.getJson<unknown>(path, params, { serverId, signal })
    assertServerIdMatches(serverIdFromHeaders(headers), serverId)
    const page = requireArrayBody(json, what.body)
    const total = requireTotalResults(headers, what.body)
    onPage(page)
    const next = nextOffsetOrFail(offset, page.length, total, what.page)
    if (next === undefined) return
    offset = next
  }
}
