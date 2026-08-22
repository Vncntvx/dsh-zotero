/**
 * The `zotero_changes` domain: baseline version readings and `?since=` diffs
 * over the versions-format endpoints, with tombstones from /deleted. A
 * resource this Zotero build cannot serve degrades to absence instead of
 * failing the whole read.
 * @module dsh-zotero/local/changes-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { isNotFoundError, ZOTERO_NOT_FOUND } from '../errors.js'
import { asRecord, asString, isObjectKey } from '../json.js'
import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js'
import type { LocalApiLimits } from './limits.js'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'
import { requireTotalResults } from './pagination.js'
import type {
  SupportedLocalLibrary,
  ZoteroChangesInclude,
  ZoteroChangesRequest,
  ZoteroChangedObject,
  ZoteroChangesResult,
} from '../types.js'

/** The resource kinds a full `zotero_changes` diff covers, in request order. */
const ZOTERO_CHANGES_INCLUDES: readonly ZoteroChangesInclude[] = [
  'items',
  'collections',
  'savedSearches',
  'fulltext',
  'deleted',
]
/**
 * Diff the library against a local transaction version. Zotero 10+ versions
 * are local transactions: any edit, sync, or local-API write advances them,
 * so `?since=` answers "what changed here" without the cloud and without a
 * background watcher. Without `since` this is a baseline reading — just the
 * current version for the next call to diff from. `format=versions`
 * responses are key→version maps; `/deleted` returns tombstone key lists.
 * Each resource is capped at `maxBrowseResults` entries with an honest
 * `truncated` flag driven by the Total-Results header.
 */
export async function changes(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  request: ZoteroChangesRequest,
  signal?: AbortSignal,
): Promise<ZoteroChangesResult> {
  const library = request.library ?? PERSONAL_LIBRARY
  const prefix = libraryPrefix(library)
  const cap = deps.limits.maxBrowseResults
  const include = request.include ?? new Set(ZOTERO_CHANGES_INCLUDES)
  let serverId: string | undefined
  let toVersion: number | undefined

  /**
   * A diff resource this Zotero build does not serve (some local-API
   * versions 404 on `/deleted`, for example) contributes nothing instead
   * of failing the whole read — degradation matches the plugin's honest-
   * absence contract everywhere else.
   */
  const optional = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND) return undefined
      throw error
    }
  }

  if (request.since === undefined) {
    const baseline = await optional(async () => {
      const baselineParams = new URLSearchParams()
      baselineParams.set('limit', '1')
      return await deps.client.get(`${prefix}/items/top`, baselineParams, {
        signal,
      })
    })
    // A library that cannot serve versioned items at all has no changes
    // story; the baseline reading reports an unknown version.
    if (baseline === undefined) {
      return { library, changed: {} }
    }
    serverId = baseline.headers.get('zotero-server-id') ?? undefined
    const lastModified = baseline.headers.get('last-modified-version')
    toVersion =
      lastModified !== null && /^\d+$/.test(lastModified) ? Number(lastModified) : undefined
    return {
      library,
      ...(serverId !== undefined ? { serverId } : {}),
      ...(toVersion !== undefined ? { toVersion } : {}),
      changed: {},
    }
  }

  const fetchVersions = async (
    path: string,
  ): Promise<{ entries: ZoteroChangedObject[]; truncated: boolean }> => {
    const params = new URLSearchParams()
    params.set('since', String(request.since))
    params.set('format', 'versions')
    params.set('limit', String(cap))
    const { json, headers } = await deps.client.getJson<unknown>(path, params, { signal })
    serverId = serverId ?? headers.get('zotero-server-id') ?? undefined
    const lastModified = headers.get('last-modified-version')
    if (lastModified !== null && /^\d+$/.test(lastModified)) {
      toVersion = Math.max(toVersion ?? 0, Number(lastModified))
    }
    const map = asRecord(json)
    const entries = Object.entries(map ?? {})
      .filter(([key, version]) => isObjectKey(key) && typeof version === 'number')
      .map(([key, version]) => ({ key, version: version as number }))
      .sort((a, b) => b.version - a.version || a.key.localeCompare(b.key))
    const total = requireTotalResults(headers, 'versions listing')
    return { entries, truncated: total > entries.length }
  }

  const changed: {
    items?: ZoteroChangedObject[]
    collections?: ZoteroChangedObject[]
    savedSearches?: ZoteroChangedObject[]
    fulltextAttachments?: ZoteroChangedObject[]
  } = {}
  // When the tombstone read succeeds, all three lists exist together
  // (possibly empty) — matching the wire contract's required keys.
  const deleted: { items: string[]; collections: string[]; savedSearches: string[] } = {
    items: [],
    collections: [],
    savedSearches: [],
  }
  let truncated = false
  if (include.has('items')) {
    const result = await optional(() => fetchVersions(`${prefix}/items/top`))
    if (result !== undefined) {
      changed.items = result.entries
      truncated = truncated || result.truncated
    }
  }
  if (include.has('collections')) {
    const result = await optional(() => fetchVersions(`${prefix}/collections`))
    if (result !== undefined) {
      changed.collections = result.entries
      truncated = truncated || result.truncated
    }
  }
  if (include.has('savedSearches')) {
    const result = await optional(() => fetchVersions(`${prefix}/searches`))
    if (result !== undefined) {
      changed.savedSearches = result.entries
      truncated = truncated || result.truncated
    }
  }
  if (include.has('fulltext')) {
    // The fulltext delta has its own endpoint and reports attachment keys.
    const result = await optional(() => fetchVersions(`${prefix}/fulltext`))
    if (result !== undefined) {
      changed.fulltextAttachments = result.entries
      truncated = truncated || result.truncated
    }
  }
  if (include.has('deleted')) {
    const payload = await optional(async () => {
      const params = new URLSearchParams()
      params.set('since', String(request.since))
      return await deps.client.getJson<unknown>(`${prefix}/deleted`, params, {
        signal,
      })
    })
    if (payload !== undefined) {
      serverId = serverId ?? payload.headers.get('zotero-server-id') ?? undefined
      const record = asRecord(payload.json)
      const keysOf = (field: string): string[] =>
        (Array.isArray(record?.[field]) ? (record![field] as unknown[]) : []).filter(
          (key): key is string => typeof key === 'string' && isObjectKey(key),
        )
      deleted.items = keysOf('items')
      deleted.collections = keysOf('collections')
      deleted.savedSearches = keysOf('searches')
    }
  }

  return {
    library,
    ...(serverId !== undefined ? { serverId } : {}),
    fromVersion: request.since,
    ...(toVersion !== undefined ? { toVersion } : {}),
    changed,
    ...((deleted.items?.length ?? 0) > 0 ||
    (deleted.collections?.length ?? 0) > 0 ||
    (deleted.savedSearches?.length ?? 0) > 0
      ? { deleted }
      : {}),
    ...(truncated ? { truncated } : {}),
  }
}
