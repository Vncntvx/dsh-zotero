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
import type { EnrichmentPreferences } from '../enrichment-preferences.js';
import type { ZoteroArtifactMetadataView, ZoteroAttachmentLocationView, ZoteroDocumentArtifactRequestView, ZoteroDocumentArtifactResultView } from '../contract.js';
/**
 * A bounded, time-scoped memo of resolved attachments, keyed by ref.
 *
 * One badge probe needs the attachment twice — once to validate the parse
 * target and once to stat the file behind it — and two pages of one listing
 * ("show more", or a re-render whose revision moved) repeat that work for rows
 * whose attachment has not moved. Each entry is two loopback reads; the memo
 * makes them one per ref per listing.
 *
 * The owner is the component: the service creates one and clears it on
 * teardown, so no module-level state outlives the registration that filled it.
 */
export declare class AttachmentResolutionCache {
    private readonly limit;
    private readonly ttlMs;
    private readonly now;
    private readonly answers;
    /**
     * @param limit - the most entries held; the oldest is evicted at the cap.
     * @param ttlMs - how long one entry stands.
     * @param now - the clock, injectable so a spec can age an entry.
     */
    constructor(limit?: number, ttlMs?: number, now?: () => number);
    /**
     * The resolved attachment for one ref, if it is still fresh.
     * @param ref - the attachment ref.
     * @returns the view, or undefined when absent or stale.
     */
    get(ref: string): ZoteroAttachmentLocationView | undefined;
    /**
     * Remember one resolution until its TTL runs out.
     * @param ref - the attachment ref.
     * @param view - what the core answered for it.
     */
    set(ref: string, view: ZoteroAttachmentLocationView): void;
    /** Drop every remembered resolution; called from the owner's teardown. */
    clear(): void;
}
/**
 * The prober's resolver: the core is asked once per ref per TTL window, and
 * the target validation and the source stat agree by construction because
 * both read the same answer.
 * @param resolve - the core's resolver.
 * @param cache - the owner's memo; absent means every call resolves.
 * @returns the resolver the probe should use.
 */
export declare function cachedAttachmentResolver(resolve: ParseAttachmentResolver, cache: AttachmentResolutionCache | undefined): ParseAttachmentResolver;
export type MetadataResult = {
    readonly metadata: ZoteroArtifactMetadataView;
    readonly currentArtifactId?: string;
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
    /**
     * The owner's memo of resolved attachments. Absent means every call resolves
     * the attachment itself, which is what a one-off inspect wants.
     */
    readonly resolutionCache?: AttachmentResolutionCache;
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