/**
 * The `zotero_changes` domain: baseline version readings and `?since=` diffs
 * over the versions-format endpoints, with tombstones from /deleted. A kind
 * this Zotero build cannot serve (or cannot serve for the requested range)
 * degrades to absence, and is named, with the reason, in `unobservable`,
 * instead of failing the whole read.
 *
 * Every versions resource is read unbounded (no `limit`): the local API
 * returns the whole changed set for such a request, which is what lets the
 * version the response reports be a cursor a caller may resume from, while
 * `maxChangesResults` only shortens the listings the model sees.
 *
 * The item space is read as the API itself partitions it: `/items` (live
 * items), `/items/top` (their top-level subset) and `/items/trash` (the
 * trash). Zotero keeps child objects (notes, attachments, annotations) as
 * items with versions of their own, and excludes the trash from its item
 * listings, so a diff over `/items/top` alone would report a version advance
 * whose changes it never mentioned: editing one annotation moves the library
 * version without touching any top-level item. Top-level items are the
 * top-level read, child objects are the difference between the two live
 * reads, and the trash is its own listing.
 *
 * A cursor is more than a number: it carries the instance and the library it
 * describes. The claim travels with every request (`Zotero-Server-ID`), so a
 * cursor from another database is rejected by the server rather than silently
 * diffing this one's counter, and the library is checked before the first
 * read. The cursor is handed back only when the whole range was read, the
 * library version did not move during the fan-out, and the answering instance
 * is known; otherwise the caller must not advance at all.
 * @module dsh-zotero/local/changes-domain
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroChangesRequest, ZoteroChangesResult, ZoteroProgressEvent } from '../types.js';
/**
 * The model-facing message for a cursor minted in one library and passed to a
 * diff of another. A version counter is a per-library transaction count, so
 * the two numbers are unrelated and no response would reveal the mix-up.
 */
export declare function cursorLibraryMismatchMessage(cursorLibrary: string, requestLibrary: string): string;
/**
 * Diff the library against a local transaction version. On the verified build
 * (Zotero 10.0.2-beta.9) versions are local transactions: every object save
 * advances the library's counter and stamps the object, so `?since=` answers
 * "what changed here" without the cloud and without a background watcher. The
 * domain never assumes that from a build number, because no response header
 * names the build, and one that reports no library version is reported as
 * `versionUnavailable` instead. Without `since` this is a baseline reading,
 * just the current version for the next call to diff from. `format=versions`
 * responses are key→version maps; `/deleted` returns tombstone key lists.
 * Each listing is capped at `maxChangesResults` entries with its true count
 * in `totals` and an honest `truncated` flag.
 */
export declare function changes(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroChangesRequest, signal?: AbortSignal, onProgress?: (progress: ZoteroProgressEvent) => void): Promise<ZoteroChangesResult>;
//# sourceMappingURL=changes-domain.d.ts.map