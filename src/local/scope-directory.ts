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

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { ZOTERO_SCOPE_LISTING_TTL_MS, ZOTERO_SERVER_ID_HEADER } from '../constants.js'
import { awaitSharedOperation, type SharedOperation } from '../concurrency.js'
import {
  isNotFoundError,
  TOOL_ABORTED_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_INVALID_REF,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZoteroError,
} from '../errors.js'
import {
  formatRef,
  isRefString,
  isSupportedLocalLibrary,
  libraryPrefix,
  parseRef,
  requireSupportedLocalRef,
  refForLibrary,
  sameLibrary,
  unsupportedLibraryMessage,
  PERSONAL_LIBRARY,
} from '../refs.js'
import {
  matchScopeName,
  nearScopeCandidates,
  normalizeScopeEntry,
  type ScopeNameEntry,
} from '../normalize.js'
import type { ZoteroHttpClient } from '../http-client.js'
import { cacheEntryMatchesIdentity, type LocalReadContext } from './identity.js'
import type {
  GroupLibrary,
  PersonalLibrary,
  SupportedLocalLibrary,
  ZoteroObjectRef,
  ZoteroSearchScope,
  ZoteroResolvedScope,
} from '../types.js'

/** A cached full listing of one scope endpoint, with the identity header it was served under. */
export interface ScopeListing {
  readonly entries: readonly ScopeNameEntry[]
  readonly serverId?: string
  /** Fetch time; a cached listing older than the TTL is re-fetched. */
  readonly fetchedAt: number
}

interface ScopeListingOperation extends SharedOperation<ScopeListing> {
  readonly generation: number
}

/** One collection node of a breadcrumb walk: its name and optional parent link. */
interface CollectionNode {
  readonly name: string
  readonly parentKey?: string
}

/** A TTL-cached breadcrumb node with the identity that served it. `node: undefined` is a cached 404. */
interface CachedCollectionNode {
  readonly node: CollectionNode | undefined
  readonly serverId?: string
  readonly fetchedAt: number
}

function cacheKey(library: SupportedLocalLibrary, plural: 'collections' | 'searches'): string {
  return `${library.type}:${library.id}:${plural}`
}

/**
 * Pin the serving identity from the response headers, falling back to the
 * claim only when the build omits the header — storing the claim alone
 * leaves a headerless first read unclaimable.
 * @param headers - the response headers.
 * @param claim - the identity the request was pinned to, if any.
 * @returns the serving identity, or undefined when neither names one.
 */
function resolveServedBy(headers: Headers, claim: string | undefined): string | undefined {
  return headers.get(ZOTERO_SERVER_ID_HEADER) ?? claim
}

/** The result of resolving one search scope: its API path plus what it resolved to. */
export interface ResolvedScopeResult {
  readonly path: string
  readonly resolved: ZoteroResolvedScope
  readonly serverId?: string
  /** The collection key a note must belong to for the body scan; library/search scopes are unset. */
  readonly collectionKey?: string
}

export class ScopeDirectory {
  private readonly client: ZoteroHttpClient
  private readonly ttlMs: number

  /** Cached full listings of the scope endpoints, partitioned by library. */
  private readonly scopeListingCache = new Map<string, ScopeListing>()

  /** In-flight normal requests are shared; forced refreshes get their own key. */
  private readonly scopeListingInFlight = new Map<string, ScopeListingOperation>()

  /** Monotonic request generations prevent an older response from overwriting a newer one. */
  private nextListingGeneration = 0
  private readonly latestListingGeneration = new Map<string, number>()

  /** TTL-cached breadcrumb nodes for hierarchical collection walks. */
  private readonly collectionNodeCache = new Map<string, CachedCollectionNode>()

  /** In-flight breadcrumb node reads, shared so a parallel ancestor walk fetches each key once. */
  private readonly collectionNodeInFlight = new Map<
    string,
    SharedOperation<CollectionNode | undefined>
  >()

