/**
 * Per-host request pacing: at most one request in flight per host, spaced by
 * that host's declared interval.
 *
 * Intervals come from `hosts.ts`; this module owns no host list of its own.
 *
 * @module dsh-zotero/scholarly/transport/pacing
 */
import { intervalForHost } from './hosts.js';
/**
 * Sleep that a caller's cancellation can cut short.
 * @param ms - milliseconds to wait.
 * @param signal - the caller's cancellation.
 * @returns resolution after the wait, or rejection on cancellation.
 */
export function abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(signal.reason ?? new Error('Operation aborted'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new Error('Operation aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/**
 * Serializes requests per host and spaces them by the host's interval.
 *
 * The per-host tail is a promise chain, but every link resolves: a rejected
 * link would poison the host for the rest of the process, so the release step
 * is reached through `finally` and the chain never carries a rejection.
 */
export class HostPacer {
    tails = new Map();
    lastRequestTime = new Map();
    overrides;
    maxTrackedHosts;
    /**
     * @param overrides - per-host interval overrides; a test sets `0` to disable
     *   spacing without touching the production table.
     */
    constructor(overrides = {}, maxTrackedHosts = 200) {
        this.overrides = overrides;
        this.maxTrackedHosts = maxTrackedHosts;
    }
    /**
     * The interval this pacer applies to one host.
     * @param host - the URL host, possibly with a port.
     * @returns the interval in milliseconds; `0` means unspaced.
     */
    intervalOf(host) {
        const override = this.overrides[host];
        if (override !== undefined)
            return override;
        return intervalForHost(host);
    }
    pruneLastRequestTimes() {
        if (this.lastRequestTime.size <= this.maxTrackedHosts)
            return;
        const now = Date.now();
        for (const [h, t] of this.lastRequestTime.entries()) {
            if (now - t > 60_000) {
                this.lastRequestTime.delete(h);
            }
        }
    }
    /**
     * Wait until this host may be called, then reserve the slot.
     * @param host - the URL host.
     * @param signal - the caller's cancellation; aborting rejects instead of
     *   waiting for the slot.
     * @returns resolution once the caller may issue its request.
     */
    async pace(host, signal) {
        if (signal?.aborted) {
            throw signal.reason ?? new Error('Operation aborted');
        }
        const interval = this.intervalOf(host);
        if (interval <= 0)
            return;
        const previous = this.tails.get(host) ?? Promise.resolve();
        let release = () => { };
        const held = new Promise((resolve) => {
            release = resolve;
        });
        // Every link resolves, so one abandoned wait cannot reject the host's chain.
        const tailPromise = previous.then(() => held).catch(() => { });
        this.tails.set(host, tailPromise);
        await previous;
        try {
            const last = this.lastRequestTime.get(host) ?? 0;
            const waitTime = interval - (Date.now() - last);
            if (waitTime > 0)
                await abortableSleep(waitTime, signal);
        }
        finally {
            this.lastRequestTime.set(host, Date.now());
            release();
            if (this.tails.get(host) === tailPromise) {
                this.tails.delete(host);
            }
            this.pruneLastRequestTimes();
        }
    }
}
//# sourceMappingURL=pacing.js.map