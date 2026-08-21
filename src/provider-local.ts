/**
 * The `local` provider: the Zotero Local API at `127.0.0.1:23119/api`.
 * Capabilities are declared only for what this provider currently
 * implements, so a capability gate can never route work into a method that
 * does not exist. Search semantics follow the Local API's documented
 * behavior: server-side pagination over `/items/top`, collection and saved
 * search scopes resolved client-side (the Local API has no server-side name
 * search), and literal tag names escaped so they never become query syntax.
 * Zotero's index never covers note bodies, so the first page of a queried
 * search (offset 0) may fill unused result slots after Zotero's primary
 * search results with client-side note-body matches (capped by
 * `maxNoteScanRecords`; collection scopes filter by membership). They do not
 * compete with or displace a full primary result page. The matches are listed
 * in `supplemental` — a separate collection from the paged `items`/`total`,
 * so pagination stays API-driven and the primary sort stays exact.
 * @module dsh-zotero/provider-local
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ZoteroHttpClient } from './http-client.js'
import { mapWithConcurrency } from './concurrency.js'
import {
  LOCAL_PROVIDER_ID,
  ZOTERO_EXPORT_CONCURRENCY,
  ZOTERO_GRAPH_CONCURRENCY,
  ZOTERO_ITEMKEY_BATCH,
  ZOTERO_SCOPE_LISTING_TTL_MS,
} from './constants.js'
import {
  NO_FULLTEXT_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  isNotFoundError,
  ZOTERO_FILE_MISSING,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_UNEXPECTED,
  ZOTERO_NO_FULLTEXT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZOTERO_SERVER_MISMATCH,
  ZoteroError,
  errorMessageOf,
} from './errors.js'
import { chunkText, rankChunks, tokenize } from './evidence.js'
import { locateExportItems } from './export-mapping.js'
import { asRecord, asString, isObjectKey } from './json.js'
import { loadItemGraph } from './item-graph.js'
import { cacheEntryMatchesIdentity, type LocalReadContext } from './local/identity.js'
import {
  collectionKeysOf,
  matchScopeName,
  nearScopeCandidates,
  normalizeItemDetail,
  normalizeScopeEntry,
  normalizeSearchItem,
  partitionChildren,
  plainNoteText,
  truncateText,
  type PartitionedChildren,
  type ScopeNameEntry,
  type ZoteroChildKind,
} from './normalize.js'
import {
  bestAttachmentFromLinks,
  normalizeAttachmentRecord,
  selectAttachment,
} from './attachments.js'
import {
  formatRef,
  isRefString,
  isSupportedLocalLibrary,
  libraryPrefix,
  parseRef,
  PERSONAL_GROUPS_DISCOVERY,
  PERSONAL_LIBRARY,
  refForLibrary,
  requireSupportedLocalRef,
} from './refs.js'
import type {
  SupportedLocalLibrary,
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroCollectionInfo,
  ZoteroCoverage,
  ZoteroEvidence,
  ZoteroEvidenceSource,
  ZoteroExportFormat,
  ZoteroExportItem,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroFulltextPayload,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroLibraryInfo,
  ZoteroObjectRef,
  ZoteroProvider,
  ZoteroResolvedScope,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchItem,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroSearchScope,
  ZoteroSearchSupplement,
  ZoteroStatus,
} from './types.js'

/** Escape a literal tag so a leading `-` never becomes Zotero's NOT syntax. */
export function encodeLiteralTag(tag: string): string {
  return tag.startsWith('-') ? `\\-${tag.slice(1)}` : tag
}

/**
 * Escape for NOT filter: `-` + escaped literal. For a tag that itself starts with `-`
 * (e.g. `-foo` literal), this intentionally yields `-\-foo` = NOT literal "-foo".
 * This is the Local API's documented escaping: `tag=\\-foo` means literal "-foo",
 * `tag=-\\-foo` means NOT literal "-foo". The backslash is part of the literal syntax,
 * not double-escaping.
 */
export function encodeExcludeTag(tag: string): string {
  return `-${encodeLiteralTag(tag)}`
}

/** Serialize a search request into the Local API's documented query parameters. */
export function buildSearchParams(request: ZoteroSearchRequest): URLSearchParams {
  const params = new URLSearchParams()
  if (request.query !== undefined && request.query !== '') params.set('q', request.query)
  if (request.mode === 'everything') params.set('qmode', 'everything')
  if (request.itemTypes !== undefined && request.itemTypes.length > 0) {
    params.set('itemType', request.itemTypes.join(' || '))
  }
  // tagMatch ALL (default) -> repeated tag (AND); ANY -> single tag with || (OR)
  if (request.tags !== undefined && request.tags.length > 0) {
    if (request.tagMatch === 'any' && request.tags.length > 1) {
      params.set('tag', request.tags.map(encodeLiteralTag).join(' || '))
    } else {
      for (const tag of request.tags) params.append('tag', encodeLiteralTag(tag))
    }
  }
  for (const tag of request.excludeTags ?? []) params.append('tag', encodeExcludeTag(tag))
  if (request.includeTrashed) params.set('includeTrashed', '1')
  params.set('sort', request.sort)
  params.set('direction', request.direction)
  params.set('start', String(request.offset))
  params.set('limit', String(request.limit))
  return params
}

interface ResolvedScopeResult {
  readonly path: string
  readonly resolved: ZoteroResolvedScope
  readonly serverId?: string
  /** The collection key a note must belong to for the body scan; library/search scopes are unset. */
  readonly collectionKey?: string
}

/** A cached full listing of one scope endpoint, with the identity header it was served under. */
interface ScopeListing {
  readonly entries: readonly ScopeNameEntry[]
  readonly serverId?: string
  /** Fetch time; a cached listing older than the TTL is re-fetched. */
  readonly fetchedAt: number
}

/** Provider construction options; kept minimal so the harness default stays one call. */
export interface LocalApiProviderOptions {
  /** How long a scope listing stays fresh before a re-fetch. */
  readonly scopeListingTtlMs?: number
}

/** Deployment-varying bounds the local provider needs beyond the HTTP client limits. */
export interface LocalApiLimits {
  /** Upper bound for note records the search scan fetches for body matches. */
  readonly maxNoteScanRecords: number
  /** Character budget for `zotero_get` abstract previews. */
  readonly maxDetailChars: number
  /** Character budget for a note item's own body returned by `zotero_get`. */
  readonly maxNoteBodyChars: number
  /** Per-note character budget for `zotero_get` note previews. */
  readonly maxNoteChars: number
  /** Upper bound for note records returned by `zotero_get`. */
  readonly maxNoteRecords: number
  /** Upper bound for annotation records returned by `zotero_get`. */
  readonly maxAnnotationRecords: number
  /** Word count of each full-text passage entering evidence ranking. */
  readonly fulltextChunkWords: number
  /** Total character budget for retrieved evidence passages. */
  readonly maxEvidenceChars: number
  /** Upper bound for the number of evidence passages. */
  readonly maxEvidencePassages: number
  /** Character bound for full text accepted into evidence ranking. */
  readonly maxFulltextChars: number
  /** Provider hard limit for export output; never mid-truncated. */
  readonly maxExportChars: number
  /** CSL style for citation/bibliography formats. */
  readonly defaultStyle: string
  /** CSL locale for citation/bibliography formats. */
  readonly defaultLocale: string
  /** Max items a browse call may return; capped by provider */
  readonly maxBrowseResults?: number
}

function cacheKey(library: SupportedLocalLibrary, plural: 'collections' | 'searches'): string {
  return `${library.type}:${library.id}:${plural}`
}

