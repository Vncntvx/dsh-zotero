/**
 * The `zotero_search` domain: query serialization into the Local API's
 * documented parameters, scope resolution through the {@link ScopeDirectory},
 * server-side paging under an honest Total-Results total, and the first-page
 * client-side note-body scan listed beside the paged results.
 * @module dsh-zotero/local/search-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { mapWithConcurrency } from '../concurrency.js'
import { ZOTERO_ITEMKEY_BATCH, ZOTERO_SEARCH_CONCURRENCY } from '../constants.js'
import { tokenize } from '../evidence.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import { nextOffsetOf, requireTotalResults } from './pagination.js'
import { resolveScope, ScopeDirectory, type ResolvedScopeResult } from './scope-directory.js'
import { asRecord, asString } from '../json.js'
import { collectionKeysOf, normalizeSearchItem, plainNoteText } from '../normalize.js'
import { libraryPrefix, parseRef } from '../refs.js'
import type { LocalApiLimits } from './limits.js'
import type {
  SupportedLocalLibrary,
  ZoteroResolvedScope,
  ZoteroSearchItem,
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

export async function runSearch(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroSearchResult> {
  if (request.includeTrashed && request.scope.kind !== 'library') {
    throw new ZoteroError(INCLUDE_TRASHED_SCOPE_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  const scope = await resolveScope(directory, request.scope, request.library, signal)
  const { json, headers } = await deps.client.getJson<unknown>(
    scope.path,
    buildSearchParams(request),
    {
      signal,
      serverId: scope.serverId,
    },
  )
  const rows = Array.isArray(json) ? json : []
  const responseServerId = headers.get('zotero-server-id') ?? scope.serverId
  const libraryForItems = libraryOfResolvedScope(scope.resolved)
  const ctxForSearch: { library: SupportedLocalLibrary; serverId?: string } = {
    library: libraryForItems,
    serverId: responseServerId ?? undefined,
  }
  const items = rows.map((row) => normalizeSearchItem(row, ctxForSearch))
  // Pagination honesty is uniform across every paged listing: without a
  // valid Total-Results header the call fails instead of guessing a total.
  const apiTotal = requireTotalResults(headers, 'items top listing')
  // Zotero's index never searches note bodies, so the first page of a
  // queried search lists client-side note-content matches in `supplemental`
  // — a separate list beside the paged primary results, up to the primary
  // page's unused headroom. Pagination stays API-driven: later pages skip
  // the scan, and the paged fields never fold in supplement counts.
  let supplemental: ZoteroSearchSupplement | undefined
  const query = request.query?.trim()
  if (query !== undefined && query !== '' && shouldScanNotes(request, scope.resolved)) {
    const terms = tokenize(query)
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
      const isSaturated = (scannedRows: readonly unknown[]): boolean => {
        let count = 0
        for (const row of scannedRows) {
          const key = asString(asRecord(row)?.key)
          if (key === undefined || seen.has(key)) continue
          if (noteRowMatches(row, terms, request, scope.collectionKey)) {
            count += 1
            if (count >= headroom) return true
          }
        }
        return false
      }
      const scan = await fetchNoteRows(deps, scope, request, signal, isSaturated)
      // Matched rows keep scan order; child notes wait here for the
      // parent-membership resolution below before they can join the page.
      const matched: { row: unknown; key: string; parentKey?: string }[] = []
      for (const row of scan.rows) {
        if (matched.length >= headroom) break
        const key = asString(asRecord(row)?.key)
        if (key === undefined || seen.has(key)) continue
        if (!noteRowMatches(row, terms, request, scope.collectionKey)) continue
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
          scanned: scan.rows.length,
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
  const nextOffset = nextOffsetOf(request.offset, items.length, apiTotal)
  if (nextOffset !== undefined) result.nextOffset = nextOffset
  return result
}

/** Whether a search request qualifies for the client-side note-body scan. */
function shouldScanNotes(request: ZoteroSearchRequest, resolved: ZoteroResolvedScope): boolean {
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
async function fetchNoteRows(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  scope: ResolvedScopeResult,
  request: ZoteroSearchRequest,
  signal: AbortSignal | undefined,
  shouldStop?: (accumulated: readonly unknown[]) => boolean,
): Promise<{ rows: readonly unknown[]; truncated: boolean }> {
  const libraryForScan = libraryOfResolvedScope(scope.resolved)
  let prefix = libraryPrefix(libraryForScan)
  // A publications-scoped scan must stay inside My Publications; the bare
  // library prefix would leak note matches from outside the segment.
  if (scope.resolved.kind === 'publications') prefix += '/publications'
  const out: unknown[] = []
  let start = 0
  while (out.length < deps.limits.maxNoteScanRecords) {
    const wanted = Math.min(100, deps.limits.maxNoteScanRecords - out.length)
    const params = new URLSearchParams()
    params.set('itemType', 'note')
    params.set('sort', 'dateModified')
    params.set('direction', 'desc')
    params.set('start', String(start))
    params.set('limit', String(wanted))
    if (request.includeTrashed) params.set('includeTrashed', '1')
    const { json } = await deps.client.getJson<unknown>(`${prefix}/items`, params, {
      signal,
      serverId: scope.serverId,
    })
    const rows = Array.isArray(json) ? json : []
    if (rows.length === 0) break
    out.push(...rows.slice(0, wanted))
    if (shouldStop?.(out) === true) break
    // Fewer rows than requested means the library has no more notes.
    if (rows.length < wanted) break
    start += rows.length
  }
  return { rows: out, truncated: out.length >= deps.limits.maxNoteScanRecords }
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
async function fetchParentCollections(
  deps: { client: ZoteroHttpClient },
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
    ZOTERO_SEARCH_CONCURRENCY,
    async (chunk, poolSignal) => {
      const params = new URLSearchParams()
      params.set('itemKey', chunk.join(','))
      const { json } = await deps.client.getJson<unknown>(
        `${libraryPrefix(library)}/items`,
        params,
        { signal: poolSignal, serverId },
      )
      const memberships = new Map<string, Set<string>>()
      for (const row of Array.isArray(json) ? json : []) {
        const key = asString(asRecord(row)?.key)
        if (key === undefined) continue
        memberships.set(key, new Set(collectionKeysOf(row)))
      }
      return memberships
    },
    { signal },
  )
  const merged = new Map<string, Set<string>>()
  for (const memberships of membershipsPerChunk) {
    for (const [key, collections] of memberships) merged.set(key, collections)
  }
  return merged
}

/**
 * The library a resolved scope reads from. `library` and `publications`
 * scopes carry it directly; a `collection` or `savedSearch` scope carries the
 * plugin's own canonical ref (`formatRef` of the resolved object), whose
 * library segment is the answer. The parse is therefore total for anything
 * `resolveScope` produced, and it is deliberately not wrapped in a fallback:
 * a scope whose ref does not parse is a broken invariant, and answering it
 * from the personal library would attribute another library's rows to this
 * scope — the same silent substitution a wrong object key would cause.
 */
function libraryOfResolvedScope(resolved: ZoteroResolvedScope): SupportedLocalLibrary {
  if (resolved.kind !== 'collection' && resolved.kind !== 'savedSearch') {
    return resolved.library
  }
  return parseRef(resolved.ref).library as SupportedLocalLibrary
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
