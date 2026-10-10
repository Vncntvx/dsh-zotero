/**
 * Instance-scoped read identity for the local provider.
 *
 * Zotero 10+ stamps every response with a `Zotero-Server-ID`: the identity
 * of the running database instance. Object keys are unique per instance, not
 * globally, so a listing or record served by instance A must never be
 * consumed to answer a read pinned to instance B. After a profile or
 * database switch, same-key objects are different objects.
 *
 * The provider-wide invariant: **all Zotero objects composing one result
 * must come from the same Server-ID.** Reads carry their claimed identity in
 * a {@link LocalReadContext}; caches and helpers honor it, and a cache entry
 * served under a different identity is treated as stale regardless of TTL.
 * @module dsh-zotero/local/identity
 */
import { SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH, ZoteroError } from '../errors.js';
/**
 * Assert a response or qualified ref came from the expected instance.
 * Refuses foreign instance mismatches with `ZOTERO_SERVER_MISMATCH`.
 */
export function assertServerIdMatches(observed, expected) {
    if (observed !== undefined && observed !== null && observed !== expected) {
        throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH);
    }
}
/**
 * The instance id two responses composing one result agree on.
 *
 * Two reads issued in parallel can be served by different instances across a
 * profile switch, and merging their rows would attribute one instance's data
 * to the other's identity, the very mix this module forbids. A side that
 * reports no id proves nothing and defers to the other; only two ids that
 * disagree are a mismatch.
 * @param first - the first response's `Zotero-Server-ID`, if it reported one.
 * @param second - the second response's `Zotero-Server-ID`, if it reported one.
 * @returns the agreed id, or undefined when neither side reported one.
 */
export function requireAgreedServerId(first, second) {
    if (first !== undefined && first !== null && second !== undefined && second !== null) {
        if (first !== second) {
            throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH);
        }
        return first;
    }
    return first ?? second ?? undefined;
}
/**
 * Whether a cached listing may answer a read carrying `claimed`. A read
 * without a claim accepts whatever is cached (its TTL bounds staleness); a
 * read with a claim accepts only an entry whose own identity matches. An
 * entry without an identity cannot prove a match and fails closed.
 */
export function cacheEntryMatchesIdentity(cachedServerId, claimed) {
    if (claimed === undefined)
        return true;
    return cachedServerId !== undefined && cachedServerId === claimed;
}
//# sourceMappingURL=identity.js.map