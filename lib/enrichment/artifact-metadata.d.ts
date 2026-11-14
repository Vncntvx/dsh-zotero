/**
 * Lease-free metadata and batched freshness probes over committed artifacts.
 *
 * Both arms answer from the source index and one meta.json per artifact; the
 * probe arm additionally validates the source against the stored stamp. The
 * service and the test fixtures compose the same functions, so a probe always
 * means exactly what a single-target inspect means.
 * @module dsh-zotero/enrichment/artifact-metadata
 */
import type { MineruClient } from './transport.js';
import type { ParseAttachmentResolver } from './parse-target.js';
import type { ParsedArtifactStore } from './artifact-store.js';
import { type EnrichmentPreferences } from '../enrichment-preferences.js';
import type { ZoteroArtifactMetadataView, ZoteroDocumentArtifactRequestView, ZoteroDocumentArtifactResultView } from '../contract.js';
export type MetadataResult = {
    readonly metadata: ZoteroArtifactMetadataView;
} | {
    readonly kind: 'missing';
};
export type ProbeResult = Extract<ZoteroDocumentArtifactResultView, {
    kind: 'probed';
}>;
type MetaRequest = Extract<ZoteroDocumentArtifactRequestView, {
    op: 'meta';
}>;
type ProbeRequest = Extract<ZoteroDocumentArtifactRequestView, {
    op: 'probe';
}>;
export interface ArtifactMetadataDeps {
    readonly store: () => Promise<ParsedArtifactStore>;
    readonly resolveAttachment: ParseAttachmentResolver;
    readonly client: MineruClient;
}
/**
 * Lease-free metadata for one stored artifact: the tab-title path. This arm
 * never resolves an attachment, stats a source or issues a HEAD — it reads
 * the source index and one meta.json, nothing else.
 */
export declare function storedMetadata(deps: ArtifactMetadataDeps, config: EnrichmentPreferences, request: MetaRequest, signal: AbortSignal): Promise<MetadataResult>;
/**
 * One freshness probe per visible attachment row, answered from a single
 * index snapshot: rows with no committed artifact cost nothing, resolved rows
 * cost one attachment resolution and one stat or HEAD. A per-ref failure is
 * the badge's absence, never an error on the wire.
 */
export declare function probeAttachments(deps: ArtifactMetadataDeps, config: EnrichmentPreferences, request: ProbeRequest, signal: AbortSignal): Promise<ProbeResult>;
export {};
//# sourceMappingURL=artifact-metadata.d.ts.map