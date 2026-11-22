/**
 * The one shared spelling of "this wait can be cut short": race a promise
 * against an abort signal, reject with the signal's reason, and remove the
 * listener once either side settles.
 *
 * Dependency-free: the scholarly transport's pure module
 * (`network.ts`) must stay clear of node and undici declaration files, so
 * this cannot live beside the rest of the concurrency pool, and the client
 * bundle imports the waiter below from here too.
 * @module dsh-zotero/race-signal
 */
/**
 * Resolve with `promise`, or reject as soon as `signal` aborts — with
 * `signal.reason`, or a plain `Error('Operation aborted')` when it carries
 * none. An undefined signal passes the promise through; an already-aborted
 * signal rejects before the promise is touched.
 */
export declare function raceWithSignal<T>(promise: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T>;
/** The caller's bookkeeping hooks around one shared promise. */
interface WaiterHooks {
    /** A caller is about to wait. */
    readonly onJoin?: () => void;
    /** The caller left: `aborted` distinguishes its own cancellation from settlement. */
    readonly onLeave?: (aborted: boolean) => void;
}
/**
 * Await one shared promise under a caller's signal.
 *
 * The data plane, the semantic vector cache, and the semantic loader share one
 * wire/encoder promise among callers; each caller may leave without cancelling
 * the work another caller still waits for. The wiring owns the join/leave
 * bookkeeping once, and the shared promise is always observed (through the
 * race) so an abandoned flight is never an unhandled rejection. An undefined
 * signal bypasses the hooks: no join is counted.
 * @param done - the shared promise.
 * @param signal - the caller's cancellation; absent means an uncancellable caller.
 * @param hooks - the caller's waiter bookkeeping.
 * @returns the shared value, or a rejection with the caller's abort reason.
 */
export declare function awaitSharedWaiter<T>(done: Promise<T>, signal: AbortSignal | undefined, hooks?: WaiterHooks): Promise<T>;
export {};
//# sourceMappingURL=race-signal.d.ts.map