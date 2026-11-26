import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { ZoteroJournalMetricsRefreshView, ZoteroJournalMetricsRequestView, ZoteroJournalMetricsView } from '../contract.js';
interface JournalMetricsDependencies {
    readonly reference: () => string | undefined;
    readonly credential: (ref: ReturnType<typeof credentialRef>) => Promise<string | undefined>;
    readonly fetch: (url: URL, signal: AbortSignal) => Promise<Response>;
    readonly cacheDirectory?: string;
    readonly onCacheWriteError?: () => void;
}
/** A shared queue and cache for every panel caller of this host service. */
export declare class JournalMetrics {
    private readonly deps;
    private reference?;
    private credentialDigest?;
    private generation;
    private disposed;
    private readonly cache;
    private readonly store?;
    private readonly refreshes;
    private readonly flights;
    private readonly queued;
    private readonly running;
    private timer?;
    private nextStart;
    private cooldownUntil;
    private quotaUntil;
    constructor(deps: JournalMetricsDependencies);
    sync(): string | undefined;
    credentialChanged(reference: string): void;
    dispose(): Promise<void>;
    private invalidate;
    private stopFlights;
    private identity;
    refresh(signal: AbortSignal): Promise<ZoteroJournalMetricsRefreshView>;
    private refreshSaved;
    lookup(request: ZoteroJournalMetricsRequestView, signal?: AbortSignal): Promise<ZoteroJournalMetricsView>;
    private lookupJournal;
    private pump;
    private run;
    private save;
    private fetchMetrics;
}
export {};
//# sourceMappingURL=journal-metrics.d.ts.map