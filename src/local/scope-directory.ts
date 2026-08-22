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

import { ZOTERO_SCOPE_LISTING_TTL_MS } from '../constants.js'
import {
  isNotFoundError,
  ZOTERO_INVALID_ARGUMENT,
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

/** One collection node of a breadcrumb walk: its name and optional parent link. */
interface CollectionNode {
  readonly name: string
  readonly parentKey?: string
}

/** A TTL-cached breadcrumb node with the identity that served it. */
interface CachedCollectionNode {
  readonly node: CollectionNode
  readonly serverId?: string
  readonly fetchedAt: number
}

function cacheKey(library: SupportedLocalLibrary, plural: 'collections' | 'searches'): string {
  return `${library.type}:${library.id}:${plural}`
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

  /** TTL-cached breadcrumb nodes for hierarchical collection walks. */
  private readonly collectionNodeCache = new Map<string, CachedCollectionNode>()

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
    const prefix = libraryPrefix(ctx.library)
    const { json, headers } = await this.client.getJson<unknown>(`${prefix}/${plural}`, undefined, {
      signal,
      serverId: ctx.serverId,
    })
    const entries = (Array.isArray(json) ? json : []).map((row) => normalizeScopeEntry(row))
    const servedBy = headers.get('zotero-server-id') ?? ctx.serverId
    const listing: ScopeListing =
      servedBy === undefined
        ? { entries, fetchedAt: Date.now() }
        : { entries, serverId: servedBy, fetchedAt: Date.now() }
    this.scopeListingCache.set(key, listing)
    return listing
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
      const { json, headers } = await this.client.getJson<unknown>(
        `${prefix}/${plural}/${ref.key}`,
        undefined,
        {
          signal,
          serverId: ref.serverId,
        },
      )
      const entry = normalizeScopeEntry(json)
      return {
        ref: refForLibrary(
          ref.library as SupportedLocalLibrary,
          kind,
          entry.key,
          headers.get('zotero-server-id') ?? ref.serverId,
        ),
        name: entry.name,
      }
    }
    // Name resolution matches over the effective library's full listing.
    let listing = await this.scopeListingOf(plural, { library: effectiveLibrary }, signal)
    let matched = matchScopeName(listing.entries, refOrName)
    if (matched.length === 0) {
      listing = await this.scopeListingOf(plural, { library: effectiveLibrary }, signal, {
        force: true,
      })
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
   * the browse.
   */
  private async collectionNodeOf(
    library: SupportedLocalLibrary,
    key: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<CollectionNode | undefined> {
    const nodeCacheKey = `${cacheKey(library, 'collections')}:${key}`
    const cached = this.collectionNodeCache.get(nodeCacheKey)
    if (
      cached !== undefined &&
      Date.now() - cached.fetchedAt < this.ttlMs &&
      cacheEntryMatchesIdentity(cached.serverId, serverId)
    ) {
      return cached.node
    }
    try {
      const { json } = await this.client.getJson<unknown>(
        `${libraryPrefix(library)}/collections/${key}`,
        undefined,
        { signal, serverId },
      )
      const entry = normalizeScopeEntry(json)
      const node: CollectionNode = {
        name: entry.name,
        ...(entry.parentKey !== undefined ? { parentKey: entry.parentKey } : {}),
      }
      this.collectionNodeCache.set(nodeCacheKey, {
        node,
        ...(serverId !== undefined ? { serverId } : {}),
        fetchedAt: Date.now(),
      })
      return node
    } catch (error) {
      if (isNotFoundError(error)) return undefined
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
      effectiveLibrary = PERSONAL_LIBRARY
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