  constructor(client: ZoteroHttpClient, ttlMs: number = ZOTERO_SCOPE_LISTING_TTL_MS) {
    this.client = client
    this.ttlMs = ttlMs
  }

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
  async scopeListingOf(
    plural: 'collections' | 'searches',
    ctx: LocalReadContext,
    signal: AbortSignal | undefined,
    options: { force?: boolean } = {},
  ): Promise<ScopeListing> {
    if (signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
    const key = cacheKey(ctx.library, plural)
    const cached = this.scopeListingCache.get(key)
    if (
      !options.force &&
      cached !== undefined &&
      Date.now() - cached.fetchedAt < this.ttlMs &&
      cacheEntryMatchesIdentity(cached.serverId, ctx.serverId)
    ) {
      return cached
    }
    const forcedGeneration = options.force === true ? ++this.nextListingGeneration : undefined
    const requestKey = `${key}:${ctx.serverId ?? ''}:${
      forcedGeneration === undefined ? 'normal' : `force:${forcedGeneration}`
    }`
    const existing = this.scopeListingInFlight.get(requestKey)
    const latestGeneration = this.latestListingGeneration.get(key)
    // A normal operation may still be in flight when a forced refresh starts.
    // Do not let a later normal caller join that older answer: generation
    // ordering protects the cache, and the arriving caller must receive the
    // same freshness guarantee as the cache.
    const canShare =
      existing !== undefined &&
      !existing.controller.signal.aborted &&
      !existing.settled &&
      (latestGeneration === undefined || existing.generation >= latestGeneration)
    if (existing !== undefined && canShare) {
      return await this.awaitScopeListing(existing, signal)
    }
    if (existing !== undefined) this.scopeListingInFlight.delete(requestKey)
    if (options.force === true) this.scopeListingCache.delete(key)

    const generation = forcedGeneration ?? ++this.nextListingGeneration
    this.latestListingGeneration.set(key, generation)
    const operation: ScopeListingOperation = {
      controller: new AbortController(),
      generation,
      promise: Promise.resolve({ entries: [], fetchedAt: 0 }),
      waiters: 0,
      settled: false,
    }
    operation.promise = this.fetchScopeListing(
      plural,
      ctx,
      operation.controller.signal,
      generation,
    ).finally(() => {
      operation.settled = true
      if (this.scopeListingInFlight.get(requestKey) === operation) {
        this.scopeListingInFlight.delete(requestKey)
      }
    })
    // A sole cancelled waiter leaves nobody to consume the shared rejection.
    void operation.promise.catch(() => undefined)
    this.scopeListingInFlight.set(requestKey, operation)
    return await this.awaitScopeListing(operation, signal)
  }

  /** Fetch and cache one full scope listing for all current waiters. */
  private async fetchScopeListing(
    plural: 'collections' | 'searches',
    ctx: LocalReadContext,
    signal: AbortSignal,
    generation: number,
  ): Promise<ScopeListing> {
    const prefix = libraryPrefix(ctx.library)
    const { json, headers } = await this.client.getJson<unknown>(`${prefix}/${plural}`, undefined, {
      signal,
      serverId: ctx.serverId,
    })
    const entries = (Array.isArray(json) ? json : []).map((row) => normalizeScopeEntry(row))
    const servedBy = resolveServedBy(headers, ctx.serverId)
    const listing: ScopeListing =
      servedBy === undefined
        ? { entries, fetchedAt: Date.now() }
        : { entries, serverId: servedBy, fetchedAt: Date.now() }
    const key = cacheKey(ctx.library, plural)
    // A response from an older request must not replace a listing already
    // refreshed by a later request. The caller still receives its own answer;
    // only the shared cache follows freshness order.
    const latest = this.latestListingGeneration.get(key)
    if (latest === undefined || latest <= generation) {
      this.latestListingGeneration.set(key, generation)
      this.scopeListingCache.set(key, listing)
    }
    return listing
  }

  /** Await a shared read; cancel it only after every waiter has detached. */
  private async awaitScopeListing(
    operation: ScopeListingOperation,
    signal: AbortSignal | undefined,
  ): Promise<ScopeListing> {
    return await awaitSharedOperation(operation, signal)
  }

  /**
   * Resolve a collection or saved search from a ref or a name. A ref fetches
   * that single object (validating existence and reading its name); a name
   * matches client-side over the full listing, since the Local API has no
   * server-side name search for these endpoints.
   */
  async resolveNamed(
    kind: 'collection' | 'search',
    refOrName: string,
    effectiveLibrary: SupportedLocalLibrary,
    signal?: AbortSignal,
    claimServerId?: string,
  ): Promise<{ ref: ZoteroObjectRef; name: string }> {
    const plural = kind === 'collection' ? 'collections' : 'searches'
    if (isRefString(refOrName)) {
      const ref = requireSupportedLocalRef(parseRef(refOrName), [kind])
      // ref is authority; if caller also supplied library and it diverges, fail closed
      if (!sameLibrary(ref.library as SupportedLocalLibrary, effectiveLibrary)) {
        throw new ZoteroError(
          `Library mismatch: scope ref is ${ref.library.type}/${ref.library.id} but request library is ${effectiveLibrary.type}/${effectiveLibrary.id}. ` +
            `If the ref is a group collection/search, pass library:{type:'group',id:<groupId>} matching the ref, or omit library to infer from the ref.`,
          ZOTERO_INVALID_ARGUMENT,
        )
      }
      const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
      const claim = ref.serverId ?? claimServerId
      const { json, headers } = await this.client.getJson<unknown>(
        `${prefix}/${plural}/${ref.key}`,
        undefined,
        {
          signal,
          serverId: claim,
        },
      )
      const entry = normalizeScopeEntry(json)
      return {
        ref: refForLibrary(
          ref.library as SupportedLocalLibrary,
          kind,
          entry.key,
          resolveServedBy(headers, claim),
        ),
        name: entry.name,
      }
    }
    // Name resolution matches over the effective library's full listing.
    let listing = await this.scopeListingOf(
      plural,
      { library: effectiveLibrary, serverId: claimServerId },
      signal,
    )
    let matched = matchScopeName(listing.entries, refOrName)
    if (matched.length === 0) {
      listing = await this.scopeListingOf(
        plural,
        { library: effectiveLibrary, serverId: claimServerId },
        signal,
        { force: true },
      )
      matched = matchScopeName(listing.entries, refOrName)
    }
    if (matched.length === 1) {
      const found = matched[0]!
      return {
        ref: refForLibrary(effectiveLibrary, kind, found.key, listing.serverId),
        name: found.name,
      }
    }
    const label = kind === 'collection' ? 'collection' : 'saved search'
    if (matched.length > 1) {
      const list = matched
        .slice(0, 5)
        .map((entry) => formatRef(refForLibrary(effectiveLibrary, kind, entry.key)))
        .join(', ')
      throw new ZoteroError(
        `More than one ${label} matches "${refOrName}". Pick one of: ${list}`,
        ZOTERO_SCOPE_AMBIGUOUS,
      )
    }
    const near = nearScopeCandidates(listing.entries, refOrName, 5)
    const hint =
      near.length > 0 ? ` Possible matches: ${near.map((entry) => entry.name).join(', ')}` : ''
    throw new ZoteroError(`No ${label} named "${refOrName}" was found.${hint}`, ZOTERO_NOT_FOUND)
  }

  /**
   * Collection names for exactly the requested keys, resolved from the cached
   * full listing. One unpaginated listing serves every call; the cached
   * listing is re-fetched when it outlives the scope TTL, so renames and new
   * collections surface without a settings commit.
   */
  async collectionNamesFor(
    keys: readonly string[],
    library: SupportedLocalLibrary,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ReadonlyMap<string, string>> {
    const listing = await this.scopeListingOf('collections', { library, serverId }, signal)
    const wanted = new Set(keys)
    return new Map(
      listing.entries
        .filter((entry) => wanted.has(entry.key))
        .map((entry) => [entry.key, entry.name]),
    )
  }

  /**
   * The ancestor names of one collection, walking `parentCollection` links
   * upward from its immediate parent. The walk is sequential (one chain),
   * cycle-guarded by the keys already visited, and stops at an ancestor the
   * API cannot serve — the breadcrumb then reflects only provable names.
   */
  async collectionAncestorNames(
    library: SupportedLocalLibrary,
    ownKey: string,
    parentKey: string | undefined,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string[]> {
    const names: string[] = []
    const visited = new Set<string>([ownKey])
    let current = parentKey
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      const node = await this.collectionNodeOf(library, current, serverId, signal)
      if (node === undefined) break
      names.unshift(node.name)
      current = node.parentKey
    }
    return names
  }

  /**
   * One collection node for breadcrumb walks, TTL-cached per library+key and
   * identity-checked like the scope listings. A missing collection resolves
   * to undefined (a phantom parent truncates the path) instead of failing
   * the browse — and that miss is cached for the same TTL, so a phantom
   * parent is not re-fetched on every page of the same walk. Concurrent
   * lookups of the same key share one request.
   */
  private async collectionNodeOf(
    library: SupportedLocalLibrary,
    key: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<CollectionNode | undefined> {
    if (signal?.aborted) throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED)
    const nodeCacheKey = `${cacheKey(library, 'collections')}:${key}`
    const cached = this.collectionNodeCache.get(nodeCacheKey)
    if (
      cached !== undefined &&
      Date.now() - cached.fetchedAt < this.ttlMs &&
      cacheEntryMatchesIdentity(cached.serverId, serverId)
    ) {
      return cached.node
    }
    let operation = this.collectionNodeInFlight.get(nodeCacheKey)
    if (operation === undefined || operation.settled || operation.controller.signal.aborted) {
      const controller = new AbortController()
      const op: SharedOperation<CollectionNode | undefined> = {
        controller,
        promise: Promise.resolve(undefined),
        waiters: 0,
        settled: false,
      }
      op.promise = this.fetchCollectionNode(library, key, serverId, controller.signal).finally(
        () => {
          op.settled = true
          if (this.collectionNodeInFlight.get(nodeCacheKey) === op) {
            this.collectionNodeInFlight.delete(nodeCacheKey)
          }
        },
      )
      void op.promise.catch(() => undefined)
      this.collectionNodeInFlight.set(nodeCacheKey, op)
      operation = op
    }
    return await awaitSharedOperation(operation, signal)
  }

  private async fetchCollectionNode(
    library: SupportedLocalLibrary,
    key: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<CollectionNode | undefined> {
    const nodeCacheKey = `${cacheKey(library, 'collections')}:${key}`
    try {
      const { json, headers } = await this.client.getJson<unknown>(
        `${libraryPrefix(library)}/collections/${key}`,
        undefined,
        { signal, serverId },
      )
      const entry = normalizeScopeEntry(json)
      const node: CollectionNode = {
        name: entry.name,
        ...(entry.parentKey !== undefined ? { parentKey: entry.parentKey } : {}),
      }
      // Pin the serving identity from the response headers (falling back to
      // the claim only when the build omits the header), like scopeListingOf —
      // storing the claim alone leaves a headerless first read unclaimable.
      const servedBy = resolveServedBy(headers, serverId)
      this.collectionNodeCache.set(nodeCacheKey, {
        node,
        ...(servedBy !== undefined ? { serverId: servedBy } : {}),
        fetchedAt: Date.now(),
      })
      return node
    } catch (error) {
      if (isNotFoundError(error)) {
        this.collectionNodeCache.set(nodeCacheKey, {
          node: undefined,
          ...(serverId !== undefined ? { serverId } : {}),
          fetchedAt: Date.now(),
        })
        return undefined
      }
      throw error
    }
  }
}

/**
 * Resolve a search scope to the API path the Local API serves it at, plus
 * the resolved shape echoed back to the Agent so pagination replays a stable
 * ref. When `library` is omitted and the scope carries a group ref, the
 * library is inferred from the ref — fail-closed where it cannot be proven.
 */
export async function resolveScope(
  directory: ScopeDirectory,
  scope: ZoteroSearchScope,
  library: SupportedLocalLibrary | undefined,
  signal?: AbortSignal,
): Promise<ResolvedScopeResult> {
  let effectiveLibrary: SupportedLocalLibrary
  if (library !== undefined) {
    effectiveLibrary = library
  } else if (
    (scope.kind === 'collection' || scope.kind === 'savedSearch') &&
    isRefString(scope.refOrName)
  ) {
    const parsed = parseRef(scope.refOrName)
    if (isSupportedLocalLibrary(parsed.library)) {
      effectiveLibrary = parsed.library as SupportedLocalLibrary
    } else {
      throw new ZoteroError(unsupportedLibraryMessage(parsed.library), ZOTERO_INVALID_REF)
    }
  } else {
    effectiveLibrary = PERSONAL_LIBRARY
  }
  switch (scope.kind) {
    case 'library':
      return effectiveLibrary.type === 'user'
        ? {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/items/top`,
            resolved: { kind: 'library', library: { type: 'user', id: 0 } },
          }
        : {
            path: `${libraryPrefix(effectiveLibrary)}/items/top`,
            resolved: { kind: 'library', library: { type: 'group', id: effectiveLibrary.id } },
          }
    case 'publications':
      // My Publications: the Local API mirrors the Web API's
      // /publications/items scope, so published works are one hop away.
      return effectiveLibrary.type === 'user'
        ? {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/publications/items/top`,
            resolved: { kind: 'publications', library: { type: 'user', id: 0 } },
          }
        : {
            path: `${libraryPrefix(effectiveLibrary)}/publications/items/top`,
            resolved: { kind: 'publications', library: { type: 'group', id: effectiveLibrary.id } },
          }
    case 'collection': {
      const found = await directory.resolveNamed(
        'collection',
        scope.refOrName,
        effectiveLibrary,
        signal,
      )
      return {
        path: `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/collections/${found.ref.key}/items/top`,
        resolved: { kind: 'collection', ref: formatRef(found.ref), name: found.name },
        serverId: found.ref.serverId,
        collectionKey: found.ref.key,
      }
    }
    case 'savedSearch': {
      const found = await directory.resolveNamed(
        'search',
        scope.refOrName,
        effectiveLibrary,
        signal,
      )
      return {
        path: `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/searches/${found.ref.key}/items`,
        resolved: { kind: 'savedSearch', ref: formatRef(found.ref), name: found.name },
        serverId: found.ref.serverId,
      }
    }
  }
}