function sameLibrary(a: SupportedLocalLibrary, b: SupportedLocalLibrary): boolean {
  return a.type === b.type && a.id === b.id
}

const INCLUDE_ORDER: readonly ZoteroInclude[] = ['notes', 'annotations', 'attachments']

/** The order `sourcesSkipped` reports in; stable regardless of the request order. */
const SOURCE_ORDER: readonly ZoteroEvidenceSource[] = ['annotation', 'note', 'abstract', 'fulltext']

/**
 * Full-text indexing coverage as reported by Zotero. `complete` is derived
 * per axis: the chars axis (text files) and the pages axis (PDFs) each count
 * as complete when the server reports both sides and they agree; the overall
 * answer is complete when at least one axis is reportable and every
 * reportable axis agrees. Anything else is an incomplete answer, never a
 * guess — so a full PDF index without char counts still reads complete.
 */
function normalizeCoverage(payload: ZoteroFulltextPayload): ZoteroCoverage {
  const indexedChars = typeof payload.indexedChars === 'number' ? payload.indexedChars : undefined
  const totalChars = typeof payload.totalChars === 'number' ? payload.totalChars : undefined
  const indexedPages = typeof payload.indexedPages === 'number' ? payload.indexedPages : undefined
  const totalPages = typeof payload.totalPages === 'number' ? payload.totalPages : undefined
  const charsComplete =
    indexedChars !== undefined && totalChars !== undefined ? indexedChars === totalChars : undefined
  const pagesComplete =
    indexedPages !== undefined && totalPages !== undefined ? indexedPages === totalPages : undefined
  const axes = [charsComplete, pagesComplete].filter(
    (value): value is boolean => value !== undefined,
  )
  const complete = axes.length > 0 && axes.every((value) => value)
  return {
    ...(indexedPages !== undefined ? { indexedPages } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
    ...(indexedChars !== undefined ? { indexedChars } : {}),
    ...(totalChars !== undefined ? { totalChars } : {}),
    complete,
  }
}

/**
 * Parse a location the Local API reported for an attachment and require one
 * of the allowed protocols. Malformed text, relative paths, and exotic
 * schemes fail the call instead of leaking an unopenable location into tool
 * output; the failure message names the allowed protocols so the model can
 * act on the boundary.
 * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the value is not a usable location.
 */
function parseAttachmentLocation(
  raw: string,
  allowedProtocols: readonly string[],
  parseFailureMessage: string,
): URL {
  let target: URL
  try {
    target = new URL(raw)
  } catch (error) {
    throw new ZoteroError(parseFailureMessage, ZOTERO_NO_ATTACHMENT, { cause: error })
  }
  if (!allowedProtocols.includes(target.protocol)) {
    throw new ZoteroError(
      `Zotero reported an attachment location with unsupported protocol ${target.protocol}; only ${allowedProtocols
        .map((protocol) => protocol.slice(0, -1))
        .join(', ')} locations are usable.`,
      ZOTERO_NO_ATTACHMENT,
    )
  }
  return target
}

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability> = new Set<ZoteroCapability>([
    'metadata',
    'search',
    'attachments',
    'fulltext',
    'citation',
    'browse',
  ])

  constructor(
    private readonly client: ZoteroHttpClient,
    private readonly limits: LocalApiLimits,
    private readonly options: LocalApiProviderOptions = {},
  ) {}

  /** How long a scope listing is trusted before a re-fetch. */
  private get scopeListingTtlMs(): number {
    return this.options.scopeListingTtlMs ?? ZOTERO_SCOPE_LISTING_TTL_MS
  }

  /** Cached full listings of the scope endpoints, partitioned by library. */
  private readonly scopeListingCache = new Map<string, ScopeListing>()

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
  private async scopeListingOf(
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
      Date.now() - cached.fetchedAt < this.scopeListingTtlMs &&
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
   * Probe `GET /api/` and report connectivity plus the instance identity
   * headers. Health checks live here, not on every tool call. An explicit
   * caller abort propagates instead of folding into `connected: false`, so a
   * cancel is never mistaken for a connectivity problem.
   */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    try {
      const { headers } = await this.client.get('', undefined, { signal })
      return {
        providerId: this.id,
        connected: true,
        apiVersion: headers.get('zotero-api-version') ?? undefined,
        serverId: headers.get('zotero-server-id') ?? undefined,
        schemaVersion: headers.get('zotero-schema-version') ?? undefined,
        diagnosis: 'ok',
      }
    } catch (error) {
      if (signal?.aborted) throw error
      return {
        providerId: this.id,
        connected: false,
        diagnosis: errorMessageOf(error),
      }
    }
  }

  async search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult> {
    if (request.includeTrashed && request.scope.kind !== 'library') {
      throw new ZoteroError(
        'includeTrashed is only allowed with library scope.',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    const scope = await this.resolveScope(request.scope, request.library, signal)
    const { json, headers } = await this.client.getJson<unknown>(
      scope.path,
      buildSearchParams(request),
      {
        signal,
        serverId: scope.serverId,
      },
    )
    const rows = Array.isArray(json) ? json : []
    const responseServerId = headers.get('zotero-server-id') ?? scope.serverId
    const libraryForItems =
      scope.resolved.kind === 'library'
        ? scope.resolved.library
        : (() => {
            // collection/search resolved ref encodes library; parse to get it, fallback to request library or personal
            try {
              if ('ref' in scope.resolved && scope.resolved.ref)
                return parseRef(scope.resolved.ref).library as SupportedLocalLibrary
            } catch {
              /* ignore */
            }
            return request.library ?? PERSONAL_LIBRARY
          })()
    const ctxForSearch: { library: SupportedLocalLibrary; serverId?: string } = {
      library: libraryForItems,
      serverId: responseServerId ?? undefined,
    }
    const items = rows.map((row) => normalizeSearchItem(row, ctxForSearch))
    const headerTotal = headers.get('total-results')
    const apiTotal =
      headerTotal !== null && headerTotal !== '' && Number.isInteger(Number(headerTotal))
        ? Number(headerTotal)
        : items.length
    // Zotero's index never searches note bodies, so the first page of a
    // queried search lists client-side note-content matches in `supplemental`
    // — a separate list beside the paged primary results, up to the primary
    // page's unused headroom. Pagination stays API-driven: later pages skip
    // the scan, and the paged fields never fold in supplement counts.
    let supplemental: ZoteroSearchSupplement | undefined
    const query = request.query?.trim()
    if (query !== undefined && query !== '' && this.shouldScanNotes(request, scope.resolved)) {
      const terms = tokenize(query.toLowerCase())
      // A query whose tokens are all punctuation/emoji/whitespace matches
      // every note (the empty token list is vacuously present), so the scan
      // stays disabled for it.
      if (terms.length > 0) {
        const seen = new Set(
          rows
            .map((row) => asString(asRecord(row)?.key))
            .filter((key): key is string => key !== undefined),
        )
        // The API rows already fill `limit`; note matches only fill the
        // remaining headroom, so the supplement never exceeds the limit.
        const headroom = request.limit - rows.length
        if (headroom <= 0) {
          // Fail-closed early return: no headroom means no note scan (review 473-485)
        } else {
          const scan = await this.fetchNoteRows(scope, request, signal)
          // Matched rows keep scan order; child notes wait here for the
          // parent-membership resolution below before they can join the page.
          const matched: { row: unknown; key: string; parentKey?: string }[] = []
          for (const row of scan.rows) {
            if (matched.length >= headroom) break
            const key = asString(asRecord(row)?.key)
            if (key === undefined || seen.has(key)) continue
            if (!this.noteRowMatches(row, terms, request, scope.collectionKey)) continue
            const parentKey =
              scope.collectionKey === undefined
                ? undefined
                : asString(asRecord(asRecord(row)?.data)?.parentItem)
            matched.push({ row, key, ...(parentKey !== undefined ? { parentKey } : {}) })
          }
          let memberships: Map<string, Set<string>> | undefined
          const pendingParents = matched
            .map((entry) => entry.parentKey)
            .filter((parentKey): parentKey is string => parentKey !== undefined)
          if (pendingParents.length > 0) {
            memberships = await this.fetchParentCollections(
              libraryForItems,
              [...new Set(pendingParents)],
              scope.serverId,
              signal,
            )
          }
          const supplementItems: ZoteroSearchItem[] = []
          for (const entry of matched) {
            if (
              entry.parentKey !== undefined &&
              !memberships?.get(entry.parentKey)?.has(scope.collectionKey!)
            ) {
              continue
            }
            seen.add(entry.key)
            supplementItems.push(normalizeSearchItem(entry.row, ctxForSearch))
          }
          if (supplementItems.length > 0) {
            supplemental = {
              kind: 'noteBody',
              items: supplementItems,
              scanned: scan.rows.length,
              truncated: scan.truncated,
            }
          }
        }
      }
    }
    const nextOffset =
      request.offset + rows.length < apiTotal ? request.offset + rows.length : undefined
    // Omit (rather than null) the pagination cursor on the final page, so the
    // result stays a pure lossless-JSON value for the tool output snapshot.
    const result: ZoteroSearchResult = {
      scope: scope.resolved,
      items,
      total: apiTotal,
      offset: request.offset,
      returned: items.length,
    }
    if (supplemental !== undefined) result.supplemental = supplemental
    if (nextOffset !== undefined) result.nextOffset = nextOffset
    return result
  }

  /** Whether a search request qualifies for the client-side note-body scan. */
  private shouldScanNotes(request: ZoteroSearchRequest, resolved: ZoteroResolvedScope): boolean {
    const query = request.query?.trim()
    return (
      query !== undefined &&
      query !== '' &&
      request.offset === 0 &&
      resolved.kind !== 'savedSearch' &&
      (request.itemTypes === undefined || request.itemTypes.includes('note'))
    )
  }

  /**
   * Fetch note rows for the body scan in dateModified-descending batches,
   * stopping at `maxNoteScanRecords`. The provider uses a 100-row batch as a
   * bounded scanning policy; the Local API itself has no default/maximum
   * limit for local requests, so fewer rows than requested reliably means EOF.
   * Note scan uses `/{libraryPrefix}/items` (not `/items/top`) so child notes
   * are included. `truncated` is true when the cap — not EOF — ended the
   * scan (the only way to leave the loop at exactly the cap is a full final
   * batch, so more notes may exist).
   */
  private async fetchNoteRows(
    scope: ResolvedScopeResult,
    request: ZoteroSearchRequest,
    signal: AbortSignal | undefined,
  ): Promise<{ rows: readonly unknown[]; truncated: boolean }> {
    const libraryForScan: SupportedLocalLibrary =
      scope.resolved.kind === 'library'
        ? scope.resolved.library
        : (() => {
            try {
              if ('ref' in scope.resolved && scope.resolved.ref)
                return parseRef(scope.resolved.ref).library as SupportedLocalLibrary
            } catch {}
            return request.library ?? PERSONAL_LIBRARY
          })()
    const prefix = libraryPrefix(libraryForScan)
    const out: unknown[] = []
    let start = 0
    while (out.length < this.limits.maxNoteScanRecords) {
      const wanted = Math.min(100, this.limits.maxNoteScanRecords - out.length)
      const params = new URLSearchParams()
      params.set('itemType', 'note')
      params.set('sort', 'dateModified')
      params.set('direction', 'desc')
      params.set('start', String(start))
      params.set('limit', String(wanted))
      if (request.includeTrashed) params.set('includeTrashed', '1')
      const { json } = await this.client.getJson<unknown>(`${prefix}/items`, params, {
        signal,
        serverId: scope.serverId,
      })
      const rows = Array.isArray(json) ? json : []
      if (rows.length === 0) break
      out.push(...rows.slice(0, wanted))
      // Fewer rows than requested means the library has no more notes.
      if (rows.length < wanted) break
      start += rows.length
    }
    return { rows: out, truncated: out.length >= this.limits.maxNoteScanRecords }
  }

  /**
   * Resolve collection membership for child notes through their parents in
   * batched requests: child notes belong to a collection only via the
   * parent bibliographic item. Keys are deduplicated and split into
   * `ZOTERO_ITEMKEY_BATCH`-sized chunks — the Local API's hard per-request
   * cap for `itemKey=` — fetched through the bounded pool. A parent missing
   * from a response (e.g. trashed without `includeTrashed`) fails closed as
   * a non-member.
   */
  private async fetchParentCollections(
    library: SupportedLocalLibrary,
    parentKeys: readonly string[],
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Map<string, Set<string>>> {
    const unique = [...new Set(parentKeys)]
    const chunks: string[][] = []
    for (let start = 0; start < unique.length; start += ZOTERO_ITEMKEY_BATCH) {
      chunks.push(unique.slice(start, start + ZOTERO_ITEMKEY_BATCH))
    }
    const membershipsPerChunk = await mapWithConcurrency(
      chunks,
      ZOTERO_EXPORT_CONCURRENCY,
      async (chunk) => {
        const params = new URLSearchParams()
        params.set('itemKey', chunk.join(','))
        const { json } = await this.client.getJson<unknown>(
          `${libraryPrefix(library)}/items`,
          params,
          { signal, serverId },
        )
        const memberships = new Map<string, Set<string>>()
        for (const row of Array.isArray(json) ? json : []) {
          const key = asString(asRecord(row)?.key)
          if (key === undefined) continue
          memberships.set(key, new Set(collectionKeysOf(row)))
        }
        return memberships
      },
    )
    const merged = new Map<string, Set<string>>()
    for (const memberships of membershipsPerChunk) {
      for (const [key, collections] of memberships) merged.set(key, collections)
    }
    return merged
  }

  /**
   * Whether a note row satisfies the body scan: every query token appears
   * in the note text, plus the literal tag filters when present. Mirrors
   * server tag semantics: tagMatch, excludeTags, includeTrashed.
   *
   * Collection scope checks membership on the note itself only for
   * standalone notes — Zotero child notes carry no `collections` of their
   * own (membership belongs to the parent item), so they pass here and the
   * caller resolves membership through `fetchParentCollections`.
   */
  private noteRowMatches(
    row: unknown,
    terms: readonly string[],
    request: ZoteroSearchRequest,
    collectionKey: string | undefined,
  ): boolean {
    const data = asRecord(asRecord(row)?.data)
    if (asString(data?.itemType) !== 'note') return false
    if (collectionKey !== undefined && asString(data?.parentItem) === undefined) {
      if (!collectionKeysOf(row).includes(collectionKey)) return false
    }
    const tags = request.tags
    const excludeTags = request.excludeTags
    const tagMatch = request.tagMatch ?? 'all'
    if (
      (tags !== undefined && tags.length > 0) ||
      (excludeTags !== undefined && excludeTags.length > 0)
    ) {
      const tagNames = new Set(
        (Array.isArray(data?.tags) ? data.tags : [])
          .map((tag) => asString(asRecord(tag)?.tag))
          .filter((tag): tag is string => tag !== undefined),
      )
      if (tags !== undefined && tags.length > 0) {
        if (tagMatch === 'any') {
          if (!tags.some((tag) => tagNames.has(tag))) return false
        } else {
          if (!tags.every((tag) => tagNames.has(tag))) return false
        }
      }
      if (excludeTags !== undefined && excludeTags.length > 0) {
        if (excludeTags.some((tag) => tagNames.has(tag))) return false
      }
    }
    const text = plainNoteText(data?.note).toLowerCase()
    return terms.every((term) => text.includes(term))
  }

  /**
   * Fetch one item's full detail. The parent is always fetched once; child
   * rows are fetched lazily only when the caller asked to include
   * notes/annotations/attachments — the Local API ignores `?include=` on
   * single-item responses, so children come from the dedicated `/children`
   * endpoint. Annotations live one level deeper (under each attachment), so
   * an annotations include additionally walks every attachment's own
   * `/children` under the bounded graph pool. Collection names resolve from
   * a cached full listing (one listing request per provider instance) only
   * when the item belongs to collections.
   */
  async getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail> {
    const ref = requireSupportedLocalRef(request.ref, ['item'])
    const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
    const parent = await this.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const serverId = parent.headers.get('zotero-server-id') ?? ref.serverId
    const includes = INCLUDE_ORDER.filter((kind) => request.include.has(kind))
    const keys = collectionKeysOf(parent.json)
    // Children and the collections listing are independent once the parent
    // has arrived; the Local API is a loopback server with no per-client
    // throttling, so both ride the same await.
    const [children, collectionNames] = await Promise.all([
      includes.length > 0
        ? this.loadChildRows(
            ref.key,
            ref.library as SupportedLocalLibrary,
            serverId,
            signal,
            request.include.has('annotations'),
          )
        : undefined,
      keys.length > 0
        ? this.collectionNamesFor(keys, ref.library as SupportedLocalLibrary, serverId, signal)
        : undefined,
    ])
    return normalizeItemDetail({
      parent: parent.json,
      library: ref.library as SupportedLocalLibrary,
      serverId: serverId ?? undefined,
      include: request.include,
      childrenRows: children?.rows,
      directChildCount: children?.directCount,
      collectionNames,
      maxAbstractChars: this.limits.maxDetailChars,
      maxNoteBodyChars: this.limits.maxNoteBodyChars,
      maxNoteChars: this.limits.maxNoteChars,
      maxNoteRecords: this.limits.maxNoteRecords,
      maxAnnotationRecords: this.limits.maxAnnotationRecords,
    })
  }

  /**
   * One item's child rows for get/retrieve. Without annotations this is the
   * single `/children` response; with them the walk descends into each
   * attachment and merges those annotation rows into one partition input.
   * The direct row count rides along so the detail's `children.total` stays
   * honest after the merge.
   */
  private async loadChildRows(
    key: string,
    library: SupportedLocalLibrary,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
    withAnnotations: boolean,
  ): Promise<{ readonly rows: readonly unknown[]; readonly directCount: number }> {
    const graph = await loadItemGraph({
      parentKey: key,
      fetchChildren: (childKey) => this.fetchChildRows(childKey, library, serverId, signal),
      concurrency: ZOTERO_GRAPH_CONCURRENCY,
      withAnnotations,
    })
    const merged =
      withAnnotations && graph.attachmentAnnotations.length > 0
        ? [...graph.childRows, ...graph.attachmentAnnotations]
        : graph.childRows
    return { rows: merged, directCount: graph.childRows.length }
  }

  /** Fetch one item's child rows; undefined when the caller asked for none. */
  private async fetchChildRows(
    key: string,
    library: SupportedLocalLibrary,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<readonly unknown[]> {
    const prefix = libraryPrefix(library)
    const children = await this.client.getJson<unknown>(
      `${prefix}/items/${key}/children`,
      undefined,
      {
        signal,
        serverId,
      },
    )
    return Array.isArray(children.json) ? children.json : []
  }

  /**
   * Collection names for exactly the requested keys, resolved from the cached
   * full listing. The Local API returns list endpoints in full by default
   * (unlike the Web API's 25-per-page), so one unpaginated listing serves
   * every call; the cached listing is re-fetched when it outlives the scope
   * TTL, so renames and new collections surface without a settings commit.
   */
  private async collectionNamesFor(
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
   * Resolve an item or attachment ref to a usable location. An item ref
   * follows Zotero's own best-attachment link first and falls back to the
   * earliest PDF child, so callers do not need the attachment's key when
   * one attachment is enough. Linked-URL attachments carry their target in
   * `data.url` (their `/file/view/url` endpoint rejects non-file
   * attachments); file attachments resolve through `/file/view/url` and
   * are stat'ed so a missing file fails with a typed error instead of a
   * dead path.
   */
  async getAttachmentLocation(
    ref: ZoteroObjectRef,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocation> {
    const local = requireSupportedLocalRef(ref, ['item', 'attachment'])
    const attachmentKey = await this.resolveAttachmentKey(local, signal)
    const prefix = libraryPrefix(local.library as SupportedLocalLibrary)
    const item = await this.client.getJson<unknown>(`${prefix}/items/${attachmentKey}`, undefined, {
      signal,
      serverId: local.serverId,
    })
    const data = asRecord(asRecord(item.json)?.data)
    const itemType = asString(data?.itemType)
    if (itemType !== undefined && itemType !== 'attachment') {
      throw new ZoteroError(
        `The referenced object is a ${itemType}, not an attachment.`,
        ZOTERO_NO_ATTACHMENT,
      )
    }
    const attachment = normalizeAttachmentRecord(item.json)
    const serverId = item.headers.get('zotero-server-id') ?? local.serverId
    const formattedRef = formatRef(
      refForLibrary(local.library as SupportedLocalLibrary, 'attachment', attachment.key, serverId),
    )
    const title = attachment.title
    const contentType = attachment.contentType
    if (attachment.linkMode === 'linked_url') {
      if (attachment.url === undefined || attachment.url === '') {
        throw new ZoteroError(
          `Attachment ${attachmentKey} is linked to a URL but Zotero reported none.`,
          ZOTERO_NO_ATTACHMENT,
        )
      }
      const target = parseAttachmentLocation(
        attachment.url,
        ['http:', 'https:'],
        `Attachment ${attachmentKey} is linked to a URL that is not a usable web location.`,
      )
      return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
    }
    const file = await this.client.get(
      `${prefix}/items/${attachmentKey}/file/view/url`,
      undefined,
      {
        signal,
        serverId: local.serverId,
      },
    )
    const target = parseAttachmentLocation(
      file.body.trim(),
      ['file:', 'http:', 'https:'],
      `Zotero reported no usable file location for attachment ${attachmentKey}.`,
    )
    if (target.protocol === 'file:') {
      const path = fileURLToPath(target)
      if (!existsSync(path)) {
        throw new ZoteroError(
          `The attachment file is missing from disk: ${path}`,
          ZOTERO_FILE_MISSING,
        )
      }
      return { ref: formattedRef, title, contentType, kind: 'file', path }
    }
    return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
  }

  /**
   * Gather ranked evidence for one item: annotations, notes, the abstract,
   * and full-text chunks are scored as one passage corpus with BM25. Fetch
   * stays lazy — children only when annotation/note sources (or a PDF
   * fallback) need them, fulltext only when requested (started concurrently
   * with children when the parent carries the attachment link). Annotations
   * live under each attachment, so annotation sources walk the graph's
   * second level and rank every attachment's annotations as one corpus; each
   * passage keeps its own attachment provenance. A note item's own body is
   * its note source; child notes contribute every chunk of their full text,
   * so long notes rank beyond their first chunk. Sources the item cannot
   * provide are skipped and reported in `sourcesSkipped` — retrieval degrades
   * instead of failing. Passage count and character budgets are enforced
   * with the `truncated` flag, never by silently editing passage text.
   */
  async retrieve(
    request: ZoteroRetrieveRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRetrieveResult> {
    const ref = requireSupportedLocalRef(request.ref, ['item'])
    const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
    const parent = await this.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const serverId = parent.headers.get('zotero-server-id') ?? ref.serverId
    const record = asRecord(parent.json)
    const data = asRecord(record?.data)
    const itemType = asString(data?.itemType) ?? asString(record?.itemType)
    const linkAttachment = bestAttachmentFromLinks(parent.json)

    const wantsAnnotations = request.sources.includes('annotation')
    const wantsNotes = request.sources.includes('note')
    const wantsFulltext = request.sources.includes('fulltext')
    // A note item's own body is its note source, so its children are only
    // needed for annotation sources or the PDF fallback.
    const isNoteItem = itemType === 'note'
    const fetchChildren =
      wantsAnnotations ||
      (wantsNotes && !isNoteItem) ||
      (wantsFulltext && linkAttachment === undefined)
    // Children and a linked fulltext are independent once the parent has
    // arrived; start both before awaiting either. The noop handler keeps a
    // fulltext rejection that lands while children are still in flight from
    // being reported as unhandled before the try below awaits it.
    const fulltextKey = wantsFulltext ? linkAttachment?.key : undefined
    const fulltextPromise =
      fulltextKey === undefined
        ? undefined
        : this.fetchFulltext(fulltextKey, ref.library as SupportedLocalLibrary, serverId, signal)
    fulltextPromise?.catch(() => {})
    let childrenRows: readonly unknown[] = []
    if (fetchChildren) {
      childrenRows = (
        await this.loadChildRows(
          ref.key,
          ref.library as SupportedLocalLibrary,
          serverId,
          signal,
          wantsAnnotations,
        )
      ).rows
    }

    const skipped: ZoteroEvidenceSource[] = []
    let fulltextWasCut = false
    let attachmentRef: string | undefined
    let attachmentContentType: string | undefined
    let coverage: ZoteroCoverage | undefined
    const passages: {
      source: ZoteroEvidenceSource
      sourceRef: string
      text: string
      chunkIndex?: number
      chunkCount?: number
      comment?: string
      pageLabel?: string
      attachmentRef?: string
    }[] = []
    if (wantsFulltext) {
      let attachmentKey = fulltextKey
      // The link arm reports Zotero's own type (possibly empty); the child
      // fallback selects an application/pdf candidate whose type is known.
      let selectedContentType = linkAttachment?.contentType
      if (attachmentKey === undefined) {
        const pdf = selectAttachment(childrenRows, 'pdf')
        if (pdf === undefined) skipped.push('fulltext')
        else {
          attachmentKey = pdf.key
          selectedContentType = pdf.contentType
        }
      }
      if (attachmentKey !== undefined) {
        try {
          attachmentRef = formatRef(
            refForLibrary(
              ref.library as SupportedLocalLibrary,
              'attachment',
              attachmentKey,
              serverId,
            ),
          )
          if (selectedContentType !== undefined && selectedContentType !== '') {
            attachmentContentType = selectedContentType
          }
          const payload = await (fulltextPromise ??
            this.fetchFulltext(
              attachmentKey,
              ref.library as SupportedLocalLibrary,
              serverId,
              signal,
            ))
          const content = typeof payload.content === 'string' ? payload.content : ''
          const bounded = truncateText(content, this.limits.maxFulltextChars)
          fulltextWasCut = bounded.truncated
          const chunks = chunkText(
            bounded.text,
            this.limits.fulltextChunkWords,
            this.limits.maxEvidenceChars,
          )
          for (const chunk of chunks) {
            passages.push({
              source: 'fulltext',
              sourceRef: attachmentRef,
              text: chunk.text,
              chunkIndex: chunk.index,
              chunkCount: chunks.length,
            })
          }
          coverage = normalizeCoverage(payload)
        } catch (error) {
          // An unindexed attachment degrades like an absent one: the other
          // requested sources still answer, and `sourcesSkipped` reports it.
          if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
            skipped.push('fulltext')
          } else {
            throw error
          }
        }
      }
    }

    const partitioned: PartitionedChildren = fetchChildren
      ? partitionChildren(
          childrenRows,
          { library: ref.library as SupportedLocalLibrary, serverId },
          undefined,
          new Set<ZoteroChildKind>([
            ...(wantsNotes ? (['note'] as const) : []),
            ...(wantsAnnotations ? (['annotation'] as const) : []),
          ]),
        )
      : { notes: [], annotations: [], attachments: [] }
    if (wantsAnnotations) {
      if (partitioned.annotations.length === 0) skipped.push('annotation')
      for (const annotation of partitioned.annotations) {
        passages.push({
          source: 'annotation',
          sourceRef: annotation.ref,
          text: annotation.text,
          ...(annotation.comment !== undefined ? { comment: annotation.comment } : {}),
          ...(annotation.pageLabel !== undefined ? { pageLabel: annotation.pageLabel } : {}),
          ...(annotation.parentRef === undefined ? {} : { attachmentRef: annotation.parentRef }),
        })
      }
    }
    if (wantsNotes) {
      const noteRef = formatRef(
        refForLibrary(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
      )
      const noteSources: { ref: string; text: string }[] = isNoteItem
        ? [{ ref: noteRef, text: plainNoteText(data?.note) }]
        : partitioned.notes.map((note) => ({ ref: note.ref, text: note.text }))
      // A note item's own body is its note source, so only a non-note item
      // without child notes cannot provide the source.
      if (!isNoteItem && partitioned.notes.length === 0) skipped.push('note')
      for (const note of noteSources) {
        const chunks = chunkText(
          note.text,
          this.limits.fulltextChunkWords,
          this.limits.maxEvidenceChars,
        )
        for (const chunk of chunks) {
          passages.push({
            source: 'note',
            sourceRef: note.ref,
            text: chunk.text,
            chunkIndex: chunk.index,
            chunkCount: chunks.length,
          })
        }
      }
    }
    let abstractWasCut = false
    if (request.sources.includes('abstract')) {
      const raw = asString(data?.abstractNote) ?? ''
      if (raw !== '') {
        const bounded = truncateText(raw, this.limits.maxEvidenceChars)
        abstractWasCut = bounded.truncated
        passages.push({
          source: 'abstract',
          sourceRef: formatRef(
            refForLibrary(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
          ),
          text: bounded.text,
        })
      } else {
        skipped.push('abstract')
      }
    }

    const ranked = rankChunks(
      request.query,
      passages.map((passage, index) => ({ text: passage.text, index })),
    )
    // Zero-score passages share nothing with the query; returning them as
    // "evidence" would present arbitrary excerpts as matches. A query with no
    // token overlap therefore yields an empty evidence array, which the
    // contract reads as "no match", not "no content".
    const matched = ranked.filter((entry) => entry.score > 0)
    const evidence: ZoteroEvidence[] = []
    let used = 0
    let truncated = matched.length > request.passages || fulltextWasCut || abstractWasCut
    for (const entry of matched.slice(0, request.passages)) {
      const passage = passages[entry.index]!
      if (used + passage.text.length > this.limits.maxEvidenceChars) {
        truncated = true
        break
      }
      used += passage.text.length
      evidence.push({
        source: passage.source,
        sourceRef: passage.sourceRef,
        text: passage.text,
        ...(passage.chunkIndex !== undefined ? { chunkIndex: passage.chunkIndex } : {}),
        ...(passage.chunkCount !== undefined ? { chunkCount: passage.chunkCount } : {}),
        ...(passage.comment !== undefined ? { comment: passage.comment } : {}),
        ...(passage.pageLabel !== undefined ? { pageLabel: passage.pageLabel } : {}),
        ...(passage.attachmentRef !== undefined ? { attachmentRef: passage.attachmentRef } : {}),
      })
    }
    // A stable report order keeps the contract predictable: the sources the
    // caller asked for but the item could not provide, deduplicated.
    const sourcesSkipped = [...new Set(skipped)].sort(
      (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
    )
    return {
      ref: formatRef(
        refForLibrary(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
      ),
      ...(attachmentRef !== undefined ? { attachmentRef } : {}),
      ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
      ...(coverage !== undefined ? { coverage } : {}),
      evidence,
      truncated,
      sourcesSkipped,
    }
  }

  /**
   * Export the requested items through the Local API's format pipeline:
   * `include=citation` pairs each item with its HTML citation (batched to the
   * API's itemKey cap when the request is larger), `format=bib` yields a
   * joined CSL-sorted bibliography, and the translator formats
   * (`bibtex`/`biblatex`/`ris`/`csljson`) export the whole set at once. The
   * batch-breaking formats refuse to exceed `ZOTERO_ITEMKEY_BATCH` — their
   * global ordering belongs to Zotero, so splitting them would silently
   * reorder the output. The translator formats additionally itemize each
   * document by requesting it on its own — through a bounded parallel pool,
   * one request per unique key, in the requested ref order — because the
   * merged body's entry order is Zotero's own and cannot be indexed against
   * the refs. Output that exceeds `maxExportChars` fails with
   * OUTPUT_TOO_LARGE — export text is never mid-truncated.
   */
  async export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult> {
    for (const ref of request.refs) requireSupportedLocalRef(ref, ['item'])
    // Export is single-library (v3 lock): all refs must share the same SupportedLocalLibrary
    const firstLibrary = request.refs[0]?.library as SupportedLocalLibrary | undefined
    if (firstLibrary !== undefined) {
      for (const ref of request.refs.slice(1)) {
        if (!sameLibrary(firstLibrary, ref.library as SupportedLocalLibrary)) {
          throw new ZoteroError(
            'All refs in one export must belong to the same library (personal or a single group). Split by library.',
            ZOTERO_INVALID_ARGUMENT,
          )
        }
      }
    }
    // Every ref must come from the same Zotero instance: the request header
    // carries one identity, and a ref from another instance must fail closed
    // instead of silently resolving same-key objects there.
    const serverIds = new Set(
      request.refs.map((ref) => ref.serverId).filter((id): id is string => id !== undefined),
    )
    if (serverIds.size > 1) throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
    const serverId = serverIds.size === 1 ? serverIds.values().next().value : undefined
    const exportLibrary: SupportedLocalLibrary = (firstLibrary ??
      PERSONAL_LIBRARY) as SupportedLocalLibrary
    const exportPrefix = libraryPrefix(exportLibrary)
    const style = request.style ?? this.limits.defaultStyle
    const locale = request.locale ?? this.limits.defaultLocale
    if (request.format === 'citation') {
      return await this.exportCitations(request.refs, exportPrefix, serverId, style, locale, signal)
    }
    // Duplicate refs name the same item; the translator formats fetch each
    // document on its own, so every unique key is requested once, keeping
    // the first-seen order. Dedupe by canonical ref (library+key) not bare key is safer, but with same-library gate key-only suffices.
    const seen = new Set<string>()
    const refs: ZoteroObjectRef[] = []
    for (const ref of request.refs) {
      const canonical = `${ref.library.type}:${ref.library.id}:${ref.key}`
      if (seen.has(canonical)) continue
      seen.add(canonical)
      refs.push(ref)
    }
    if (refs.length > ZOTERO_ITEMKEY_BATCH) {
      throw new ZoteroError(
        `The ${request.format} format accepts at most ${ZOTERO_ITEMKEY_BATCH} item refs per call (Zotero's itemKey request cap, which also keeps the format's global ordering intact). Request up to ${ZOTERO_ITEMKEY_BATCH} refs at a time, or use citation, which batches up to the configured export cap.`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    const search = new URLSearchParams()
    search.set('itemKey', refs.map((ref) => ref.key).join(','))
    if (request.format === 'bibliography') {
      search.set('format', 'bib')
      search.set('style', style)
      search.set('locale', locale)
    } else {
      search.set('format', request.format)
    }
    const { body } = await this.client.get(`${exportPrefix}/items`, search, { signal, serverId })
    if (body.length > this.limits.maxExportChars) {
      throw new ZoteroError(
        `Export output of ${body.length} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
        ZOTERO_OUTPUT_TOO_LARGE,
      )
    }
    if (request.format === 'bibliography') {
      return { format: 'bibliography', style, locale, text: body }
    }
    // The browser holds `text` with its leading whitespace trimmed (the
    // render strips it), so the entry offsets are measured on that same
    // trimmed body.
    const items = await this.fetchExportItems(
      refs,
      request.format,
      body.trimStart(),
      exportPrefix,
      serverId,
      signal,
    )
    return { format: request.format, text: body, items }
  }

  /**
   * One single-item export per unique ref, in the requested order, paired
   * with its batch entry. The merged body's entry order belongs to Zotero,
   * so each document is requested on its own — through a bounded parallel
   * pool, so a full export cannot storm the local API — and matched to the
   * batch body server-side. The single-item bodies share the batch body's
   * output budget, and a missing or empty entry fails the whole call — the
   * same closed contract as the citation arm, instead of the batch body
   * silently omitting the item. Caller cancellation reaches every request
   * through the HTTP layer's fused signal.
   */
  private async fetchExportItems(
    refs: readonly ZoteroObjectRef[],
    format: ZoteroExportFormat,
    text: string,
    prefix: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroExportItem[]> {
    let totalChars = 0
    const inputs = await mapWithConcurrency(refs, ZOTERO_EXPORT_CONCURRENCY, async (ref) => {
      const search = new URLSearchParams()
      search.set('itemKey', ref.key)
      search.set('format', format)
      const { body } = await this.client.get(`${prefix}/items`, search, { signal, serverId })
      if (body === '') {
        throw new ZoteroError(
          `Zotero did not return an item for ${formatRef(ref)}.`,
          ZOTERO_NOT_FOUND,
        )
      }
      totalChars += body.length
      if (totalChars > this.limits.maxExportChars) {
        throw new ZoteroError(
          `Per-document export output of ${totalChars} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
          ZOTERO_OUTPUT_TOO_LARGE,
        )
      }
      return { ref: formatRef(ref), key: ref.key, text: body }
    })
    return locateExportItems(format, text, inputs)
  }

  /**
   * Citation export: batches the refs into API-sized requests, merges the
   * per-key citations, and reorders them to the requested sequence. Order is
   * exact — each citation stays paired with its ref — so batching is
   * invisible to the caller.
   */
  private async exportCitations(
    refs: readonly ZoteroObjectRef[],
    prefix: string,
    serverId: string | undefined,
    style: string,
    locale: string,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroExportResult> {
    const citationByKey = new Map<string, string>()
    for (let start = 0; start < refs.length; start += ZOTERO_ITEMKEY_BATCH) {
      const batch = refs.slice(start, start + ZOTERO_ITEMKEY_BATCH)
      const batchCitations = await this.fetchCitationBatch(
        batch,
        prefix,
        serverId,
        style,
        locale,
        signal,
      )
      for (const [key, text] of batchCitations) citationByKey.set(key, text)
    }
    const citations = refs.map((ref) => {
      const text = citationByKey.get(ref.key)
      if (text === undefined) {
        throw new ZoteroError(
          `Zotero did not return an item for ${formatRef(ref)}.`,
          ZOTERO_NOT_FOUND,
        )
      }
      return { ref: formatRef(ref), text }
    })
    const totalChars = citations.reduce((sum, entry) => sum + entry.text.length, 0)
    if (totalChars > this.limits.maxExportChars) {
      throw new ZoteroError(
        `Citation output of ${totalChars} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
        ZOTERO_OUTPUT_TOO_LARGE,
      )
    }
    return { format: 'citation', style, locale, citations }
  }

  /** One batch of per-key citations — at most `ZOTERO_ITEMKEY_BATCH` keys. */
  private async fetchCitationBatch(
    batch: readonly ZoteroObjectRef[],
    prefix: string,
    serverId: string | undefined,
    style: string,
    locale: string,
    signal: AbortSignal | undefined,
  ): Promise<Map<string, string>> {
    const search = new URLSearchParams()
    search.set('itemKey', batch.map((ref) => ref.key).join(','))
    search.set('include', 'citation')
    search.set('style', style)
    search.set('locale', locale)
    const { json } = await this.client.getJson<unknown>(`${prefix}/items`, search, {
      signal,
      serverId,
    })
    const citationByKey = new Map<string, string>()
    for (const row of Array.isArray(json) ? json : []) {
      const record = asRecord(row)
      const key = asString(record?.key)
      if (key === undefined || !isObjectKey(key)) {
        throw new ZoteroError(
          'Zotero returned an item without a valid object key.',
          ZOTERO_UNEXPECTED,
        )
      }
      citationByKey.set(key, asString(record?.citation) ?? '')
    }
    return citationByKey
  }

  /**
   * Pick the attachment key an item ref resolves to: Zotero's own
   * `links.attachment` choice when present, otherwise the earliest PDF
   * child from a lazy `/children` fetch.
   * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the item has none.
   */
  private async resolveAttachmentKey(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<string> {
    if (ref.kind === 'attachment') return ref.key
    const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
    const parent = await this.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const link = bestAttachmentFromLinks(parent.json)
    if (link !== undefined) return link.key
    const children = await this.client.getJson<unknown>(
      `${prefix}/items/${ref.key}/children`,
      undefined,
      {
        signal,
        serverId: ref.serverId,
      },
    )
    const pdf = selectAttachment(Array.isArray(children.json) ? children.json : [], 'pdf')
    if (pdf === undefined) {
      throw new ZoteroError(`Item ${ref.key} has no attachment to resolve.`, ZOTERO_NO_ATTACHMENT)
    }
    return pdf.key
  }

  private async fetchFulltext(
    attachmentKey: string,
    library: SupportedLocalLibrary,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroFulltextPayload> {
    try {
      const prefix = libraryPrefix(library)
      const response = await this.client.getJson<ZoteroFulltextPayload>(
        `${prefix}/items/${attachmentKey}/fulltext`,
        undefined,
        { signal, serverId },
      )
      return response.json
    } catch (error) {
      // The Local API reports unindexed attachments as 404, which the HTTP
      // layer maps to NOT_FOUND; only this endpoint reinterprets that status.
      if (isNotFoundError(error)) {
        throw new ZoteroError(NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT)
      }
      throw error
    }
  }

  private async resolveScope(
    scope: ZoteroSearchScope,
    library: SupportedLocalLibrary | undefined,
    signal?: AbortSignal,
  ): Promise<ResolvedScopeResult> {
    // Fail-Closed 但避免 UX 陷阱：library 省略且 scope 为 group ref 时，从 ref 推断 library
    // 否则 zotero://group/42/collection/XXXX 在未传 library 时必错（review 1298-1352）
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
        return {
          path: `${libraryPrefix(effectiveLibrary)}/items/top`,
          resolved: { kind: 'library', library: effectiveLibrary },
        }
      case 'collection': {
        const found = await this.resolveNamed(
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
        const found = await this.resolveNamed('search', scope.refOrName, effectiveLibrary, signal)
        return {
          path: `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/searches/${found.ref.key}/items`,
          resolved: { kind: 'savedSearch', ref: formatRef(found.ref), name: found.name },
          serverId: found.ref.serverId,
        }
      }
    }
  }

  /**
   * Resolve a collection or saved search from a ref or a name. A ref fetches
   * that single object (validating existence and reading its name); a name
   * matches client-side over the full listing, since the Local API has no
   * server-side name search for these endpoints.
   */
  private async resolveNamed(
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
    // name resolution uses effective library
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

  // ---- browse (Phase C) ----

  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    const maxBrowse = this.limits.maxBrowseResults ?? 50
    if (!Number.isInteger(request.offset) || request.offset < 0) {
      throw new ZoteroError('offset must be a non-negative integer', ZOTERO_INVALID_ARGUMENT)
    }
    if (!Number.isInteger(request.limit) || request.limit <= 0 || request.limit > maxBrowse) {
      throw new ZoteroError(`limit must be integer 1..${maxBrowse}`, ZOTERO_INVALID_ARGUMENT)
    }
    // Fail-closed: libraries/itemTypes are global; library param must not be set (review 117-120)
    if (
      (request.kind === 'libraries' || request.kind === 'itemTypes') &&
      request.library !== undefined
    ) {
      throw new ZoteroError(
        `library is not allowed for kind ${request.kind}; omit library for libraries/itemTypes`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    if ((request.q !== undefined || request.match !== undefined) && request.kind !== 'tags') {
      throw new ZoteroError('q/match are only valid when kind="tags"', ZOTERO_INVALID_ARGUMENT)
    }
    switch (request.kind) {
      case 'libraries':
        return await this.browseLibraries(request, signal)
      case 'collections':
        return await this.browseCollections(request, signal)
      case 'savedSearches':
        return await this.browseSavedSearches(request, signal)
      case 'tags':
        return await this.browseTags(request, signal)
      case 'itemTypes':
        return await this.browseItemTypes(request, signal)
      default:
        throw new ZoteroError(
          `Unsupported browse kind ${(request as { kind: string }).kind}`,
          ZOTERO_INVALID_ARGUMENT,
        )
    }
  }

  private async browseLibraries(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    let serverId: string | undefined
    const items: ZoteroLibraryInfo[] = []
    // personal always present
    items.push({ library: PERSONAL_LIBRARY, name: 'My Library' })
    // try to discover groups; Zotero 7/8/9 may 404
    try {
      const { json, headers } = await this.client.getJson<unknown>(
        PERSONAL_GROUPS_DISCOVERY,
        undefined,
        {
          signal,
        },
      )
      serverId = headers.get('zotero-server-id') ?? undefined
      const groups = Array.isArray(json) ? json : []
      for (const row of groups) {
        const rec = asRecord(row)
        const idRaw = rec?.id ?? rec?.groupID ?? asRecord(rec?.data)?.groupID
        const nameRaw =
          asString(rec?.name) ??
          asString(asRecord(rec?.data)?.name) ??
          asString(rec?.groupName) ??
          ''
        const id =
          typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : undefined
        if (id === undefined || !Number.isInteger(id) || id <= 0) continue
        const name = nameRaw || `Group ${id}`
        items.push({ library: { type: 'group', id }, name })
      }
      if (headers.get('zotero-server-id')) serverId = headers.get('zotero-server-id') ?? serverId
    } catch (error) {
      if (isNotFoundError(error)) {
        // older Zotero without groups listing: just personal
      } else {
        throw error
      }
    }
    const total = items.length
    const slice = items.slice(request.offset, request.offset + request.limit)
    return {
      kind: 'libraries',
      ...(serverId ? { serverId } : {}),
      items: slice,
      total,
      offset: request.offset,
      returned: slice.length,
      ...(request.offset + slice.length < total
        ? { nextOffset: request.offset + slice.length }
        : {}),
    }
  }

  private async browseCollections(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
    // Breadcrumbs need the whole ancestor chain, so a collections browse
    // cannot page server-side. It shares the TTL snapshot with scope-name
    // resolution instead: at most one full graph fetch per window, and every
    // later browse (or name lookup) serves from the cached graph. The
    // streamed-response byte cap remains the hard bound on the fetch itself.
    const listing = await this.scopeListingOf('collections', { library }, signal)
    const serverId = listing.serverId
    const detailed = new Map<string, { name: string; parentKey?: string }>()
    for (const entry of listing.entries) {
      detailed.set(entry.key, {
        name: entry.name,
        ...(entry.parentKey !== undefined ? { parentKey: entry.parentKey } : {}),
      })
    }

    const items: ZoteroCollectionInfo[] = []
    for (const [key, meta] of detailed.entries()) {
      const stack: string[] = []
      const visited = new Set<string>()
      let cur: string | undefined = key
      while (cur !== undefined && !visited.has(cur)) {
        visited.add(cur)
        const node = detailed.get(cur)
        if (node === undefined) break
        stack.unshift(node.name)
        const pk = node.parentKey
        if (pk === undefined) break
        if (!detailed.has(pk)) break // missing parent: fail-closed, do not include phantom parent in path
        cur = pk
      }
      const path = stack
      const depth = path.length > 0 ? path.length - 1 : 0
      // Fail-closed: only emit parentRef when parent exists in detailed; otherwise omit to keep path contract
      const parentKey = meta.parentKey
      const parentExists = parentKey !== undefined && detailed.has(parentKey)
      const parentRef = parentExists
        ? formatRef(refForLibrary(library, 'collection', parentKey!, serverId))
        : undefined
      items.push({
        ref: formatRef(refForLibrary(library, 'collection', key, serverId)),
        name: meta.name,
        ...(parentRef ? { parentRef } : {}),
        path,
        depth,
      })
    }
    items.sort(
      (a, b) => a.path.join('/').localeCompare(b.path.join('/')) || a.name.localeCompare(b.name),
    )
    const total = items.length
    const slice = items.slice(request.offset, request.offset + request.limit)
    return {
      kind: 'collections',
      library,
      ...(serverId ? { serverId } : {}),
      items: slice,
      total,
      offset: request.offset,
      returned: slice.length,
      ...(request.offset + slice.length < total
        ? { nextOffset: request.offset + slice.length }
        : {}),
    }
  }

  private async browseSavedSearches(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
    const prefix = libraryPrefix(library)
    // Browsing pages server-side and reads only its own window; scope-name
    // resolution keeps the full-listing path under the TTL cache. The two
    // acquisition strategies stay separate so a browse page never has to
    // fetch the whole library just to show `limit` rows.
    const params = new URLSearchParams()
    params.set('start', String(request.offset))
    params.set('limit', String(request.limit))
    const { json, headers } = await this.client.getJson<unknown>(`${prefix}/searches`, params, {
      signal,
    })
    const serverId = headers.get('zotero-server-id') ?? undefined
    const rawRows = Array.isArray(json) ? json : []
    const headerTotal = headers.get('total-results') ?? headers.get('Total-Results')
    if (
      headerTotal === null ||
      headerTotal === undefined ||
      headerTotal.trim() === '' ||
      !/^\d+$/.test(headerTotal.trim())
    ) {
      throw new ZoteroError(
        'Zotero did not return a valid Total-Results header for saved searches',
        ZOTERO_UNEXPECTED,
      )
    }
    const total = Number(headerTotal.trim())
    const entries: ScopeNameEntry[] = rawRows.map((row) => normalizeScopeEntry(row))
    const condByKey = new Map<string, unknown>()
    for (const row of rawRows) {
      const rec = asRecord(row)
      const key = asString(rec?.key)
      if (key === undefined || !isObjectKey(key)) continue
      const data = asRecord(rec?.data)
      const cond = data?.conditions ?? (rec as Record<string, unknown>)?.conditions
      if (cond !== undefined) condByKey.set(key, cond)
    }
    const items = entries
      .map((entry) => ({
        ref: formatRef(refForLibrary(library, 'search', entry.key, serverId)),
        name: entry.name,
        ...(condByKey.has(entry.key) ? { conditions: condByKey.get(entry.key) } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return {
      kind: 'savedSearches',
      library,
      ...(serverId ? { serverId } : {}),
      items,
      total,
      offset: request.offset,
      returned: items.length,
      ...(request.offset + items.length < total
        ? { nextOffset: request.offset + items.length }
        : {}),
    }
  }

  private async browseTags(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
    const prefix = libraryPrefix(library)
    const params = new URLSearchParams()
    if (request.q !== undefined && request.q !== '') {
      params.set('q', request.q)
      params.set('qmode', request.match === 'startsWith' ? 'startsWith' : 'contains')
    }
    params.set('start', String(request.offset))
    params.set('limit', String(request.limit))
    const { json, headers } = await this.client.getJson<unknown>(`${prefix}/tags`, params, {
      signal,
    })
    const serverId = headers.get('zotero-server-id') ?? undefined
    const rawRows = Array.isArray(json) ? json : []
    const headerTotal = headers.get('total-results') ?? headers.get('Total-Results')
    if (
      headerTotal === null ||
      headerTotal === undefined ||
      headerTotal.trim() === '' ||
      !/^\d+$/.test(headerTotal.trim())
    ) {
      throw new ZoteroError(
        'Zotero did not return a valid Total-Results header for tags',
        ZOTERO_UNEXPECTED,
      )
    }
    const total = Number(headerTotal.trim())
    const items = rawRows
      .map((row) => {
        const rec = asRecord(row)
        const tag = asString(rec?.tag) ?? asString(asRecord(rec?.data)?.tag)
        if (tag === undefined) return null
        const metaCount = asRecord(rec?.meta)?.numItems
        const directCount = rec?.numItems
        const count =
          typeof metaCount === 'number'
            ? metaCount
            : typeof directCount === 'number'
              ? directCount
              : undefined
        return { tag, ...(count !== undefined ? { count } : {}) }
      })
      .filter((x): x is { tag: string; count?: number } => x !== null)
    return {
      kind: 'tags',
      library,
      ...(serverId ? { serverId } : {}),
      items,
      total,
      offset: request.offset,
      returned: items.length,
      ...(request.offset + items.length < total
        ? { nextOffset: request.offset + items.length }
        : {}),
    }
  }

  private async browseItemTypes(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const { json, headers } = await this.client.getJson<unknown>('itemTypes', undefined, { signal })
    const serverId = headers.get('zotero-server-id') ?? undefined
    let raw: { itemType: string; localized?: string }[] = []
    if (Array.isArray(json)) {
      raw = json
        .map((row) => {
          const rec = asRecord(row)
          const it = asString(rec?.itemType) ?? asString(rec?.name)
          if (it === undefined) return null
          const loc = asString(rec?.localized) ?? asString(rec?.displayName)
          return { itemType: it, ...(loc ? { localized: loc } : {}) }
        })
        .filter((x): x is { itemType: string; localized?: string } => x !== null)
    }
    raw.sort((a, b) => a.itemType.localeCompare(b.itemType))
    const items = raw
    const total = items.length
    const slice = items.slice(request.offset, request.offset + request.limit)
    return {
      kind: 'itemTypes',
      ...(serverId ? { serverId } : {}),
      items: slice,
      total,
      offset: request.offset,
      returned: slice.length,
      ...(request.offset + slice.length < total
        ? { nextOffset: request.offset + slice.length }
        : {}),
    }
  }
}
