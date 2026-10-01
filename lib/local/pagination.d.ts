/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place —
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */
/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud — pagination without
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
 * value for the tool output snapshot. An empty page with a non-zero
 * remaining range is a contract breach (the body did not deliver what the
 * header promised), so it terminates pagination rather than stalling at the
 * same offset forever.
 */
export declare function nextOffsetOf(offset: number, returnedCount: number, total: number): number | undefined;
//# sourceMappingURL=pagination.d.ts.map