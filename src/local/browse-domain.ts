/**
 * The `zotero_browse` domain: the six bounded discovery kinds — libraries,
 * server-side collection navigation with breadcrumb walks, saved searches,
 * scoped tag facets, item types, and per-type metadata fields. Argument
 * cross-constraints fail closed at the entry before any request.
 * @module dsh-zotero/local/browse-domain
 */

import {
  isNotFoundError,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_UNEXPECTED,
  ZoteroError,
} from '../errors.js'
import { asRecord, asString, isObjectKey } from '../json.js'
import { normalizeScopeEntry, type ScopeNameEntry } from '../normalize.js'
import {
  formatRef,
  isRefString,
  libraryPrefix,
  parseRef,
  refForLibrary,
  requireSupportedLocalRef,
  sameLibrary,
  PERSONAL_GROUPS_DISCOVERY,
  PERSONAL_LIBRARY,
} from '../refs.js'
import { requireTotalResults, nextOffsetOf } from './pagination.js'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { isLosslessJson } from '../normalize.js'
import type { ScopeDirectory } from './scope-directory.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits } from './limits.js'
import type {
  SupportedLocalLibrary,
  ZoteroBrowseKind,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCollectionInfo,
  ZoteroCreatorTypeInfo,
  ZoteroItemFieldInfo,
  ZoteroItemTypeInfo,
  ZoteroLibraryInfo,
  ZoteroObjectRef,
} from '../types.js'

