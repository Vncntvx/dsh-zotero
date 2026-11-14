/**
 * @module dsh-zotero/local/changes-cursor
 */
import type { SupportedLocalLibrary, ZoteroChangesCursor, ZoteroChangesInclude } from '../types.js';
export declare function numericHeader(headers: Headers, name: string): number | undefined;
export declare function isVersion(value: unknown): value is number;
/** `user/0` or `group/42`, the way the model names a library. */
export declare function libraryLabelOf(library: SupportedLocalLibrary): string;
/**
 * The model-facing message for a cursor minted in one library and passed to a
 * diff of another. A version counter is a per-library transaction count, so
 * the two numbers are unrelated and no response would reveal the mix-up.
 */
export declare function cursorLibraryMismatchMessage(cursorLibrary: string, requestLibrary: string): string;
/** A response identity is usable only when it is a non-blank string. */
export declare function observedServerId(value: string | null | undefined): string | undefined;
/**
 * The cursor for `version`, or undefined when there is no instance to pin it
 * to, or when every requested kind ended up unserved and there is nothing to
 * checkpoint. The cursor certifies only the kinds it actually tracked: kinds
 * the build structurally does not serve ride `unserved`, never `include`, so
 * the coverage claim stays true and a later call can still resume them — the
 * answer will be the same absence.
 */
export declare function cursorFor(serverId: string | undefined, library: SupportedLocalLibrary, version: number | undefined, include: ReadonlySet<ZoteroChangesInclude>, unserved: ReadonlySet<ZoteroChangesInclude>): ZoteroChangesCursor | undefined;
//# sourceMappingURL=changes-cursor.d.ts.map