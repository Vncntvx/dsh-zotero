/**
 * The scope directory: the cached, identity-checked view of the endpoints
 * that name Zotero's containers (collections and saved searches).
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
import { ZOTERO_SERVER_ID_HEADER } from '../constants.js'
import { awaitSharedOperation, type SharedOperation } from '../concurrency.js'
import {
  isNotFoundError,
  TOOL_ABORTED_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_INVALID_REF,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../errors.js'
import {
  assertPublicationsSupported,
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
import { requireArrayBody } from './pagination.js'
import type {
  SupportedLocalLibrary,
  ZoteroItemLevel,
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
 * claim only when the build omits the header, since storing the claim alone
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
  private readonly ttlMsOf: () => number

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

  /**
   * @param client - the HTTP client every listing read rides.
   * @param ttlMsOf - live read of the listing TTL; compared at each lookup,
   * so a settings edit applies without rebuilding the directory.
   */
  constructor(client: ZoteroHttpClient, ttlMsOf: () => number) {
    this.client = client
    this.ttlMsOf = ttlMsOf
  }

  /**
   * The cached full listing of one plural endpoint (`collections` or
   * `searches`), re-fetched when the cached copy is older than the TTL or
   * `force` asks for a fresh answer. Always stored with the identity header
   * it was served under, so later calls keep the listing's own provenance.
   * A read pinned to one instance (a ref carrying `?server=`) never consumes
   * an entry served by a different instance, even inside the TTL window:
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
      Date.now() - cached.fetchedAt < this.ttlMsOf() &&
      cacheEntryMatchesIdentity(cached.serverId, ctx.serverId)
    ) {
      return cached
    }
    // A forced refresh must not join a normal read: that answer may predate
    // what the caller is asking for (the caller forced precisely because the
    // cached one missed). Two forced refreshes, by contrast, want the same
    // fresh answer and share the one request, because a per-call counter in
    // this key would give each its own, defeating the in-flight map. A stable
    // key keeps the two classes apart while letting each dedupe within itself.
    const requestKey = `${key}:${ctx.serverId ?? ''}:${options.force === true ? 'force' : 'normal'}`
    const existing = this.scopeListingInFlight.get(requestKey)
    const latestGeneration = this.latestListingGeneration.get(key)
    // Do not let a later normal caller join an older answer: generation
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

    const generation = ++this.nextListingGeneration
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
    const rows = requireArrayBody(json, `${ctx.library.type} ${plural}`)
    const entries = rows.map((row) => normalizeScopeEntry(row))
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
      // The ref is authority: an answer that names a different object is a
      // contract breach, not a silent re-point (write-domain's readItem
      // enforces the same rule).
      if (entry.key !== ref.key) {
        throw new ZoteroError(
          `Zotero answered the scope read with a different object than ${ref.key}; the response cannot be used.`,
          ZOTERO_UNEXPECTED,
        )
      }
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
   * Resolve a batch of collection refs, proving each key exists. One cached
   * listing answers every key it carries (the same trust level scope-name
   * resolution already gives writes), and only keys the listing lacks fall
   * back to single-object reads, which also surface the typed 404. A
   * 50-entry membership edit costs one request in the common case instead of
   * one GET per ref. Input order is preserved; a ref naming another library
   * than `library` fails closed before any read.
   */
  async resolveCollectionRefs(
    refs: readonly ZoteroObjectRef[],
    library: SupportedLocalLibrary,
    signal: AbortSignal | undefined,
    claimServerId: string | undefined,
  ): Promise<ZoteroObjectRef[]> {
    if (refs.length === 0) return []
    const checked = refs.map((ref) => {
      const supported = requireSupportedLocalRef(ref, ['collection'])
      if (!sameLibrary(supported.library as SupportedLocalLibrary, library)) {
        throw new ZoteroError(
          `Library mismatch: scope ref is ${supported.library.type}/${supported.library.id} ` +
            `but request library is ${library.type}/${library.id}.`,
          ZOTERO_INVALID_ARGUMENT,
        )
      }
      return supported
    })
    const listing = await this.scopeListingOf(
      'collections',
      { library, serverId: claimServerId },
      signal,
    )
    const byKey = new Map(listing.entries.map((entry) => [entry.key, entry]))
    const resolved: ZoteroObjectRef[] = new Array(checked.length)
    const missing: { index: number; key: string; claim: string | undefined }[] = []
    checked.forEach((ref, index) => {
      // The listing may only answer a ref it can prove: a ref that claims a
      // specific serving instance (`?server=`) must match the listing's own
      // identity, or it falls through to a live read whose served-by identity
      // the caller can judge. A cross-instance ref is never silently
      // re-pointed at this instance's object.
      const listed = byKey.get(ref.key)
      const claim = ref.serverId ?? claimServerId
      if (
        listed !== undefined &&
        (ref.serverId === undefined || ref.serverId === listing.serverId)
      ) {
        resolved[index] = refForLibrary(library, 'collection', ref.key, listing.serverId)
      } else {
        missing.push({ index, key: ref.key, claim })
      }
    })
    await Promise.all(
      missing.map(async ({ index, key, claim }) => {
        const { json, headers } = await this.client.getJson<unknown>(
          `${libraryPrefix(library)}/collections/${key}`,
          undefined,
          { signal, serverId: claim },
        )
        const entry = normalizeScopeEntry(json)
        // The ref is authority: an answer that names a different object is a
        // contract breach, not a silent re-point.
        if (entry.key !== key) {
          throw new ZoteroError(
            `Zotero answered the collection read with a different object than ${key}; the response cannot be used.`,
            ZOTERO_UNEXPECTED,
          )
        }
        resolved[index] = refForLibrary(library, 'collection', key, resolveServedBy(headers, claim))
      }),
    )
    return resolved
  }

  /**
   * The ancestor names of one collection, walking `parentCollection` links
   * upward from its immediate parent. The walk is sequential (one chain),
   * cycle-guarded by the keys already visited, and stops at an ancestor the
   * API cannot serve, so the breadcrumb reflects only provable names.
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
   * Drop cached scope state for one library after a collection write.
   * Name→ref resolution reads through a TTL cache, so a deleted collection
   * would otherwise keep resolving until the TTL lapses; creation has the
   * symmetric staleness. Clearing the listing plus the breadcrumb nodes, and
   * advancing the listing generation so an in-flight older response cannot
   * refill the cache, is the only clean fix (`force` only triggers on a miss).
   * @param library - the library whose scope state is stale.
   * @param plural - the scope endpoint to drop; omitted drops both.
   */
  invalidate(library: SupportedLocalLibrary, plural?: 'collections' | 'searches'): void {
    const plurals: readonly ('collections' | 'searches')[] =
      plural === undefined ? (['collections', 'searches'] as const) : [plural]
    for (const scope of plurals) {
      const key = cacheKey(library, scope)
      this.scopeListingCache.delete(key)
      // Advance past any in-flight fetch so its older generation cannot
      // repopulate the cache it just cleared.
      this.latestListingGeneration.set(key, ++this.nextListingGeneration)
    }
    const prefix = `${library.type}:${library.id}:collections:`
    for (const nodeKey of [...this.collectionNodeCache.keys()]) {
      if (nodeKey.startsWith(prefix)) this.collectionNodeCache.delete(nodeKey)
    }
  }

  /**
   * One collection node for breadcrumb walks, TTL-cached per library+key and
   * identity-checked like the scope listings. A missing collection resolves
   * to undefined (a phantom parent truncates the path) instead of failing
   * the browse, and that miss is cached for the same TTL, so a phantom
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
      Date.now() - cached.fetchedAt < this.ttlMsOf() &&
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
      if (entry.key !== key) {
        throw new ZoteroError(
          `Zotero answered the collection read with a different object than ${key}; the response cannot be used.`,
          ZOTERO_UNEXPECTED,
        )
      }
      const node: CollectionNode = {
        name: entry.name,
        ...(entry.parentKey !== undefined ? { parentKey: entry.parentKey } : {}),
      }
      // Pin the serving identity from the response headers (falling back to
      // the claim only when the build omits the header), like scopeListingOf:
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

/** Path segment for the requested item level: `items` for all items, `items/top` for top-level only. */
export function itemsSegmentFor(itemLevel?: ZoteroItemLevel): string {
  return itemLevel === 'all' ? 'items' : 'items/top'
}

