/**
 * The one shared spelling of "this wait can be cut short": race a promise
 * against an abort signal, reject with the signal's reason, and remove the
 * listener once either side settles.
 *
 * Deliberately dependency-free: the scholarly transport's pure module
 * (`network.ts`) must stay clear of node and undici declaration files, so
 * this cannot live beside the rest of the concurrency pool.
 * @module dsh-zotero/race-signal
 */
/**
 * Resolve with `promise`, or reject as soon as `signal` aborts — with
 * `signal.reason`, or a plain `Error('Operation aborted')` when it carries
 * none. An undefined signal passes the promise through; an already-aborted
 * signal rejects before the promise is touched.
 */
export async function raceWithSignal(promise, signal) {
    if (signal === undefined)
        return await promise;
    if (signal.aborted)
        throw signal.reason ?? new Error('Operation aborted');
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('Operation aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([promise, aborted]);
    }
    finally {
        if (onAbort !== undefined)
            signal.removeEventListener('abort', onAbort);
    }
}
//# sourceMappingURL=race-signal.js.map