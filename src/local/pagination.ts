/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place:
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */

import { parseNonNegativeSafeInteger } from '../json.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'
import {
  ZOTERO_ITEMKEY_BATCH,
  ZOTERO_LIBRARY_VERSION_HEADER,
  ZOTERO_LIST_PAGE_ROWS,
  ZOTERO_TOTAL_RESULTS_HEADER,
} from '../constants.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import { mapWithConcurrency } from '../concurrency.js'
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
 * Read and validate the `Last-Modified-Version` header a navigation listing or
 * collection read must report. A navigation page without an honest library
 * version cannot be fenced against a snapshot that moved underneath it, so the
 * read fails loud instead of inventing one.
 */
export function requireLibraryVersionHeader(headers: Headers, what: string): number {
  const raw = headers.get(ZOTERO_LIBRARY_VERSION_HEADER)
  const version = parseNonNegativeSafeInteger(raw)
  if (version === undefined) {
    throw new ZoteroError(
      `Zotero did not return a valid Last-Modified-Version header for ${what}`,
      ZOTERO_UNEXPECTED,
    )
  }
  return version
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
 * Split inputs into `itemKey=`-sized batches: every batched read chunks at
 * `ZOTERO_ITEMKEY_BATCH` and then comma-joins each batch itself — that join
 * spelling is the wire contract Zotero splits server-side
 * (`new Set(...split(','))`, `server_localAPI.js:1117-1129`).
 */
export function chunkItemKeyBatches<T>(items: readonly T[]): T[][] {
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += ZOTERO_ITEMKEY_BATCH) {
    batches.push(items.slice(start, start + ZOTERO_ITEMKEY_BATCH))
  }
  return batches
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

/**
 * Read every page of one listing concurrently, fold each page as it arrives,
 * and return the folded pages in listing order. Page 0 measures both the
 * `Total-Results` window and the window size the server actually honors, so a
 * server capped below `ZOTERO_LIST_PAGE_ROWS` is walked at its own stride
 * rather than skipping the rows between the cap and 100. A short middle page
 * leaves a gap that is repaired at the exact missing offset; the assembled
 * row count must equal the reported total.
 *
 * Every page keeps the shared guards: identity, array body, honest total, the
 * empty-page breach, an overlong-page refusal, and the same
 * `Last-Modified-Version` fence.
 * @param client - the transport every page read rides.
 * @param path - the listing's path relative to the API base.
 * @param initial - the query every page carries; cloned per page.
 * @param serverId - the instance claim, if the caller carries one.
 * @param signal - caller cancellation, forwarded to every page read.
 * @param what - the listing's own label for body/total errors.
 * @param concurrency - the bounded pool size for the non-first pages.
 * @param fold - folds one page into the caller's compact value, releasing the
 *   raw rows as soon as the page is validated.
 * @returns the folded pages, the measured total, the serving instance, and
 *   the library version the listing was read through.
 */
export async function readPagesConcurrentlyFolded<T>(
  client: ZoteroHttpClient,
  path: string,
  initial: URLSearchParams,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
  what: { readonly body: string; readonly page: string },
  concurrency: number,
  fold: (rows: readonly unknown[], offset: number) => T,
): Promise<{
  pages: { offset: number; value: T }[]
  total: number
  serverId?: string
  libraryVersion?: number
}> {
  const versionOf = (headers: Headers): number | undefined =>
    parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER))
  const readPage = (offset: number, limit: number, poolSignal: AbortSignal | undefined) =>
    client.getJson<unknown>(path, setPage(new URLSearchParams(initial.toString()), offset, limit), {
      signal: poolSignal,
      serverId,
    })
  const first = await readPage(0, ZOTERO_LIST_PAGE_ROWS, signal)
  let observed = serverIdFromHeaders(first.headers, serverId)
  assertServerIdMatches(observed, serverId)
  const version = versionOf(first.headers)
  const firstRows = requireArrayBody(first.json, what.body)
  const total = requireTotalResults(first.headers, what.body)
  if (firstRows.length > ZOTERO_LIST_PAGE_ROWS) {
    throw new ZoteroError(
      `Zotero returned ${firstRows.length} rows for ${what.page} at offset 0 but the window is ${ZOTERO_LIST_PAGE_ROWS}`,
      ZOTERO_UNEXPECTED,
    )
  }
  nextOffsetOrFail(0, firstRows.length, total, what.page)
  const pages: { offset: number; value: T }[] = [{ offset: 0, value: fold(firstRows, 0) }]
  let rowsRead = firstRows.length
  if (firstRows.length === 0) {
    return { pages, total, serverId: observed ?? undefined, libraryVersion: version }
  }

  const readWindow = async (
    offset: number,
    requested: number,
    poolSignal: AbortSignal | undefined,
  ): Promise<readonly unknown[]> => {
    const { json, headers } = await readPage(offset, requested, poolSignal)
    const pageServerId = serverIdFromHeaders(headers, observed)
    assertServerIdMatches(pageServerId, observed)
    observed ??= pageServerId
    const pageRows = requireArrayBody(json, what.body)
    if (pageRows.length > requested) {
      throw new ZoteroError(
        `Zotero returned ${pageRows.length} rows for ${what.page} at offset ${offset} but the window is ${requested}`,
        ZOTERO_UNEXPECTED,
      )
    }
    nextOffsetOrFail(offset, pageRows.length, total, what.page)
    if (versionOf(headers) !== version) {
      throw new ZoteroError(
        `Zotero's library version changed during the ${what.page}; the listing cannot be assembled.`,
        ZOTERO_UNEXPECTED,
      )
    }
    return pageRows
  }

  const window = firstRows.length
  const windows: { offset: number; limit: number }[] = []
  for (let offset = window; offset < total; offset += window) {
    windows.push({ offset, limit: Math.min(window, total - offset) })
  }
  const results = await mapWithConcurrency(
    windows,
    Math.max(1, concurrency),
    async (entry, poolSignal) => {
      const rows = await readWindow(entry.offset, entry.limit, poolSignal)
      return { offset: entry.offset, requested: entry.limit, rows }
    },
    { signal },
  )
  results.sort((a, b) => a.offset - b.offset)
  const gaps: { start: number; end: number }[] = []
  for (const result of results) {
    pages.push({ offset: result.offset, value: fold(result.rows, result.offset) })
    rowsRead += result.rows.length
    if (result.rows.length < result.requested) {
      gaps.push({
        start: result.offset + result.rows.length,
        end: result.offset + result.requested,
      })
    }
  }
  gaps.sort((a, b) => a.start - b.start)
  // The repair loop closes every gap by construction: an empty page or an
  // overlong repair page throws above, and the cursor only advances by the
  // rows actually read, so `rowsRead` ends at exactly `total`.
  for (const gap of gaps) {
    let cursor = gap.start
    while (cursor < gap.end) {
      const remaining = gap.end - cursor
      const rows = await readWindow(cursor, remaining, signal)
      if (rows.length === 0) {
        throw new ZoteroError(
          `Zotero returned an empty repair page for ${what.page} at offset ${cursor} but ${remaining} rows are missing`,
          ZOTERO_UNEXPECTED,
        )
      }
      pages.push({ offset: cursor, value: fold(rows, cursor) })
      rowsRead += rows.length
      cursor += rows.length
    }
  }
  pages.sort((a, b) => a.offset - b.offset)
  return { pages, total, serverId: observed ?? undefined, libraryVersion: version }
}

/**
 * Read every page of one listing concurrently and return the raw rows in
 * listing order. The folded reader owns the windowing and repair; this
 * wrapper is the identity fold for callers that still consume raw rows.
 */
export async function readPagesConcurrently(
  client: ZoteroHttpClient,
  path: string,
  initial: URLSearchParams,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
  what: { readonly body: string; readonly page: string },
  concurrency: number,
): Promise<{
  rows: readonly unknown[]
  total: number
  serverId?: string
  libraryVersion?: number
}> {
  const result = await readPagesConcurrentlyFolded(
    client,
    path,
    initial,
    serverId,
    signal,
    what,
    concurrency,
    (rows) => rows,
  )
  return {
    rows: result.pages.flatMap((page) => page.value),
    total: result.total,
    ...(result.serverId !== undefined ? { serverId: result.serverId } : {}),
    ...(result.libraryVersion !== undefined ? { libraryVersion: result.libraryVersion } : {}),
  }
}
