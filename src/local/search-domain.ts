/**
 * The `zotero_search` domain: query serialization into the Local API's
 * documented parameters, scope resolution through the {@link ScopeDirectory},
 * server-side paging under an honest Total-Results total, and the first-page
 * client-side note-body scan listed beside the paged results.
 * @module dsh-zotero/local/search-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_LIST_PAGE_ROWS, ZOTERO_YEAR_MAX, ZOTERO_YEAR_MIN } from '../constants.js'
import { tokenize } from '../evidence.js'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'
import {
  nextOffsetOrFail,
  readPagesConcurrentlyFolded,
  requireArrayBody,
  requireTotalResults,
  nextOffsetOf,
  setPage,
} from './pagination.js'
import { serverIdFromHeaders } from './identity.js'
import { fetchItemKeyBatches } from './item-batch.js'
import { parseRef, libraryPrefix } from '../refs.js'
import {
  publicationsItemsPath,
  resolveScope,
  ScopeDirectory,
  type ResolvedScopeResult,
} from './scope-directory.js'
import { asRecord, asString } from '../json.js'
import { collectionKeysOf, normalizeSearchItem, plainNoteText } from '../normalize.js'
import { requireSupportedLibraryOfRef } from '../refs.js'
import {
  attachmentParentKeys,
  attachmentParentsCacheKey,
  searchIndexKeyOf,
  searchRowsByKeys,
  type FilteredCandidate,
  type FilteredIndex,
  type SearchIndexCaches,
} from './search-index.js'
import type { LocalApiLimits } from './limits.js'
import type {
  SupportedLocalLibrary,
  ZoteroResolvedScope,
  ZoteroSearchItem,
  ZoteroSearchOptions,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroSearchSupplement,
} from '../types.js'

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

/**
 * The model-facing message for `includeTrashed` outside a library scope. The
 * tool layer states the same rule for its own argument, but renders it without
 * the full stop, so the two are separate constants rather than one shared one.
 */
export const INCLUDE_TRASHED_SCOPE_MESSAGE = 'includeTrashed is only allowed with library scope.'

/**
 * Serialize a search request into the Local API's documented query parameters,
 * without the paging window. Repeated `tag` values survive here, so the
 * concurrent page reader can clone the query per page. `buildSearchParams`
 * adds `start`/`limit` on top.
 */
function searchQueryOf(request: ZoteroSearchRequest): URLSearchParams {
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
  return params
}

/** Serialize a search request into the Local API's documented query parameters. */
export function buildSearchParams(request: ZoteroSearchRequest): URLSearchParams {
  return setPage(
    new URLSearchParams(searchQueryOf(request).toString()),
    request.offset,
    request.limit,
  )
}

