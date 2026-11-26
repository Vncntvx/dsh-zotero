import type { ZoteroJournalMetricsView } from '../contract.js';
export type ReadyJournalMetrics = Extract<ZoteroJournalMetricsView, {
    status: 'ready';
}>;
export declare const JOURNAL_METRICS_CACHE_LIMIT = 512;
interface SavedJournalMetrics {
    readonly result: ReadyJournalMetrics;
    readonly publicationName?: string;
}
/** Successful snapshots survive a restart. File names hash the credential digest and journal name. */
export declare class JournalMetricsCache {
    private readonly root;
    constructor(root: string);
    private path;
    private readPath;
    read(digest: string, journal: string): Promise<SavedJournalMetrics | undefined>;
    journals(digest: string, signal: AbortSignal): Promise<string[]>;
    write(digest: string, journal: string, record: ReadyJournalMetrics): Promise<void>;
}
export {};
//# sourceMappingURL=journal-metrics-cache.d.ts.map