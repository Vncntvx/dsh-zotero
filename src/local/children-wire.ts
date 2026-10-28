/**
 * The two Local API wire contracts for child objects.
 *
 * Zotero's Local API does **not** serve annotations from a bare
 * `GET /items/{key}/children`. That endpoint is backed by the same
 * `includeChildren` search expansion as `/items`, and that expansion's SQL
 * unions only `itemAttachments` and `itemNotes`, never `itemAnnotations`.
 * Annotations hang off attachments (`itemAnnotations.parentItemID` →
 * attachment), so a bare children read of a PDF is empty even when the file
 * carries highlights.
 *
 * Annotations surface only through an explicit type filter:
 * `GET /items/{key}/children?itemType=annotation`. That path goes through
 * `buildSearchFromSearchSyntax` → `setScope(parent, true)`, and the scope
 * expansion *does* include annotations under the scope set's attachments
 * (and under top-level attachments in scope). Passing the bibliographic
 * item key therefore returns every annotation under that item's attachments
 * in one request; passing an attachment key returns that file's annotations.
 *
 * `meta.numChildren` never counts annotations either: for regular items it
 * is notes+attachments, for attachments it is hard-coded 0, so nothing in
 * this plugin may infer annotation presence from that field.
 *
 * These functions are the only child-object reads the plugin issues. The
 * listing forms are:
 * - bare `GET /items/{key}/children` — notes and attachments together;
 * - `?itemType=note` / `?itemType=attachment` — one kind, paged (the panel's
 *   offset/limit detail);
 * - `?itemType=annotation` — annotations, the only path that surfaces them.
 * Verified against Zotero 10.0.3 (`server_localAPI.js` + `xpcom/data/search.js`)
 * and live curl on 9.0.6 (issue #4).
 * @module dsh-zotero/local/children-wire
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { libraryPrefix } from '../refs.js'
import {
  nextOffsetOrFail,
  readAllPages,
  requireArrayBody,
  requireTotalResults,
  setPage,
} from './pagination.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import type { SupportedLocalLibrary } from '../types.js'

/** Query that surfaces annotation rows under one key. */
const ANNOTATION_SEARCH = new URLSearchParams({ itemType: 'annotation' })

/** The detail request's child kinds, in the panel's own spelling. */
export type ChildListingKind = 'notes' | 'attachments' | 'annotations'

/** The wire `itemType` filter each child kind reads through. */
const CHILD_ITEM_TYPE: Record<ChildListingKind, string> = {
  notes: 'note',
  attachments: 'attachment',
  annotations: 'annotation',
}

/** GET one `/children` listing; a non-array body is a contract breach, not an empty page. */
async function getChildrenJson(
  deps: { client: ZoteroHttpClient },
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
  search: URLSearchParams | undefined,
): Promise<readonly unknown[]> {
  const prefix = libraryPrefix(library)
  const children = await deps.client.getJson<unknown>(`${prefix}/items/${key}/children`, search, {
    signal,
    serverId,
  })
  return requireArrayBody(
    children.json,
    search === undefined ? 'item children' : 'item annotations',
  )
}

/**
 * Direct children of one key: notes and attachments only.
 * Never annotations, which is the bare Local API contract.
 */
export async function fetchDirectChildren(
  deps: { client: ZoteroHttpClient },
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<readonly unknown[]> {
  return getChildrenJson(deps, key, library, serverId, signal, undefined)
}

/**
 * Annotations under one key via `?itemType=annotation`.
 * On an attachment key this is that file's annotations; on a bibliographic
 * item key the Local API returns the annotations under every descendant
 * attachment. Provenance rides each row's `data.parentItem`.
 */
export async function fetchAnnotationChildren(
  deps: { client: ZoteroHttpClient },
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<readonly unknown[]> {
  return getChildrenJson(deps, key, library, serverId, signal, ANNOTATION_SEARCH)
}

/**
 * One paged child listing: the same filtered-children wire form the bare read
 * uses, narrowed to one kind and windowed by `start`/`limit`. `limit` in the
 * answer is the page the caller asked for, so the panel can page by the
 * effective size after the detail domain clamps it to the record caps.
 */
export async function fetchChildPage(
  deps: { client: ZoteroHttpClient },
  kind: ChildListingKind,
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  page: { offset: number; limit: number },
  signal: AbortSignal | undefined,
): Promise<{
  rows: readonly unknown[]
  total: number
  offset: number
  limit: number
  nextOffset?: number
  serverId?: string
}> {
  const params = new URLSearchParams({ itemType: CHILD_ITEM_TYPE[kind] })
  setPage(params, page.offset, page.limit)
  const { json, headers } = await deps.client.getJson<unknown>(
    `${libraryPrefix(library)}/items/${key}/children`,
    params,
    { signal, serverId },
  )
  const observed = serverIdFromHeaders(headers, serverId)
  assertServerIdMatches(observed, serverId)
  const rows = requireArrayBody(json, `item ${kind}`)
  const total = requireTotalResults(headers, `item ${kind}`)
  const nextOffset = nextOffsetOrFail(page.offset, rows.length, total, `item ${kind}`)
  return {
    rows,
    total,
    offset: page.offset,
    limit: page.limit,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
    ...(observed !== undefined ? { serverId: observed } : {}),
  }
}

/** Read every child, including trashed rows, before a versioned Trash operation. */
export async function fetchChildrenForTrash(
  deps: { client: ZoteroHttpClient },
  key: string,
  serverId: string,
  annotations: boolean,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const rows: unknown[] = []
  await readAllPages(
    deps.client,
    `users/0/items/${key}/children`,
    { includeTrashed: '1' },
    serverId,
    signal,
    { body: 'children to move to Trash', page: 'children to move to Trash' },
    annotations ? (params) => params.set('itemType', 'annotation') : undefined,
    (page) => {
      rows.push(...page)
    },
  )
  return rows
}
