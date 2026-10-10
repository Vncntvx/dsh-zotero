/**
 * Shared pagination plumbing for every server-paged listing: the honest
 * `Total-Results` read and the next-page cursor. Search, browse, and the
 * changes diffs all page the same way, so the invariant lives in one place:
 * a listing without a valid total fails loud instead of guessing.
 * @module dsh-zotero/local/pagination
 */
import { parseNonNegativeSafeInteger } from '../json.js';
import { ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js';
import { ZOTERO_TOTAL_RESULTS_HEADER } from '../constants.js';
/**
 * Read and validate the `Total-Results` header a server-paged list endpoint
 * must report. A missing or malformed header fails loud: pagination without
 * an honest total would silently under-report.
 */
export function requireTotalResults(headers, what) {
    // `Headers.get` is case-insensitive; one lookup covers both spellings.
    const raw = headers.get(ZOTERO_TOTAL_RESULTS_HEADER);
    const total = parseNonNegativeSafeInteger(raw);
    if (total === undefined) {
        throw new ZoteroError(`Zotero did not return a valid Total-Results header for ${what}`, ZOTERO_UNEXPECTED);
    }
    return total;
}
/**
 * Require a listing body to be an array. A non-array is a contract breach,
 * not an empty page: folding it to `[]` would silently under-report and can
 * stall pagination against a non-zero total.
 * @param json - the response body.
 * @param what - the listing name for the error message.
 * @returns the array body.
 */
export function requireArrayBody(json, what) {
    if (!Array.isArray(json)) {
        throw new ZoteroError(`Zotero returned a non-array body for ${what}`, ZOTERO_UNEXPECTED);
    }
    return json;
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
export function nextOffsetOf(offset, returnedCount, total) {
    if (returnedCount === 0)
        return undefined;
    return offset + returnedCount < total ? offset + returnedCount : undefined;
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
export function nextOffsetOrFail(offset, returnedCount, total, what) {
    if (returnedCount === 0 && offset < total) {
        throw new ZoteroError(`Zotero returned an empty page for ${what} at offset ${offset} but Total-Results is ${total}`, ZOTERO_UNEXPECTED);
    }
    return nextOffsetOf(offset, returnedCount, total);
}
//# sourceMappingURL=pagination.js.map