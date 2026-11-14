/**
 * One shared read awaited under a caller's own cancellation.
 *
 * The data plane and the semantic vector cache both share one wire/encoder
 * promise among callers; each caller may leave without cancelling the work
 * another caller still waits for. This module owns the join/abort wiring once:
 * the caller supplies its waiter bookkeeping, and the shared promise is
 * observed so an abandoned flight is never an unhandled rejection.
 * @module dsh-zotero/waiter-flight
 */
/** The caller's bookkeeping hooks around one shared promise. */
export interface WaiterHooks {
    /** A caller is about to wait. */
    readonly onJoin?: () => void;
    /** The caller left: `aborted` distinguishes its own cancellation from settlement. */
    readonly onLeave?: (aborted: boolean) => void;
}
/**
 * Await one shared promise under a caller's signal.
 * @param done - the shared promise.
 * @param signal - the caller's cancellation; absent means an uncancellable caller.
 * @param hooks - the caller's waiter bookkeeping.
 * @returns the shared value, or a rejection with the caller's abort reason.
 */
export declare function awaitSharedWaiter<T>(done: Promise<T>, signal: AbortSignal | undefined, hooks?: WaiterHooks): Promise<T>;
//# sourceMappingURL=waiter-flight.d.ts.map