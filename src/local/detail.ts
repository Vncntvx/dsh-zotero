/**
 * The `zotero_get` and `zotero_children` domain: one item's detail with its
 * lazily loaded child rows, and the child-object graph exploration. Child
 * rows are shared with retrieve, which merges attachment-nested annotations
 * through the same {@link loadChildRows} walk.
 * @module dsh-zotero/local/detail
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { loadItemGraph } from '../item-graph.js'
import { ZOTERO_GRAPH_CONCURRENCY } from '../constants.js'
import { asRecord, asString } from '../json.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import type { NormalizeContext } from '../normalize.js'
import { type ZoteroChildKind } from '../normalize.js'
import {
  attachmentRecordOf,
  childCollection,
  collectionKeysOf,
  normalizeItemDetail,
  partitionChildren,
} from '../normalize.js'
import { formatRef, libraryPrefix, refForLibrary, requireSupportedLocalRef } from '../refs.js'
import type { ScopeDirectory } from './scope-directory.js'
import type { LocalApiLimits } from './limits.js'
import { bestAttachmentFromLinks } from '../attachments.js'
import type {
  SupportedLocalLibrary,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroObjectRef,
} from '../types.js'

const INCLUDE_ORDER: readonly ZoteroInclude[] = ['notes', 'annotations', 'attachments']

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
export async function getItem(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroGetRequest,
  signal?: AbortSignal,
): Promise<ZoteroItemDetail> {
  const ref = requireSupportedLocalRef(request.ref, ['item'])
  const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
  const parent = await deps.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
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
      ? loadChildRows(
          deps,
          ref.key,
          ref.library as SupportedLocalLibrary,
          serverId,
          signal,
          request.include.has('annotations'),
        )
      : undefined,
    keys.length > 0
      ? directory.collectionNamesFor(keys, ref.library as SupportedLocalLibrary, serverId, signal)
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
    maxAbstractChars: deps.limits.maxDetailChars,
    maxNoteBodyChars: deps.limits.maxNoteBodyChars,
    maxNoteChars: deps.limits.maxNoteChars,
    maxNoteRecords: deps.limits.maxNoteRecords,
    maxAnnotationRecords: deps.limits.maxAnnotationRecords,
    fields: request.fields,
  })
}

/**
 * Explore one item's or attachment's child-object graph. An item ref
 * yields its direct notes and attachments plus, when requested, every
 * attachment's annotations as one merged corpus; an attachment ref yields
 * its own annotations. The target row is always fetched first so the
 * whole result pins to one Server-ID and a non-attachment target of an
 * attachment ref fails with a typed error.
 */
export async function children(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  request: ZoteroChildrenRequest,
  signal?: AbortSignal,
): Promise<ZoteroChildrenResult> {
  const ref = requireSupportedLocalRef(request.ref, ['item', 'attachment'])
  const library = ref.library as SupportedLocalLibrary
  const prefix = libraryPrefix(library)
  const row = await deps.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
    signal,
    serverId: ref.serverId,
  })
  const serverId = row.headers.get('zotero-server-id') ?? ref.serverId
  const ctx: NormalizeContext = { library, serverId: serverId ?? undefined }
  const data = asRecord(asRecord(row.json)?.data)
  const itemType = asString(data?.itemType) ?? ''
  if (ref.kind === 'attachment' && itemType !== 'attachment') {
    throw new ZoteroError(
      itemType === ''
        ? `The referenced object ${ref.key} could not be confirmed as an attachment.`
        : `The referenced object is a ${itemType}, not an attachment; annotations hang off attachment refs.`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  if (ref.kind === 'attachment') {
    // An attachment's own children are exactly its annotations.
    const rows = await fetchChildRows(deps, ref.key, library, serverId, signal)
    const partitioned = partitionChildren(
      rows,
      ctx,
      undefined,
      new Set<ZoteroChildKind>(['annotation']),
    )
    return {
      ref: formatRef(refForLibrary(library, 'attachment', ref.key, serverId)),
      ...(itemType !== '' ? { itemType } : {}),
      ...(request.include.has('annotations')
        ? {
            annotations: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords),
          }
        : {}),
      ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
    }
  }
  const graphRows = (
    await loadChildRows(
      deps,
      ref.key,
      library,
      serverId,
      signal,
      request.include.has('annotations'),
    )
  ).rows
  const kinds = new Set<ZoteroChildKind>()
  if (request.include.has('notes')) kinds.add('note')
  if (request.include.has('attachments')) kinds.add('attachment')
  if (request.include.has('annotations')) kinds.add('annotation')
  const partitioned =
    kinds.size > 0 ? partitionChildren(graphRows, ctx, undefined, kinds) : undefined
  return {
    ref: formatRef(refForLibrary(library, 'item', ref.key, serverId)),
    ...(itemType !== '' ? { itemType } : {}),
    ...(request.include.has('notes') && partitioned !== undefined
      ? { notes: childCollection(partitioned.notes, deps.limits.maxNoteRecords) }
      : {}),
    ...(request.include.has('annotations') && partitioned !== undefined
      ? {
          annotations: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords),
        }
      : {}),
    ...(request.include.has('attachments') && partitioned !== undefined
      ? {
          attachments: childCollection(
            partitioned.attachments.map((candidate) => attachmentRecordOf(candidate, ctx)),
            partitioned.attachments.length,
          ),
        }
      : {}),
    ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
  }
}

/**
 * One item's child rows for get/retrieve. Without annotations this is the
 * single `/children` response; with them the walk descends into each
 * attachment and merges those annotation rows into one partition input.
 * The direct row count rides along so the detail's `children.total` stays
 * honest after the merge.
 */
export async function loadChildRows(
  deps: { client: ZoteroHttpClient },
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
  withAnnotations: boolean,
): Promise<{ readonly rows: readonly unknown[]; readonly directCount: number }> {
  const graph = await loadItemGraph({
    parentKey: key,
    fetchChildren: (childKey) => fetchChildRows(deps, childKey, library, serverId, signal),
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
async function fetchChildRows(
  deps: { client: ZoteroHttpClient },
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<readonly unknown[]> {
  const prefix = libraryPrefix(library)
  const children = await deps.client.getJson<unknown>(
    `${prefix}/items/${key}/children`,
    undefined,
    {
      signal,
      serverId,
    },
  )
  return Array.isArray(children.json) ? children.json : []
}