/**
 * Resolve a mixed batch of collection ref strings and exact names through
 * `directory`, preserving input order: ref strings go through
 * {@link ScopeDirectory.resolveCollectionRefs} (one cached listing proves
 * every key it carries, per-key reads only for the rest), names through
 * {@link ScopeDirectory.resolveNamed} (ambiguity-checking, listing-based).
 * Both arms run concurrently; an invalid ref string refuses the whole batch
 * before any network happens.
 */
export async function resolveCollectionsMixed(
  directory: ScopeDirectory,
  inputs: readonly string[],
  library: SupportedLocalLibrary,
  signal?: AbortSignal,
  claimServerId?: string,
): Promise<ZoteroObjectRef[]> {
  if (inputs.length === 0) return []
  const refInputs: { index: number; ref: ZoteroObjectRef }[] = []
  const nameInputs: { index: number; name: string }[] = []
  inputs.forEach((input, index) => {
    if (isRefString(input)) refInputs.push({ index, ref: parseRef(input) })
    else nameInputs.push({ index, name: input })
  })
  const [refResults, nameResults] = await Promise.all([
    directory.resolveCollectionRefs(
      refInputs.map((entry) => entry.ref),
      library,
      signal,
      claimServerId,
    ),
    Promise.all(
      nameInputs.map((entry) =>
        directory
          .resolveNamed('collection', entry.name, library, signal, claimServerId)
          .then((resolved) => resolved.ref),
      ),
    ),
  ])
  const results: ZoteroObjectRef[] = new Array(inputs.length)
  refInputs.forEach((entry, position) => {
    results[entry.index] = refResults[position]!
  })
  nameInputs.forEach((entry, position) => {
    results[entry.index] = nameResults[position]!
  })
  return results
}

