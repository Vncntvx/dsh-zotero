/**
 * The two Local API wire contracts for child objects.
 *
 * Zotero's Local API does **not** serve annotations from a bare
 * `GET /items/{key}/children`. That endpoint is backed by the same
 * `includeChildren` search expansion as `/items`, and that expansion's SQL
 * unions only `itemAttachments` and `itemNotes` — never `itemAnnotations`.
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
 * `meta.numChildren` never counts annotations either — for regular items it
 * is notes+attachments, for attachments it is hard-coded 0 — so nothing in
 * this plugin may infer annotation presence from that field.
 *
 * These two functions are the only child-object reads the plugin issues.
 * Verified against Zotero 10.0.3 (`server_localAPI.js` + `xpcom/data/search.js`)
 * and live curl on 9.0.6 (issue #4).
 * @module dsh-zotero/local/children-wire
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { libraryPrefix } from '../refs.js'
import type { SupportedLocalLibrary } from '../types.js'

/** Query that surfaces annotation rows under one key. */
const ANNOTATION_SEARCH = new URLSearchParams({ itemType: 'annotation' })

/** GET one `/children` listing; a non-array body counts as no children. */
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
  return Array.isArray(children.json) ? children.json : []
}

/**
 * Direct children of one key: notes and attachments only.
 * Never annotations — that is the bare Local API contract.
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
