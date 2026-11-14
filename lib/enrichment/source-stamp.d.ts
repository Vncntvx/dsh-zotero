/**
 * The source-index identity and stamp comparison used by the parsed-artifact
 * cache.
 *
 * The content cache is keyed by a fingerprint of the exact bytes, so it can
 * only be consulted after the bytes exist. The source index closes that gap:
 * it records which latest committed artifact belonged to one canonical source
 * and what the source looked like when it was fetched. A hit needs no PDF read
 * and no MinerU call; the selected parsing mode does not change this index.
 *
 * URL hits require a common freshness validator. A URL or a matching byte
 * length alone cannot prove that its content has not changed.
 * @module dsh-zotero/enrichment/source-stamp
 */
import type { FulltextSourceStamp } from './types.js';
/** SHA-256 of the canonical primary or verified alias, independent of mode. */
export declare function sourceKeyOf(identity: string): string;
/**
 * Whether a stored stamp still describes the current source.
 * @param stored - the stamp written with the cached artifact.
 * @param current - the stamp probed now.
 * @returns true when the artifact may be served without fetching the source.
 */
export declare function stampMatches(stored: FulltextSourceStamp, current: FulltextSourceStamp): boolean;
//# sourceMappingURL=source-stamp.d.ts.map