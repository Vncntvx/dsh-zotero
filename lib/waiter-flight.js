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
/**
 * Await one shared promise under a caller's signal.
 * @param done - the shared promise.
 * @param signal - the caller's cancellation; absent means an uncancellable caller.
 * @param hooks - the caller's waiter bookkeeping.
 * @returns the shared value, or a rejection with the caller's abort reason.
 */
export async function awaitSharedWaiter(done, signal, hooks = {}) {
    if (signal === undefined)
        return await done;
    hooks.onJoin?.();
    let left = false;
    const leave = (aborted) => {
        if (left)
            return;
        left = true;
        hooks.onLeave?.(aborted);
    };
    if (signal.aborted) {
        leave(true);
        throw signal.reason;
    }
    return await new Promise((resolve, reject) => {
        const onAbort = () => {
            leave(true);
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        done.then((value) => {
            signal.removeEventListener('abort', onAbort);
            leave(false);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            leave(false);
            reject(error);
        });
    });
}
//# sourceMappingURL=waiter-flight.js.map