export async function runBrowse(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroBrowseRequest,
  signal?: AbortSignal,
): Promise<ZoteroBrowseResult> {
  const maxBrowse = deps.limits.maxBrowseResults
  if (!Number.isInteger(request.offset) || request.offset < 0) {
    throw new ZoteroError('offset must be a non-negative integer', ZOTERO_INVALID_ARGUMENT)
  }
  if (!Number.isInteger(request.limit) || request.limit <= 0 || request.limit > maxBrowse) {
    throw new ZoteroError(`limit must be integer 1..${maxBrowse}`, ZOTERO_INVALID_ARGUMENT)
  }
  // Fail-closed: libraries/itemTypes/itemFields are global, so the library
  // parameter must not be set for them.
  if (
    (request.kind === 'libraries' ||
      request.kind === 'itemTypes' ||
      request.kind === 'itemFields') &&
    request.library !== undefined
  ) {
    throw new ZoteroError(
      `library is not allowed for kind ${request.kind}; omit library for libraries/itemTypes/itemFields`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  if (
    (request.kind === 'libraries' ||
      request.kind === 'itemTypes' ||
      request.kind === 'collections' ||
      request.kind === 'savedSearches' ||
      request.kind === 'tags') &&
    request.itemType !== undefined
  ) {
    throw new ZoteroError(`itemType is only valid when kind="itemFields"`, ZOTERO_INVALID_ARGUMENT)
  }
  if (request.kind === 'itemFields') {
    if (request.itemType === undefined || !/^[A-Za-z][A-Za-z0-9]*$/.test(request.itemType)) {
      throw new ZoteroError(
        'kind="itemFields" requires a Zotero item type name (e.g. dataset, journalArticle)',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    return await browseItemFields(deps, directory, request, signal)
  }
  if ((request.q !== undefined || request.match !== undefined) && request.kind !== 'tags') {
    throw new ZoteroError('q/match are only valid when kind="tags"', ZOTERO_INVALID_ARGUMENT)
  }
  if (request.parentRef !== undefined && request.kind !== 'collections') {
    throw new ZoteroError(
      'parentRef is only valid when kind="collections"',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  if (
    (request.scope !== undefined ||
      request.itemLevel !== undefined ||
      request.itemQuery !== undefined ||
      request.itemQueryMode !== undefined) &&
    request.kind !== 'tags'
  ) {
    throw new ZoteroError(
      'scope/itemLevel/itemQuery are only valid when kind="tags"',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  if (request.scope === undefined) {
    if (request.itemLevel !== undefined || request.itemQuery !== undefined) {
      throw new ZoteroError(
        'itemLevel/itemQuery require a scope (library, collection, or publications)',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
  } else if (request.scope.kind === 'collection' && !isRefString(request.scope.refOrName)) {
    // Name resolution happens in browseTags via resolveNamed; nothing to
    // check here beyond non-emptiness.
    if (request.scope.refOrName.trim() === '') {
      throw new ZoteroError('scope.refOrName must be a non-empty string', ZOTERO_INVALID_ARGUMENT)
    }
  }
  switch (request.kind) {
    case 'libraries':
      return await browseLibraries(deps, directory, request, signal)
    case 'collections':
      return await browseCollections(deps, directory, request, signal)
    case 'savedSearches':
      return await browseSavedSearches(deps, directory, request, signal)
    case 'tags':
      return await browseTags(deps, directory, request, signal)
    case 'itemTypes':
      return await browseItemTypes(deps, directory, request, signal)
    default:
      throw new ZoteroError(
        `Unsupported browse kind ${(request as { kind: string }).kind}`,
        ZOTERO_INVALID_ARGUMENT,
      )
  }
}

async function browseLibraries(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroBrowseRequest,
  signal?: AbortSignal,
): Promise<ZoteroBrowseResult> {
  let serverId: string | undefined
  const items: ZoteroLibraryInfo[] = []
  // personal always present
  items.push({ library: PERSONAL_LIBRARY, name: 'My Library' })
  // try to discover groups; Zotero 7/8/9 may 404
  try {
    const { json, headers } = await deps.client.getJson<unknown>(
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
        asString(rec?.name) ?? asString(asRecord(rec?.data)?.name) ?? asString(rec?.groupName) ?? ''
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
  const next = nextOffsetOf(request.offset, slice.length, total)
  return {
    kind: 'libraries',
    ...(serverId ? { serverId } : {}),
    items: slice,
    total,
    offset: request.offset,
    returned: slice.length,
    ...(next !== undefined ? { nextOffset: next } : {}),
  }
}

/**
 * Browse collections as real tree navigation: no `parentRef` lists
 * top-level collections (`/collections/top`), a `parentRef` lists that
 * collection's children — both server-side paged, so a page never depends
 * on the whole library graph. Breadcrumbs resolve lazily: each row's own
 * `parentCollection` field drives a per-key ancestor walk (TTL-cached,
 * cycle-guarded), and an ancestor the API cannot serve truncates the path
 * fail-closed instead of inventing one.
 */
async function browseCollections(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroBrowseRequest,
  signal?: AbortSignal,
): Promise<ZoteroBrowseResult> {
  const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
  const prefix = libraryPrefix(library)
  let listPath = `${prefix}/collections/top`
  if (request.parentRef !== undefined) {
    const parentRef = requireSupportedLocalRef(parseRef(request.parentRef), ['collection'])
    if (!sameLibrary(parentRef.library as SupportedLocalLibrary, library)) {
      throw new ZoteroError(
        `Library mismatch: parentRef is ${parentRef.library.type}/${parentRef.library.id} but request library is ${library.type}/${library.id}.`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    listPath = `${prefix}/collections/${parentRef.key}/collections`
  }
  const params = new URLSearchParams()
  params.set('start', String(request.offset))
  params.set('limit', String(request.limit))
  const { json, headers } = await deps.client.getJson<unknown>(listPath, params, { signal })
  const serverId = headers.get('zotero-server-id') ?? undefined
  const total = requireTotalResults(headers, 'collections')
  const items: ZoteroCollectionInfo[] = []
  for (const row of Array.isArray(json) ? json : []) {
    const entry = normalizeScopeEntry(row)
    const ancestors = await directory.collectionAncestorNames(
      library,
      entry.key,
      entry.parentKey,
      serverId,
      signal,
    )
    const path = [...ancestors, entry.name]
    items.push({
      ref: formatRef(refForLibrary(library, 'collection', entry.key, serverId)),
      name: entry.name,
      ...(entry.parentKey !== undefined
        ? {
            parentRef: formatRef(refForLibrary(library, 'collection', entry.parentKey, serverId)),
          }
        : {}),
      path,
      depth: path.length - 1,
    })
  }
  // A page-local sort keeps output deterministic without re-sorting the
  // library; ordering across pages belongs to Zotero.
  items.sort((a, b) => a.name.localeCompare(b.name))
  const next = nextOffsetOf(request.offset, items.length, total)
  return {
    kind: 'collections',
    library,
    ...(serverId ? { serverId } : {}),
    items,
    total,
    offset: request.offset,
    returned: items.length,
    ...(next !== undefined ? { nextOffset: next } : {}),
  }
}

async function browseSavedSearches(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
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
  const { json, headers } = await deps.client.getJson<unknown>(`${prefix}/searches`, params, {
    signal,
  })
  const serverId = headers.get('zotero-server-id') ?? undefined
  const rawRows = Array.isArray(json) ? json : []
  const total = requireTotalResults(headers, 'saved searches')
  const entries: ScopeNameEntry[] = rawRows.map((row) => normalizeScopeEntry(row))
  const condByKey = new Map<string, Record<string, JsonValue>[]>()
  for (const row of rawRows) {
    const rec = asRecord(row)
    const key = asString(rec?.key)
    if (key === undefined || !isObjectKey(key)) continue
    const data = asRecord(rec?.data)
    const cond = data?.conditions ?? (rec as Record<string, unknown>)?.conditions
    // Zotero's saved-search conditions are an array of row objects; anything
    // else on the wire is treated as absence rather than passed through.
    if (
      Array.isArray(cond) &&
      cond.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))
    ) {
      condByKey.set(key, cond as Record<string, JsonValue>[])
    }
  }
  const items = entries
    .map((entry) => ({
      ref: formatRef(refForLibrary(library, 'search', entry.key, serverId)),
      name: entry.name,
      ...(condByKey.has(entry.key) ? { conditions: condByKey.get(entry.key) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const next = nextOffsetOf(request.offset, items.length, total)
  return {
    kind: 'savedSearches',
    library,
    ...(serverId ? { serverId } : {}),
    items,
    total,
    offset: request.offset,
    returned: items.length,
    ...(next !== undefined ? { nextOffset: next } : {}),
  }
}

/**
 * Browse tags, optionally scoped: without a scope this is the
 * whole-library `/tags` listing; with a scope the scoped tag endpoints
 * count tags over a faceted item set — a collection or My Publications,
 * top-level by default or all items, optionally narrowed to items matching
 * an item query. That makes "search → which tags do these hits carry →
 * narrow" a server-side round trip instead of client-side guessing.
 */
async function browseTags(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroBrowseRequest,
  signal?: AbortSignal,
): Promise<ZoteroBrowseResult> {
  const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
  const prefix = libraryPrefix(library)
  const itemsSegment = request.itemLevel === 'all' ? 'items' : 'items/top'
  let path = `${prefix}/tags`
  let serverIdClaim: string | undefined
  if (request.scope !== undefined) {
    switch (request.scope.kind) {
      case 'library':
        path = `${prefix}/${itemsSegment}/tags`
        break
      case 'publications':
        path = `${prefix}/publications/${itemsSegment}/tags`
        break
      case 'collection': {
        const found = await directory.resolveNamed(
          'collection',
          request.scope.refOrName,
          library,
          signal,
        )
        serverIdClaim = found.ref.serverId
        path = `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/collections/${found.ref.key}/${itemsSegment}/tags`
        break
      }
    }
  }
  const params = new URLSearchParams()
  if (request.q !== undefined && request.q !== '') {
    params.set('q', request.q)
    params.set('qmode', request.match === 'startsWith' ? 'startsWith' : 'contains')
  }
  if (request.itemQuery !== undefined && request.itemQuery !== '') {
    params.set('itemQ', request.itemQuery)
    params.set('itemQMode', request.itemQueryMode ?? 'titleCreatorYear')
  }
  params.set('start', String(request.offset))
  params.set('limit', String(request.limit))
  const { json, headers } = await deps.client.getJson<unknown>(path, params, {
    signal,
    ...(serverIdClaim !== undefined ? { serverId: serverIdClaim } : {}),
  })
  const serverId = headers.get('zotero-server-id') ?? serverIdClaim
  const rawRows = Array.isArray(json) ? json : []
  const total = requireTotalResults(headers, 'tags')
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
  const next = nextOffsetOf(request.offset, items.length, total)
  return {
    kind: 'tags',
    library,
    ...(serverId ? { serverId } : {}),
    items,
    total,
    offset: request.offset,
    returned: items.length,
    ...(next !== undefined ? { nextOffset: next } : {}),
  }
}

async function browseItemTypes(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroBrowseRequest,
  signal?: AbortSignal,
): Promise<ZoteroBrowseResult> {
  const { json, headers } = await deps.client.getJson<unknown>('itemTypes', undefined, { signal })
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
  const next = nextOffsetOf(request.offset, slice.length, total)
  return {
    kind: 'itemTypes',
    ...(serverId ? { serverId } : {}),
    items: slice,
    total,
    offset: request.offset,
    returned: slice.length,
    ...(next !== undefined ? { nextOffset: next } : {}),
  }
}

/**
 * The metadata fields and creator types valid for one item type, with the
 * localized labels Zotero reports for the user's locale. This is the
 * schema-aware read behind `fields:"all"`: when a dataset or patent's
 * fields would be dropped by the normalized model, the model can look up
 * what exists and ask for it by name.
 */
async function browseItemFields(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroBrowseRequest,
  signal?: AbortSignal,
): Promise<ZoteroBrowseResult> {
  const itemType = request.itemType!
  const params = new URLSearchParams()
  params.set('itemType', itemType)
  const [fields, creatorTypes] = await Promise.all([
    deps.client.getJson<unknown>('itemTypeFields', params, { signal }),
    deps.client.getJson<unknown>('itemTypeCreatorTypes', params, { signal }),
  ])
  const serverId =
    fields.headers.get('zotero-server-id') ??
    creatorTypes.headers.get('zotero-server-id') ??
    undefined
  const localizedOf = (row: unknown): { field?: string; localized?: string } => {
    const rec = asRecord(row)
    return {
      field: asString(rec?.field),
      localized: asString(rec?.localized),
    }
  }
  const items: (ZoteroItemFieldInfo | ZoteroCreatorTypeInfo)[] = []
  for (const row of Array.isArray(fields.json) ? fields.json : []) {
    const { field, localized } = localizedOf(row)
    if (field === undefined) continue
    items.push({ field, ...(localized !== undefined ? { localized } : {}) })
  }
  for (const row of Array.isArray(creatorTypes.json) ? creatorTypes.json : []) {
    const rec = asRecord(row)
    const creatorType = asString(rec?.creatorType)
    if (creatorType === undefined) continue
    const localized = asString(rec?.localized)
    items.push({ creatorType, ...(localized !== undefined ? { localized } : {}) })
  }
  items.sort((a, b) =>
    'field' in a && 'field' in b
      ? a.field.localeCompare(b.field)
      : 'creatorType' in a && 'creatorType' in b
        ? a.creatorType.localeCompare(b.creatorType)
        : 0,
  )
  const total = items.length
  const slice = items.slice(request.offset, request.offset + request.limit)
  const next = nextOffsetOf(request.offset, slice.length, total)
  return {
    kind: 'itemFields',
    ...(serverId ? { serverId } : {}),
    items: slice,
    total,
    offset: request.offset,
    returned: slice.length,
    ...(next !== undefined ? { nextOffset: next } : {}),
  }
}