/**
 * My Publications item listing: the Local API mirrors the Web API's
 * `/publications/items` scope without a `/top` partition. Pinned to the
 * canonical personal library; callers assert personal-only first.
 */
export function publicationsItemsPath(): string {
  return `${libraryPrefix(PERSONAL_LIBRARY)}/publications/items`
}

/** My Publications tag facet over the same listing. */
export function publicationsTagsPath(): string {
  return `${publicationsItemsPath()}/tags`
}

export interface ResolveScopeOptions {
  readonly signal?: AbortSignal
  readonly itemLevel?: ZoteroItemLevel
}

/**
 * Resolve a search scope to the API path the Local API serves it at, plus
 * the resolved shape echoed back to the Agent so pagination replays a stable
 * ref. When `library` is omitted and the scope carries a group ref, the
 * library is inferred from the ref and the resolution fails closed where it
 * cannot be proven.
 */
export async function resolveScope(
  directory: ScopeDirectory,
  scope: ZoteroSearchScope,
  library: SupportedLocalLibrary | undefined,
  options: ResolveScopeOptions = {},
): Promise<ResolvedScopeResult> {
  const { signal, itemLevel = 'top' } = options
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
  const itemsSegment = itemsSegmentFor(itemLevel)
  switch (scope.kind) {
    case 'library':
      return effectiveLibrary.type === 'user'
        ? {
            path: `${libraryPrefix(PERSONAL_LIBRARY)}/${itemsSegment}`,
            resolved: { kind: 'library', library: { type: 'user', id: 0 } },
          }
        : {
            path: `${libraryPrefix(effectiveLibrary)}/${itemsSegment}`,
            resolved: { kind: 'library', library: { type: 'group', id: effectiveLibrary.id } },
          }
    case 'publications':
      assertPublicationsSupported(effectiveLibrary)
      return {
        path: publicationsItemsPath(),
        resolved: { kind: 'publications', library: { type: 'user', id: 0 } },
      }
    case 'collection': {
      const found = await directory.resolveNamed(
        'collection',
        scope.refOrName,
        effectiveLibrary,
        signal,
      )
      return {
        path: `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/collections/${found.ref.key}/${itemsSegment}`,
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
      // Saved searches mirror publications: the endpoint serves one item
      // listing with no /top partition, so itemLevel does not apply here. It
      // governs library/collection scopes only.
      return {
        path: `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/searches/${found.ref.key}/items`,
        resolved: { kind: 'savedSearch', ref: formatRef(found.ref), name: found.name },
        serverId: found.ref.serverId,
      }
    }
  }
}
