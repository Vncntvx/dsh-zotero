/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place:
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */
/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud: pagination without
 * an honest total would silently under-report.
 */
export declare function requireTotalResults(headers: Headers, what: string): number;
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
//# sourceMappingURL=pagination.d.ts.map