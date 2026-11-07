/**
 * Per-host request pacing: at most one request in flight per host, spaced by
 * that host's declared interval.
 *
 * Intervals come from `hosts.ts`; this module owns no host list of its own.
 *
 * @module dsh-zotero/scholarly/transport/pacing
 */
/**
 * Sleep that a caller's cancellation can cut short.
 * @param ms - milliseconds to wait.
 * @param signal - the caller's cancellation.
 * @returns resolution after the wait, or rejection on cancellation.
 */
export declare function abortableSleep(ms: number, signal?: AbortSignal): Promise<void>;
/**
 * Serializes requests per host and spaces them by the host's interval.
 *
 * The per-host tail is a promise chain, but every link resolves: a rejected
 * link would poison the host for the rest of the process, so the release step
 * is reached through `finally` and the chain never carries a rejection.
 */
export declare class HostPacer {
    private readonly tails;
    private readonly lastRequestTime;
    private readonly overrides;
    private readonly maxTrackedHosts;
    /**
     * @param overrides - per-host interval overrides; a test sets `0` to disable
     *   spacing without touching the production table.
     */
    constructor(overrides?: Record<string, number>, maxTrackedHosts?: number);
    /**
     * The interval this pacer applies to one host.
     * @param host - the URL host, possibly with a port.
     * @returns the interval in milliseconds; `0` means unspaced.
     */
    intervalOf(host: string): number;
    private pruneLastRequestTimes;
    /**
     * Wait until this host may be called, then reserve the slot.
     * @param host - the URL host.
     * @param signal - the caller's cancellation; aborting rejects instead of
     *   waiting for the slot.
     * @returns resolution once the caller may issue its request.
     */
    pace(host: string, signal?: AbortSignal): Promise<void>;
}
//# sourceMappingURL=pacing.d.ts.map