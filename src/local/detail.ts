/**
 * The `zotero_get` and `zotero_children` domain: one item's detail with its
 * lazily loaded child rows, and child-object exploration. Child rows are
 * shared with retrieve.
 *
 * Child objects ride two distinct Local API wire contracts
 * ({@link ./children-wire.ts}): a bare `/children` listing is notes and
 * attachments only; annotations appear solely under
 * `/children?itemType=annotation`. Callers name which halves they need.
 * @module dsh-zotero/local/detail
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_SERVER_ID_HEADER } from '../constants.js'
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
import { fetchAnnotationChildren, fetchDirectChildren } from './children-wire.js'
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

/** Which child-object halves a read must fetch. */
export interface ChildRowNeeds {
  /** Bare `/children` — notes and attachments. */
  readonly direct: boolean
  /** `/children?itemType=annotation` — annotations under this key. */
  readonly annotations: boolean
}

/**
 * The model-facing message for an attachment ref whose target is another item
 * type. Annotations hang off attachments, so the model has to re-aim the ref.
 */
export function attachmentTargetKindMessage(itemType: string): string {
  return `The referenced object is a ${itemType}, not an attachment; annotations hang off attachment refs.`
}

/**
 * Fetch one item's full detail. The parent is always fetched once; child
 * rows are fetched lazily only when the caller asked to include
 * notes/annotations/attachments — the Local API ignores `?include=` on
 * single-item responses. Direct children (notes/attachments) come from the
 * bare `/children` endpoint; annotations additionally require the
 * `?itemType=annotation` listing under the same key. Collection names
 * resolve from a cached full listing only when the item belongs to
 * collections.
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
  const serverId = parent.headers.get(ZOTERO_SERVER_ID_HEADER) ?? ref.serverId
  const includes = INCLUDE_ORDER.filter((kind) => request.include.has(kind))
  const keys = collectionKeysOf(parent.json)
  // Children and the collections listing are independent once the parent
  // has arrived; the Local API is a loopback server with no per-client
  // throttling, so both ride the same await.
  const [children, collectionNames] = await Promise.all([
    includes.length > 0
      ? loadChildRows(deps, ref.key, ref.library as SupportedLocalLibrary, serverId, signal, {
          // Detail always materializes notes/attachments/annotations from
          // their own contracts once any include was requested.
          direct: true,
          annotations: request.include.has('annotations'),
        })
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
 * Explore one item's or attachment's child-object graph. An item ref yields
 * the requested direct notes/attachments and, when asked, annotations under
 * the item (one filtered children listing); an attachment ref yields that
 * file's annotations. The target row is always fetched first so the whole
 * result pins to one Server-ID and a non-attachment target of an attachment
 * ref fails with a typed error.
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
  const serverId = row.headers.get(ZOTERO_SERVER_ID_HEADER) ?? ref.serverId
  const ctx: NormalizeContext = { library, serverId: serverId ?? undefined }
  const data = asRecord(asRecord(row.json)?.data)
  const itemType = asString(data?.itemType) ?? ''
  if (ref.kind === 'attachment' && itemType !== 'attachment') {
    throw new ZoteroError(
      itemType === ''
        ? `The referenced object ${ref.key} could not be confirmed as an attachment.`
        : attachmentTargetKindMessage(itemType),
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  if (ref.kind === 'attachment') {
    // An attachment's own child objects are its annotations, served only
    // under the annotation-filtered listing.
    if (!request.include.has('annotations')) {
      return {
        ref: formatRef(refForLibrary(library, 'attachment', ref.key, serverId)),
        ...(itemType !== '' ? { itemType } : {}),
        ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
      }
    }
    const rows = await fetchAnnotationChildren(deps, ref.key, library, serverId, signal)
    const partitioned = partitionChildren(
      rows,
      ctx,
      undefined,
      new Set<ZoteroChildKind>(['annotation']),
    )
    return {
      ref: formatRef(refForLibrary(library, 'attachment', ref.key, serverId)),
      ...(itemType !== '' ? { itemType } : {}),
      annotations: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords),
      ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
    }
  }
  const wantsDirect = request.include.has('notes') || request.include.has('attachments')
  const wantsAnnotations = request.include.has('annotations')
  const graphRows = (
    await loadChildRows(deps, ref.key, library, serverId, signal, {
      direct: wantsDirect,
      annotations: wantsAnnotations,
    })
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
 * One key's child rows for get/retrieve/children. Each half of the request
 * rides its own wire contract; both may run in parallel. The direct row
 * count rides along so a detail's `children.total` stays honest after
 * annotation rows are merged in.
 */
export async function loadChildRows(
  deps: { client: ZoteroHttpClient },
  key: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
  needs: ChildRowNeeds,
): Promise<{ readonly rows: readonly unknown[]; readonly directCount: number }> {
  const [direct, annotations] = await Promise.all([
    needs.direct
      ? fetchDirectChildren(deps, key, library, serverId, signal)
      : Promise.resolve([] as readonly unknown[]),
    needs.annotations
      ? fetchAnnotationChildren(deps, key, library, serverId, signal)
      : Promise.resolve([] as readonly unknown[]),
  ])
  return {
    rows: annotations.length > 0 ? [...direct, ...annotations] : direct,
    directCount: direct.length,
  }
}
