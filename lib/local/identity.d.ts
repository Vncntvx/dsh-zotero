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
import type { SupportedLocalLibrary } from '../types.js';
/**
 * Assert a response or qualified ref came from the expected instance.
 * Refuses foreign instance mismatches with `ZOTERO_SERVER_MISMATCH`.
 */
export declare function assertServerIdMatches(observed: string | null | undefined, expected: string | null | undefined): void;
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
export declare function requireAgreedServerId(first: string | null | undefined, second: string | null | undefined): string | undefined;
/**
 * The library a read targets plus the instance identity it is pinned to.
 * `serverId` is omitted when the caller makes no provenance claim (e.g. a
 * first-page discovery call); present when answering a ref that carries
 * `?server=`, so every object feeding the result provably comes from that
 * instance.
 */
export interface LocalReadContext {
    readonly library: SupportedLocalLibrary;
    readonly serverId?: string;
}
/**
 * Whether a cached listing may answer a read carrying `claimed`. A read
 * without a claim accepts whatever is cached (its TTL bounds staleness); a
 * read with a claim accepts only an entry whose own identity matches. An
 * entry without an identity cannot prove a match and fails closed.
 */
export declare function cacheEntryMatchesIdentity(cachedServerId: string | undefined, claimed: string | undefined): boolean;
//# sourceMappingURL=identity.d.ts.map