/**
 * Instance-scoped read identity for the local provider.
 *
 * Zotero 10+ stamps every response with a `Zotero-Server-ID`: the identity
 * of the running database instance. Object keys are unique per instance, not
 * globally, so a listing or record served by instance A must never be
 * consumed to answer a read pinned to instance B — after a profile or
 * database switch, same-key objects are different objects.
 *
 * The provider-wide invariant: **all Zotero objects composing one result
 * must come from the same Server-ID.** Reads carry their claimed identity in
 * a {@link LocalReadContext}; caches and helpers honor it, and a cache entry
 * served under a different identity is treated as stale regardless of TTL.
 * @module dsh-zotero/local/identity
 */
/**
 * Whether a cached listing may answer a read carrying `claimed`. A read
 * without a claim accepts whatever is cached (its TTL bounds staleness); a
 * read with a claim accepts only an entry whose own identity matches — an
 * entry without an identity cannot prove a match and fails closed.
 */
export function cacheEntryMatchesIdentity(cachedServerId, claimed) {
    if (claimed === undefined)
        return true;
    return cachedServerId !== undefined && cachedServerId === claimed;
}
//# sourceMappingURL=identity.js.map