/**
 * Resolve a stored artifact id back into a concrete parsing/reading target.
 *
 * The browser only ever holds an opaque SHA-256 artifact id. Complete URL
 * sources are reconstructed on the host from the source index or the artifact's
 * own meta, so a signed URL never travels through a wire result. An orphan
 * directory (the artifact committed before its index pointer) is resolvable
 * from meta alone.
 * @module dsh-zotero/enrichment/artifact-target
 */
import type { ZoteroParseTargetView } from '../contract.js';
import { type ParseTarget } from './parse-target.js';
import type { ParsedArtifactStore, SourceIndexRecord } from './artifact-store.js';
export interface ArtifactTarget {
    readonly target: ParseTarget;
    readonly generation: string;
    readonly aliases: readonly string[];
    readonly indexed: boolean;
    /** The source-index record backing the artifact; undefined for an orphan directory. */
    readonly record?: SourceIndexRecord;
}
/**
 * Rebuild the concrete target for a committed or orphaned artifact.
 * @param artifactId - the cache key naming the artifact directory.
 * @param store - a read-only store bound to the configured output directory.
 * @returns the resolved target plus the generation, the source-index record
 * and its alias keys, from one index read.
 */
export declare function resolveArtifactTarget(artifactId: string, store: ParsedArtifactStore): Promise<ArtifactTarget>;
/**
 * Expand an opaque artifact target into the concrete source target before any
 * parsing or reading code sees it. Other target shapes pass through unchanged.
 */
export declare function expandRequestTarget(target: ZoteroParseTargetView, store: ParsedArtifactStore): Promise<{
    readonly target: ZoteroParseTargetView;
    readonly record?: SourceIndexRecord;
}>;
//# sourceMappingURL=artifact-target.d.ts.map