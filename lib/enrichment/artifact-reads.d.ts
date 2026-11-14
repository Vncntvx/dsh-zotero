import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol';
import type { ArtifactReaderPreferences } from '../artifact-reader-preferences.js';
import { type ZoteroArtifactMetadataView, type ZoteroDocumentArtifactRequestView, type ZoteroDocumentArtifactResultView } from '../contract.js';
export interface DisplayArtifactCandidate {
    readonly metadata: ZoteroArtifactMetadataView;
    readonly markdownBytes: number;
    readonly read: () => Promise<string>;
    readonly image: (name: string) => Promise<{
        readonly data: Uint8Array;
        readonly mediaType: ZoteroArtifactMetadataView['images'][number]['mediaType'];
    } | undefined>;
}
export type DisplayArtifactLookup = DisplayArtifactCandidate | {
    readonly kind: 'missing' | 'expired';
};
interface ReadOwner {
    readonly peer: PeerScope;
    readonly agent: Agent;
}
export interface ArtifactReadDependencies {
    readonly policy: () => ArtifactReaderPreferences;
    readonly owner: (sessionId: string, signal: AbortSignal, ctx: Context) => Promise<ReadOwner>;
    readonly candidate: (request: Extract<ZoteroDocumentArtifactRequestView, {
        op: 'open' | 'inspect';
    }>, signal: AbortSignal) => Promise<DisplayArtifactLookup>;
    /** Lease-free metadata for one stored artifact; never resolves an attachment. */
    readonly metadata: (request: Extract<ZoteroDocumentArtifactRequestView, {
        op: 'meta';
    }>, signal: AbortSignal) => Promise<{
        readonly metadata: ZoteroArtifactMetadataView;
    } | {
        readonly kind: 'missing';
    }>;
    /** One freshness probe per ref, answered from a single index snapshot. */
    readonly probe: (request: Extract<ZoteroDocumentArtifactRequestView, {
        op: 'probe';
    }>, signal: AbortSignal) => Promise<Extract<ZoteroDocumentArtifactResultView, {
        kind: 'probed';
    }>>;
}
/** Every resource has a bounded lifetime; no polling or source revalidation runs behind the user. */
export declare class ArtifactReads {
    private readonly deps;
    private readonly requests;
    private readonly tokens;
    private readonly draining;
    private bytes;
    private closed;
    constructor(deps: ArtifactReadDependencies);
    private key;
    private arm;
    private releaseData;
    private retire;
    private current;
    private page;
    request(request: ZoteroDocumentArtifactRequestView, signal: AbortSignal, ctx: Context): Promise<ZoteroDocumentArtifactResultView>;
    private tombstone;
    private open;
    retireAgent(agent: Agent): void;
    /** Invalidate open leases for one artifact before its files are removed. */
    retireArtifact(artifactId: string): void;
    dispose(): Promise<void>;
}
export {};
//# sourceMappingURL=artifact-reads.d.ts.map