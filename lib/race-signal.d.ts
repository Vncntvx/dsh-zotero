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
export declare function raceWithSignal<T>(promise: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T>;
//# sourceMappingURL=race-signal.d.ts.map