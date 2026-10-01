/**
 * The scope directory: the cached, identity-checked view of the endpoints
 * that name Zotero's containers — collections and saved searches.
 *
 * Two caches live here, both TTL-bounded and pinned to the Server-ID that
 * served them (a listing from one instance never answers a read pinned to
 * another): the full listings backing scope-name resolution and collection
 * names, and the single collection nodes backing breadcrumb walks. The
 * directory is owned by the provider and rebuilt with it, so a settings
 * commit starts a fresh cache generation.
 * @module dsh-zotero/local/scope-directory
 */
import { type ScopeNameEntry } from '../normalize.js';
import type { ZoteroHttpClient } from '../http-client.js';
import { type LocalReadContext } from './identity.js';
import type { SupportedLocalLibrary, ZoteroItemLevel, ZoteroObjectRef, ZoteroSearchScope, ZoteroResolvedScope } from '../types.js';
/** A cached full listing of one scope endpoint, with the identity header it was served under. */
export interface ScopeListing {
    readonly entries: readonly ScopeNameEntry[];
    readonly serverId?: string;
    /** Fetch time; a cached listing older than the TTL is re-fetched. */
    readonly fetchedAt: number;
}
/** The result of resolving one search scope: its API path plus what it resolved to. */
export interface ResolvedScopeResult {
    readonly path: string;
    readonly resolved: ZoteroResolvedScope;
    readonly serverId?: string;
    /** The collection key a note must belong to for the body scan; library/search scopes are unset. */
    readonly collectionKey?: string;
}
export declare class ScopeDirectory {
    private readonly client;
    private readonly ttlMsOf;
    /** Cached full listings of the scope endpoints, partitioned by library. */
    private readonly scopeListingCache;
    /** In-flight normal requests are shared; forced refreshes get their own key. */
    private readonly scopeListingInFlight;
    /** Monotonic request generations prevent an older response from overwriting a newer one. */
    private nextListingGeneration;
    private readonly latestListingGeneration;
    /** TTL-cached breadcrumb nodes for hierarchical collection walks. */
    private readonly collectionNodeCache;
    /** In-flight breadcrumb node reads, shared so a parallel ancestor walk fetches each key once. */
    private readonly collectionNodeInFlight;
    /**
     * @param client - the HTTP client every listing read rides.
     * @param ttlMsOf - live read of the listing TTL; compared at each lookup,
     * so a settings edit applies without rebuilding the directory.
     */
    constructor(client: ZoteroHttpClient, ttlMsOf: () => number);
    /**
     * The cached full listing of one plural endpoint (`collections` or
     * `searches`), re-fetched when the cached copy is older than the TTL or
     * `force` asks for a fresh answer. Always stored with the identity header
     * it was served under, so later calls keep the listing's own provenance.
     * A read pinned to one instance (a ref carrying `?server=`) never consumes
     * an entry served by a different instance, even inside the TTL window —
     * after a profile or database switch, same-key objects are different
     * objects.
     */
    scopeListingOf(plural: 'collections' | 'searches', ctx: LocalReadContext, signal: AbortSignal | undefined, options?: {
        force?: boolean;
    }): Promise<ScopeListing>;
    /** Fetch and cache one full scope listing for all current waiters. */
    private fetchScopeListing;
    /** Await a shared read; cancel it only after every waiter has detached. */
    private awaitScopeListing;
    /**
     * Resolve a collection or saved search from a ref or a name. A ref fetches
     * that single object (validating existence and reading its name); a name
     * matches client-side over the full listing, since the Local API has no
     * server-side name search for these endpoints.
     */
    resolveNamed(kind: 'collection' | 'search', refOrName: string, effectiveLibrary: SupportedLocalLibrary, signal?: AbortSignal, claimServerId?: string): Promise<{
        ref: ZoteroObjectRef;
        name: string;
    }>;
    /**
     * Collection names for exactly the requested keys, resolved from the cached
     * full listing. One unpaginated listing serves every call; the cached
     * listing is re-fetched when it outlives the scope TTL, so renames and new
     * collections surface without a settings commit.
     */
    collectionNamesFor(keys: readonly string[], library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined): Promise<ReadonlyMap<string, string>>;
    /**
     * Resolve a batch of collection refs, proving each key exists. One cached
     * listing answers every key it carries — the same trust level scope-name
     * resolution already gives writes — and only keys the listing lacks fall
     * back to single-object reads, which also surface the typed 404. A
     * 50-entry membership edit costs one request in the common case instead of
     * one GET per ref. Input order is preserved; a ref naming another library
     * than `library` fails closed before any read.
     */
    resolveCollectionRefs(refs: readonly ZoteroObjectRef[], library: SupportedLocalLibrary, signal: AbortSignal | undefined, claimServerId: string | undefined): Promise<ZoteroObjectRef[]>;
    /**
     * The ancestor names of one collection, walking `parentCollection` links
     * upward from its immediate parent. The walk is sequential (one chain),
     * cycle-guarded by the keys already visited, and stops at an ancestor the
     * API cannot serve — the breadcrumb then reflects only provable names.
     */
    collectionAncestorNames(library: SupportedLocalLibrary, ownKey: string, parentKey: string | undefined, serverId: string | undefined, signal: AbortSignal | undefined): Promise<string[]>;
    /**
     * Drop cached scope state for one library after a collection write.
     * Name→ref resolution reads through a TTL cache, so a deleted collection
     * would otherwise keep resolving until the TTL lapses; creation has the
     * symmetric staleness. Clearing the listing plus the breadcrumb nodes — and
     * advancing the listing generation so an in-flight older response cannot
     * refill the cache — is the only clean fix (`force` only triggers on a miss).
     * @param library - the library whose scope state is stale.
     * @param plural - the scope endpoint to drop; omitted drops both.
     */
    invalidate(library: SupportedLocalLibrary, plural?: 'collections' | 'searches'): void;
    /**
     * One collection node for breadcrumb walks, TTL-cached per library+key and
     * identity-checked like the scope listings. A missing collection resolves
     * to undefined (a phantom parent truncates the path) instead of failing
     * the browse — and that miss is cached for the same TTL, so a phantom
     * parent is not re-fetched on every page of the same walk. Concurrent
     * lookups of the same key share one request.
     */
    private collectionNodeOf;
    private fetchCollectionNode;
}
/** Path segment for the requested item level: `items` for all items, `items/top` for top-level only. */
export declare function itemsSegmentFor(itemLevel?: ZoteroItemLevel): string;
/**
 * Resolve a mixed batch of collection ref strings and exact names through
 * `directory`, preserving input order: ref strings go through
 * {@link ScopeDirectory.resolveCollectionRefs} (one cached listing proves
 * every key it carries, per-key reads only for the rest), names through
 * {@link ScopeDirectory.resolveNamed} (ambiguity-checking, listing-based).
 * Both arms run concurrently; an invalid ref string refuses the whole batch
 * before any network happens.
 */
export declare function resolveCollectionsMixed(directory: ScopeDirectory, inputs: readonly string[], library: SupportedLocalLibrary, signal?: AbortSignal, claimServerId?: string): Promise<ZoteroObjectRef[]>;
/**
 * My Publications item listing: the Local API mirrors the Web API's
 * `/publications/items` scope without a `/top` partition. Pinned to the
 * canonical personal library — callers assert personal-only first.
 */
export declare function publicationsItemsPath(): string;
/** My Publications tag facet over the same listing. */
export declare function publicationsTagsPath(): string;
export interface ResolveScopeOptions {
    readonly signal?: AbortSignal;
    readonly itemLevel?: ZoteroItemLevel;
}
/**
 * Resolve a search scope to the API path the Local API serves it at, plus
 * the resolved shape echoed back to the Agent so pagination replays a stable
 * ref. When `library` is omitted and the scope carries a group ref, the
 * library is inferred from the ref — fail-closed where it cannot be proven.
 */
export declare function resolveScope(directory: ScopeDirectory, scope: ZoteroSearchScope, library: SupportedLocalLibrary | undefined, options?: ResolveScopeOptions): Promise<ResolvedScopeResult>;
//# sourceMappingURL=scope-directory.d.ts.map