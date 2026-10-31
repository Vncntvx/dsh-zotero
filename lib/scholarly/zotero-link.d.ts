/**
 * Cross-component integration between the scholarly search engine and the local
 * Zotero library: annotates search hits the user already holds.
 *
 * Two rules shape this module:
 *
 * 1. **The ref grammar has one owner.** `src/refs.ts` decides what a
 *    `zotero://` ref is, and this module never recovers an identity from a
 *    string that `parseRef` rejected. A hit whose `ref` is outside the grammar
 *    is not a match, so it is skipped: inventing a key (and defaulting its
 *    library to personal `0`) would assert group-library membership the record
 *    never stated, and the detail seam only accepts the parsed object.
 * 2. **Absence is not evidence.** A lookup that could not run is counted in
 *    {@link LibraryStatusReport}, so the caller reports "library status
 *    unavailable" instead of leaving every hit unmarked, which a reader would
 *    take for "not in the library".
 *
 * @module dsh-zotero/scholarly/zotero-link
 */
import type { ZoteroGetRequest, ZoteroItemDetail, ZoteroSearchOptions, ZoteroSearchRequest, ZoteroSearchResult, ZoteroCreateItemRequest, ZoteroCreateItemCommittedOutcome, ZoteroWriteCall } from '../types.js';
import type { ScholarlyPaper } from './types.js';
export interface ZoteroServiceLike {
    search(request: ZoteroSearchRequest, signal: AbortSignal | undefined, options: ZoteroSearchOptions): Promise<ZoteroSearchResult>;
    get?(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>;
    createItem?(request: ZoteroCreateItemRequest, call: ZoteroWriteCall): Promise<ZoteroCreateItemCommittedOutcome | {
        kind: 'declined';
    }>;
}
/** What one library-status pass managed to determine. */
interface LibraryStatusReport {
    /** Hits that received an `inLibrary` annotation. */
    readonly matched: number;
    /** Hits whose lookup failed; these carry no annotation and must not read as "absent". */
    readonly failed: number;
    /** Hits skipped because their `ref` fell outside the grammar. */
    readonly unparseable: number;
}
/**
 * Annotate a set of papers with their library status, and report what the
 * pass determined: how many matched, how many lookups failed, and how many
 * refs fell outside the grammar.
 * @param papers - hits to annotate in place.
 * @param zoteroService - the library service, when the host provides one.
 * @returns what the pass determined.
 */
export declare function attachLibraryStatus(papers: ScholarlyPaper[], zoteroService?: ZoteroServiceLike, signal?: AbortSignal): Promise<LibraryStatusReport>;
/**
 * Annotate papers with their library status and, when any lookup failed,
 * format the notice the caller appends. A failed lookup is not evidence of
 * absence, so the notice says "unavailable" rather than leaving hits unmarked.
 * @param papers - papers to annotate in place.
 * @param zoteroService - optional local library service.
 * @param signal - optional cancellation signal.
 * @param style - 'batch' reports counts (search, citations); 'item' reports one result (get).
 * @returns the notice and the raw status report.
 */
export declare function annotateWithLibraryStatus(papers: ScholarlyPaper[], zoteroService?: ZoteroServiceLike, signal?: AbortSignal, style?: 'batch' | 'item'): Promise<{
    notice: string;
    report: LibraryStatusReport;
}>;
export {};
//# sourceMappingURL=zotero-link.d.ts.map