/**
 * Bounded-concurrency task pooling shared by the graph walk and export, plus
 * the process-wide request gate the HTTP client holds every data request in.
 * @module dsh-zotero/concurrency
 */
/**
 * Map `items` through `worker` with at most `concurrency` calls in flight,
 * preserving the input order in the results.
 *
 * Failure is fail-fast and fail-closed: the first worker rejection aborts the
 * pool's signal (so cooperative in-flight workers can cancel their I/O), stops
 * further items from starting, and rethrows that rejection. `options.signal`
 * links caller cancellation into the same pool signal.
 */
export declare function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T, signal: AbortSignal) => Promise<R>, options?: {
    signal?: AbortSignal;
}): Promise<R[]>;
/**
 * An in-flight deduplicated operation shared across concurrent waiters.
 * Tracks waiter count and aborts the underlying controller only when all
 * waiters have detached before settlement.
 */
export interface SharedOperation<T> {
    readonly controller: AbortController;
    promise: Promise<T>;
    waiters: number;
    settled: boolean;
}
/**
 * Await a shared in-flight operation without letting one cancelled waiter abort
 * other live waiters. The underlying request is aborted only when the last waiter
 * detaches.
 */
export declare function awaitSharedOperation<T>(operation: SharedOperation<T>, signal: AbortSignal | undefined): Promise<T>;
/** Thrown when a queued holder is aborted before it ever takes its slot. */
export declare class GateAbortedError extends Error {
    constructor();
}
/**
 * A counted gate: at most `limit` holders at a time, everyone else queues in
 * arrival order.
 *
 * Each pool bounds its own fan-out, but pools multiply, since several
 * concurrent tool calls each start one. The client that every request flows
 * through therefore holds one gate as well, and the load on Zotero is bounded
 * by that number rather than by how many calls happen to run at once.
 *
 * The queue is abortable in both directions: a holder whose signal is already
 * aborted never takes a slot, and a queued one leaves the queue on abort
 * without consuming a slot nobody is going to use. An aborted waiter rejects
 * with {@link GateAbortedError}; the caller translates that into its own
 * cancellation error, because only the caller knows what "aborted" means for
 * its layer.
 */
export declare class ConcurrencyGate {
    private readonly limit;
    private active;
    private readonly waiting;
    constructor(limit: number);
    /**
     * Take a slot.
     * @param signal - the caller's cancellation; aborting it while queued
     *   rejects instead of waiting for a slot.
     * @returns the release function; calling it more than once is a no-op, so
     *   a `finally` release cannot hand out a second slot.
     */
    acquire(signal?: AbortSignal): Promise<() => void>;
    /** Stop listening for a waiter's abort; safe to call for a waiter that never listened. */
    private detach;
    /** The idempotent release handed to one holder. */
    private releaseOf;
}
/**
 * Take one gate slot, translating a queued abort into the same cancellation
 * error a request aborted mid-flight produces. The caller cancelled, and how
 * far the request had got is not part of the contract. `acquire` rejects
 * in exactly one case (a queued holder whose signal was aborted), so the
 * rejection is reported as that cancellation and carried along as its cause:
 * a gate that ever failed for another reason stays visible there rather than
 * being silently reclassified.
 * @param gate - the gate to take the slot from.
 * @param signal - the caller's cancellation.
 * @returns the release function.
 */
export declare function acquireSlot(gate: ConcurrencyGate, signal: AbortSignal | undefined): Promise<() => void>;
//# sourceMappingURL=concurrency.d.ts.map