export async function runSearch(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits; searchCaches: SearchIndexCaches },
  directory: ScopeDirectory,
  request: ZoteroSearchRequest,
  signal: AbortSignal | undefined,
  options: ZoteroSearchOptions,
): Promise<ZoteroSearchResult> {
  if (request.includeTrashed && request.scope.kind !== 'library') {
    throw new ZoteroError(INCLUDE_TRASHED_SCOPE_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  const scope = await resolveScope(directory, request.scope, request.library, {
    signal,
    itemLevel: request.itemLevel,
  })
  if (
    request.yearFrom !== undefined ||
    request.yearTo !== undefined ||
    request.hasAttachment !== undefined
  ) {
    // The exact path serves paged primary hits only and cannot scan note
    // bodies, so a caller that also asks for the supplement is refused.
    if (options.includeSupplemental) {
      throw new ZoteroError(FILTERED_SEARCH_SUPPLEMENT_MESSAGE, ZOTERO_INVALID_ARGUMENT)
    }
    return exactFilteredSearch(deps, scope, request, signal, options)
  }
  const { json, headers } = await deps.client.getJson<unknown>(
    scope.path,
    buildSearchParams(request),
    {
      signal,
      serverId: scope.serverId,
    },
  )
  const rows = requireArrayBody(json, 'items top listing')
  const responseServerId = serverIdFromHeaders(headers, scope.serverId)
  const libraryForItems = libraryOfResolvedScope(scope.resolved)
  const ctxForSearch: { library: SupportedLocalLibrary; serverId?: string } = {
    library: libraryForItems,
    serverId: responseServerId,
  }
  const items = rows.map((row) => normalizeSearchItem(row, ctxForSearch))
  // Pagination honesty is uniform across every paged listing: without a
  // valid Total-Results header the call fails instead of guessing a total.
  const apiTotal = requireTotalResults(headers, 'items top listing')
  // A server-paged listing that answers an in-range page with no rows has
  // breached the total it just reported; `nextOffsetOrFail` fails loud.
  const nextOffset = nextOffsetOrFail(request.offset, items.length, apiTotal, 'search results')
  // Zotero's index never searches note bodies, so the first page of a
  // queried search lists client-side note-content matches in `supplemental`,
  // a separate list beside the paged primary results, up to the primary
  // page's unused headroom. Pagination stays API-driven: later pages skip
  // the scan, and the paged fields never fold in supplement counts.
  let supplemental: ZoteroSearchSupplement | undefined
  const query = request.query?.trim()
  // `shouldScanNotes` is the scan's single authority, query emptiness
  // included; the tokenizer below tolerates a blank query (zero terms) and
  // the guard inside turns it off.
  if (shouldScanNotes(request, scope.resolved, options.includeSupplemental)) {
    const terms = tokenize(query ?? '')
    // A query whose tokens are all punctuation/emoji/whitespace matches
    // every note (the empty token list is vacuously present), so the scan
    // stays disabled for it.
    // The API rows already fill `limit`; the supplement only fills the
    // page's remaining headroom, so a full page never runs the scan and
    // the result never exceeds the requested limit.
    const headroom = request.limit - rows.length
    if (terms.length > 0 && headroom > 0) {
      const seen = new Set(
        rows
          .map((row) => asString(asRecord(row)?.key))
          .filter((key): key is string => key !== undefined),
      )
      // One pass over the scan: the collector examines each batch's slice as
      // it arrives, so saturation and the supplement list share a single walk
      // instead of O(batches × rows) rescans. Matched rows keep scan order;
      // child notes wait here for the parent-membership resolution below
      // before they can join the page.
      const matched: { row: unknown; key: string; parentKey?: string }[] = []
      const collect = (added: readonly unknown[]): boolean => {
        for (const row of added) {
          if (matched.length >= headroom) return true
          const key = asString(asRecord(row)?.key)
          if (key === undefined || seen.has(key)) continue
          if (!noteRowMatches(row, terms, request, scope.collectionKey)) continue
          seen.add(key)
          const parentKey =
            scope.collectionKey === undefined
              ? undefined
              : asString(asRecord(asRecord(row)?.data)?.parentItem)
          matched.push({ row, key, ...(parentKey !== undefined ? { parentKey } : {}) })
        }
        return matched.length >= headroom
      }
      const scan = await fetchNoteRows(deps, scope, request, signal, collect)
      let memberships: Map<string, Set<string>> | undefined
      const pendingParents = matched
        .map((entry) => entry.parentKey)
        .filter((parentKey): parentKey is string => parentKey !== undefined)
      if (pendingParents.length > 0) {
        memberships = await fetchParentCollections(
          deps,
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
          scanned: scan.scanned,
          truncated: scan.truncated,
        }
      }
    }
  }
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

/**
 * The message for a filtered search that also asks for the note-body
 * supplement. The exact path serves paged primary hits only and cannot scan
 * note bodies.
 */
export const FILTERED_SEARCH_SUPPLEMENT_MESSAGE =
  'Year and attachment filters are panel-only and do not support the note-body supplement.'

/**
 * Serve one filtered page from the candidate index. The first request for a
 * filter definition scans the whole listing once (concurrently by page),
 * applies the year and attachment-existence filters, and stores the accepted
 * keys; every later page of the same filter definition slices those keys and
 * fetches the rows in batched `itemKey=` reads. A stored index is fenced by
 * the library version: a batch whose version differs from the scan drops the
 * index and rescans once, and a second drift fails loud.
 */
async function exactFilteredSearch(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits; searchCaches: SearchIndexCaches },
  scope: ResolvedScopeResult,
  request: ZoteroSearchRequest,
  signal: AbortSignal | undefined,
  options: ZoteroSearchOptions,
): Promise<ZoteroSearchResult> {
  if (
    (request.yearFrom !== undefined &&
      (!Number.isInteger(request.yearFrom) ||
        request.yearFrom < ZOTERO_YEAR_MIN ||
        request.yearFrom > ZOTERO_YEAR_MAX)) ||
    (request.yearTo !== undefined &&
      (!Number.isInteger(request.yearTo) ||
        request.yearTo < ZOTERO_YEAR_MIN ||
        request.yearTo > ZOTERO_YEAR_MAX)) ||
    (request.yearFrom !== undefined &&
      request.yearTo !== undefined &&
      request.yearFrom > request.yearTo)
  ) {
    throw new ZoteroError(
      `The year range must be an ordered closed interval between ${ZOTERO_YEAR_MIN} and ${ZOTERO_YEAR_MAX}.`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const library = libraryOfResolvedScope(scope.resolved)
  const includeTrashed = request.includeTrashed === true || scope.resolved.kind === 'trash'
  const indexKey = searchIndexKeyOf(scope, request, options.cacheGeneration)

  let index = deps.searchCaches.filtered.get(indexKey)
  let rescanned = false
  if (index === undefined) {
    index = await scanFilteredIndex(deps, scope, request, library, includeTrashed, signal, options)
    deps.searchCaches.filtered.put(indexKey, index)
    rescanned = true
  }

  /** Serve one page from an index; `undefined` means the index drifted. */
  const servePage = async (pageIndex: FilteredIndex): Promise<ZoteroSearchResult | undefined> => {
    const filtered = filteredCandidatesOf(pageIndex, request)
    const pageKeys = filtered
      .slice(request.offset, request.offset + request.limit)
      .map((candidate) => candidate.key)
    const { byKey, libraryVersion } = await searchRowsByKeys(
      deps,
      library,
      pageIndex.serverId,
      pageKeys,
      includeTrashed,
      signal,
    )
    const drifted =
      (pageIndex.libraryVersion !== undefined &&
        libraryVersion !== undefined &&
        libraryVersion !== pageIndex.libraryVersion) ||
      pageKeys.some((key) => !byKey.has(key))
    if (drifted) return undefined
    const items = pageKeys.map((key) => byKey.get(key)!)
    const nextOffset = nextOffsetOf(request.offset, items.length, filtered.length)
    return {
      scope: scope.resolved,
      items,
      total: filtered.length,
      offset: request.offset,
      returned: items.length,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    }
  }

  let page = await servePage(index)
  if (page === undefined) {
    if (rescanned) {
      throw new ZoteroError(
        'The library changed while a filtered search page was served; retry the request.',
        ZOTERO_UNEXPECTED,
      )
    }
    deps.searchCaches.filtered.delete(indexKey)
    index = await scanFilteredIndex(deps, scope, request, library, includeTrashed, signal, options)
    deps.searchCaches.filtered.put(indexKey, index)
    page = await servePage(index)
    if (page === undefined) {
      throw new ZoteroError(
        'The library changed while a filtered search page was served; retry the request.',
        ZOTERO_UNEXPECTED,
      )
    }
  }
  return page
}

/**
 * The index candidates one request's year/attachment filters accept. The
 * values are applied at page time: the stored index stays valid across year
 * edits and attachment toggles, and only the `attachmentIndexed` dimension
 * decides whether presence facts exist at all.
 */
function filteredCandidatesOf(
  index: FilteredIndex,
  request: ZoteroSearchRequest,
): readonly FilteredCandidate[] {
  return index.candidates.filter(
    (candidate) =>
      (request.yearFrom === undefined ||
        (candidate.year !== undefined && candidate.year >= request.yearFrom)) &&
      (request.yearTo === undefined ||
        (candidate.year !== undefined && candidate.year <= request.yearTo)) &&
      (request.hasAttachment === undefined || candidate.hasAttachment === request.hasAttachment),
  )
}

/**
 * Scan the whole listing once and store the candidate facts. The candidate
 * scan and the attachment-presence walk run concurrently when the request
 * filters on attachment existence; each scan halves the configured
 * concurrency so the total stays inside the caller's budget.
 */
async function scanFilteredIndex(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits; searchCaches: SearchIndexCaches },
  scope: ResolvedScopeResult,
  request: ZoteroSearchRequest,
  library: SupportedLocalLibrary,
  includeTrashed: boolean,
  signal: AbortSignal | undefined,
  options: ZoteroSearchOptions,
): Promise<FilteredIndex> {
  const wantParents = request.hasAttachment !== undefined
  const scanConcurrency = wantParents
    ? Math.max(1, Math.floor(deps.limits.searchConcurrency / 2))
    : deps.limits.searchConcurrency
  const scanPromise = readPagesConcurrentlyFolded(
    deps.client,
    scope.path,
    // The scan's own offset/limit are placeholders: every page re-windows
    // the clone at the standard listing size.
    buildSearchParams(request),
    scope.serverId,
    signal,
    { body: 'filtered search candidates', page: 'filtered search candidates' },
    scanConcurrency,
    (rows) =>
      rows.map((row) => {
        const item = normalizeSearchItem(row, { library })
        return { key: parseRef(item.ref).key, year: item.year }
      }),
  )
  const parentsPromise = wantParents
    ? attachmentParentKeys(deps, deps.searchCaches, library, scope.serverId, includeTrashed, {
        cacheGeneration: options.cacheGeneration,
        signal,
      })
    : undefined
  // A scan that rejects first (an aborted caller, a version drift) must not
  // leave the concurrent walk's rejection unconsumed; awaiting it below still
  // surfaces the original rejection.
  if (parentsPromise !== undefined) void parentsPromise.catch(() => undefined)
  const scanned = await scanPromise
  let parentSet: ReadonlySet<string> | undefined
  if (parentsPromise !== undefined) {
    const fetched = await parentsPromise
    const drifted =
      scanned.libraryVersion !== undefined &&
      fetched.libraryVersion !== undefined &&
      fetched.libraryVersion !== scanned.libraryVersion
    if (drifted && fetched.fromCache) {
      // A stored presence set read through an older revision: drop it and
      // re-read once before giving up.
      deps.searchCaches.attachmentParents.delete(
        attachmentParentsCacheKey(library, scope.serverId, includeTrashed, options.cacheGeneration),
      )
      const refetched = await attachmentParentKeys(
        deps,
        deps.searchCaches,
        library,
        scope.serverId,
        includeTrashed,
        { cacheGeneration: options.cacheGeneration, signal },
      )
      if (
        scanned.libraryVersion !== undefined &&
        refetched.libraryVersion !== undefined &&
        refetched.libraryVersion !== scanned.libraryVersion
      ) {
        throw new ZoteroError(
          'The library changed while attachment presence was indexed; retry the request.',
          ZOTERO_UNEXPECTED,
        )
      }
      parentSet = refetched.parents
    } else if (drifted) {
      throw new ZoteroError(
        'The library changed while attachment presence was indexed; retry the request.',
        ZOTERO_UNEXPECTED,
      )
    } else {
      parentSet = fetched.parents
    }
  }
  const candidates = scanned.pages.flatMap((page) => page.value)
  return {
    candidates:
      parentSet === undefined
        ? candidates
        : candidates.map((candidate) => ({
            key: candidate.key,
            year: candidate.year,
            hasAttachment: parentSet.has(candidate.key),
          })),
    attachmentIndexed: wantParents,
    ...(scanned.serverId !== undefined ? { serverId: scanned.serverId } : {}),
    ...(scanned.libraryVersion !== undefined ? { libraryVersion: scanned.libraryVersion } : {}),
    fetchedAt: Date.now(),
  }
}

/** Whether a search request qualifies for the client-side note-body scan. */
function shouldScanNotes(
  request: ZoteroSearchRequest,
  resolved: ZoteroResolvedScope,
  includeSupplemental: boolean,
): boolean {
  // The scan runs only for a caller that consumes the supplement; every
  // caller states it explicitly through the search options.
  if (!includeSupplemental) return false
  const query = request.query?.trim()
  // The trash scope skips the scan: the scan reads the live `/items` note
  // listing, and those rows are not the trash's rows.
  return (
    query !== undefined &&
    query !== '' &&
    request.offset === 0 &&
    resolved.kind !== 'savedSearch' &&
    resolved.kind !== 'trash' &&
    (request.itemTypes === undefined || request.itemTypes.includes('note'))
  )
}

/**
 * Fetch note rows for the body scan in dateModified-descending batches,
 * stopping at `maxNoteScanRecords`. The provider uses a 100-row batch as a
 * bounded scanning policy; the Local API itself has no default/maximum
 * limit for local requests, so fewer rows than requested reliably means EOF.
 * Note scan uses `/{libraryPrefix}/items` (not `/items/top`) so child notes
 * are included. `truncated` is true only when the cap stopped the scan with
 * notes still unread: a short page is EOF, and a scan that filled the cap
 * exactly is decided by a one-row probe at the cursor, because a library
 * whose note count divides the cap must not read as truncated.
 */
async function fetchNoteRows(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  scope: ResolvedScopeResult,
  request: ZoteroSearchRequest,
  signal: AbortSignal | undefined,
  shouldStop?: (added: readonly unknown[]) => boolean,
): Promise<{ scanned: number; truncated: boolean }> {
  const libraryForScan = libraryOfResolvedScope(scope.resolved)
  // A publications-scoped scan must stay inside My Publications; the bare
  // library prefix would leak note matches from outside the segment.
  const basePath =
    scope.resolved.kind === 'publications'
      ? publicationsItemsPath()
      : `${libraryPrefix(libraryForScan)}/items`
  const cap = deps.limits.maxNoteScanRecords
  const readRows = async (start: number, limit: number): Promise<readonly unknown[]> => {
    const params = new URLSearchParams()
    params.set('itemType', 'note')
    params.set('sort', 'dateModified')
    params.set('direction', 'desc')
    setPage(params, start, limit)
    if (request.includeTrashed) params.set('includeTrashed', '1')
    const { json } = await deps.client.getJson<unknown>(basePath, params, {
      signal,
      serverId: scope.serverId,
    })
    return requireArrayBody(json, 'note scan')
  }
  let scanned = 0
  let start = 0
  let endedByEof = false
  while (scanned < cap) {
    const wanted = Math.min(ZOTERO_LIST_PAGE_ROWS, cap - scanned)
    const rows = await readRows(start, wanted)
    if (rows.length === 0) {
      endedByEof = true
      break
    }
    const added = rows.slice(0, wanted)
    scanned += added.length
    if (shouldStop?.(added) === true) break
    // Fewer rows than requested means the library has no more notes.
    if (rows.length < wanted) {
      endedByEof = true
      break
    }
    start += rows.length
  }
  let truncated = false
  if (!endedByEof && scanned >= cap) {
    // The cap ended the scan on a full page, so EOF was never observed: one
    // one-row probe at the cursor decides between "more notes exist" and
    // "the library ends exactly here". Without it, a library whose note
    // count divides the cap would report a truncation that never happened.
    const rest = await readRows(start, 1)
    truncated = rest.length > 0
  }
  return { scanned, truncated }
}

/**
 * Resolve collection membership for child notes through their parents in
 * batched requests: child notes belong to a collection only via the
 * parent bibliographic item. Keys are deduplicated and split into
 * `ZOTERO_ITEMKEY_BATCH`-sized chunks (the Local API's hard per-request
 * cap for `itemKey=`) fetched through the bounded pool. A parent missing
 * from a response (e.g. trashed without `includeTrashed`) fails closed as
 * a non-member.
 */
async function fetchParentCollections(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  library: SupportedLocalLibrary,
  parentKeys: readonly string[],
  serverId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Map<string, Set<string>>> {
  const { byKey } = await fetchItemKeyBatches(deps, library, parentKeys, {
    ...(serverId !== undefined ? { serverId } : {}),
    ...(signal !== undefined ? { signal } : {}),
    what: 'parent item batch',
    onMissingKey: 'skip',
    mapRow: (row) => new Set(collectionKeysOf(row)),
  })
  return byKey
}

/**
 * The library a resolved scope reads from. `library` and `publications`
 * scopes carry it directly; a `collection` or `savedSearch` scope carries the
 * plugin's own canonical ref (`formatRef` of the resolved object), whose
 * library segment is the answer. The parse is therefore total for anything
 * `resolveScope` produced, and it is deliberately not wrapped in a fallback:
 * a scope whose ref does not parse is a broken invariant, and answering it
 * from the personal library would attribute another library's rows to this
 * scope, the same silent substitution a wrong object key would cause.
 */
function libraryOfResolvedScope(resolved: ZoteroResolvedScope): SupportedLocalLibrary {
  if (resolved.kind !== 'collection' && resolved.kind !== 'savedSearch') {
    return resolved.library
  }
  return requireSupportedLibraryOfRef(resolved.ref)
}

/**
 * Whether a note row satisfies the body scan: every query token appears
 * in the note text, plus the literal tag filters when present. Mirrors
 * server tag semantics: tagMatch, excludeTags, includeTrashed.
 *
 * Collection scope checks membership on the note itself only for
 * standalone notes: Zotero child notes carry no `collections` of their
 * own (membership belongs to the parent item), so they pass here and the
 * caller resolves membership through `fetchParentCollections`.
 */
function noteRowMatches(
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
  // The note side is tokenized exactly as the query terms were, so a note
  // the server-side search matched by token is not missed here.
  const tokens = new Set(tokenize(plainNoteText(data?.note)))
  return terms.every((term) => tokens.has(term))
}
