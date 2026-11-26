import type { ZoteroService } from '../service.js';
import type { SupportedLocalLibrary } from '../types.js';
import type { ParsedArtifactStore, SourceIndexRecord, StoredArtifactMeta } from './artifact-store.js';
import { resolveSafeDirectory } from './safe-directory.js';
import type { ZoteroParsedIndexStatusView } from '../contract.js';
type ParsedArtifactMeta = StoredArtifactMeta['meta'];
export type ParsedScope = {
    kind: 'library';
    library: SupportedLocalLibrary;
} | {
    kind: 'collection';
    ref: string;
} | {
    kind: 'artifacts';
    artifactIds: readonly string[];
};
type Provider = ReturnType<ZoteroService['parsedSearchProvider']>;
type SearchRequest = {
    query: string;
    variants?: readonly string[];
    scope: ParsedScope;
    limit: number;
};
type Coverage = {
    status: 'complete' | 'partial' | 'unavailable';
    discovered: number;
    searchable: number;
    stale: number;
    missing: number;
};
interface SearchDependencies {
    readonly store: ParsedArtifactStore;
    readonly provider: () => Provider;
    readonly probe: (ref: string, record: SourceIndexRecord, meta: ParsedArtifactMeta, signal: AbortSignal) => Promise<boolean>;
}
export declare class ParsedIndex {
    private readonly resolveDirectory;
    private readonly databases;
    private latestPath?;
    private readonly shutdown;
    private active;
    private rebuildProgress?;
    private rebuilding;
    constructor(resolveDirectory?: typeof resolveSafeDirectory);
    private path;
    private existingPath;
    private retireIdle;
    private useDatabase;
    close(): Promise<void>;
    status(store: ParsedArtifactStore, externalSignal: AbortSignal): Promise<ZoteroParsedIndexStatusView>;
    private coverage;
    rebuild(store: ParsedArtifactStore, externalSignal: AbortSignal, authorize?: () => void, report?: (done: number, total: number) => void): Promise<void>;
    discard(root: string, artifactId: string): Promise<void>;
    search(deps: SearchDependencies, request: SearchRequest, externalSignal: AbortSignal): Promise<{
        query: string;
        queryTerms: string[];
        coverage: Coverage;
        passages: {
            artifactId: string;
            sourceId: string;
            generation: string;
            mode: "free" | "pro";
            fingerprint: string;
            start: number;
            end: number;
            heading: string;
            text: string;
            attachmentRef?: string | undefined;
            itemRef?: string | undefined;
        }[];
    }>;
    publish(store: ParsedArtifactStore, artifactId: string): Promise<void>;
    private indexCurrent;
    private searchActive;
    private libraryEntry;
}
export {};
//# sourceMappingURL=parsed-index.d.ts.map