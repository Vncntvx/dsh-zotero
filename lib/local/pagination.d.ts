/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place:
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */
import type { ZoteroHttpClient } from '../http-client.js';
/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud: pagination without
 * an honest total would silently under-report.
 */
export declare function requireTotalResults(headers: Headers, what: string): number;
/**
 * Read and validate the `Last-Modified-Version` header a navigation listing or
 * collection read must report. A navigation page without an honest library
 * version cannot be fenced against a snapshot that moved underneath it, so the
 * read fails loud instead of inventing one.
 */
export declare function requireLibraryVersionHeader(headers: Headers, what: string): number;
/**
 * Require a listing body to be an array. A non-array is a contract breach,
 * not an empty page: folding it to `[]` would silently under-report and can
 * stall pagination against a non-zero total.
 * @param json - the response body.
 * @param what - the listing name for the error message.
 * @returns the array body.
 */
export declare function requireArrayBody(json: unknown, what: string): unknown[];
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
export declare function nextOffsetOf(offset: number, returnedCount: number, total: number): number | undefined;
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
export declare function nextOffsetOrFail(offset: number, returnedCount: number, total: number, what: string): number | undefined;
/**
 * Write the request's paging window onto the query. The Local API spells the
 * window `start`/`limit`, and every server-paged reader requests it the same
 * way; one setter keeps the wire spelling in one place.
 * @param params - the query being built.
 * @param offset - the page's first row.
 * @param limit - the page's row budget.
 * @returns the same `params`, for call-site readability.
 */
export declare function setPage(params: URLSearchParams, offset: number, limit: number): URLSearchParams;
/**
 * Split inputs into `itemKey=`-sized batches: every batched read chunks at
 * `ZOTERO_ITEMKEY_BATCH` and then comma-joins each batch itself — that join
 * spelling is the wire contract Zotero splits server-side
 * (`new Set(...split(','))`, `server_localAPI.js:1117-1129`).
 */
export declare function chunkItemKeyBatches<T>(items: readonly T[]): T[][];
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
export declare function readAllPages(client: ZoteroHttpClient, path: string, initial: Record<string, string>, serverId: string, signal: AbortSignal | undefined, what: {
    readonly body: string;
    readonly page: string;
}, decorate: ((params: URLSearchParams) => void) | undefined, onPage: (rows: readonly unknown[]) => void): Promise<void>;
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
export declare function readPagesConcurrentlyFolded<T>(client: ZoteroHttpClient, path: string, initial: URLSearchParams, serverId: string | undefined, signal: AbortSignal | undefined, what: {
    readonly body: string;
    readonly page: string;
}, concurrency: number, fold: (rows: readonly unknown[], offset: number) => T): Promise<{
    pages: {
        offset: number;
        value: T;
    }[];
    total: number;
    serverId?: string;
    libraryVersion?: number;
}>;
/**
 * Read every page of one listing concurrently and return the raw rows in
 * listing order. The folded reader owns the windowing and repair; this
 * wrapper is the identity fold for callers that still consume raw rows.
 */
export declare function readPagesConcurrently(client: ZoteroHttpClient, path: string, initial: URLSearchParams, serverId: string | undefined, signal: AbortSignal | undefined, what: {
    readonly body: string;
    readonly page: string;
}, concurrency: number): Promise<{
    rows: readonly unknown[];
    total: number;
    serverId?: string;
    libraryVersion?: number;
}>;
//# sourceMappingURL=pagination.d.ts.map