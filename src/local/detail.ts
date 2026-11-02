/**
 * The `zotero_get` and the panel child-page reader domain: one item's detail with its
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
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import { asRecord, asString, isObjectKey } from '../json.js'
import {
  ZOTERO_UNEXPECTED,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_FILE_MISSING,
  ZOTERO_FILE_UNREADABLE,
  ZoteroError,
} from '../errors.js'
import { ZOTERO_CHILD_PAGE_MAX_ROWS } from '../constants.js'
import type { NormalizeContext } from '../normalize-context.js'
import { type ZoteroChildKind } from '../normalize-children.js'
import {
  childCollection,
  normalizeItemDetail,
  partitionDetailChildren,
} from '../normalize-item-detail.js'
import { collectionKeysOf } from '../normalize-search.js'
import { attachmentRecordOf, partitionChildren } from '../normalize-children.js'
import {
  libraryPrefix,
  parseSupportedRef,
  refStringFor,
  requireSupportedLocalRef,
} from '../refs.js'
import type { ScopeDirectory } from './scope-directory.js'
import type { LocalApiLimits } from './limits.js'
import {
  childPages,
  fetchAnnotationChildren,
  fetchChildPage,
  fetchDirectChildren,
} from './children-wire.js'
import { resolveAttachmentRow } from './attachment-location.js'
import {
  bestAttachmentFromLinks,
  normalizeAttachmentRecord,
  selectAttachments,
  type ZoteroAttachmentCandidate,
} from '../attachments.js'
import { isPdfContentType } from '../media-types.js'
import { mapWithConcurrency } from '../concurrency.js'
import type {
  SupportedLocalLibrary,
  ZoteroAnnotationRecord,
  ZoteroChildPage,
  ZoteroChildPageRequest,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroNoteRecord,
  ZoteroAttachmentRecord,
} from '../types.js'

const INCLUDE_ORDER: readonly ZoteroInclude[] = ['notes', 'annotations', 'attachments']

/** Which child-object halves a read must fetch. */
interface ChildRowNeeds {
  /** Bare `/children`: notes and attachments. */
  readonly direct: boolean
  /** `/children?itemType=annotation`: annotations under this key. */
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
 * Refuse an attachment ref unless the served row is itself an attachment. A
 * row with no itemType cannot be confirmed, which is a different failure from
 * a known other type and must not read as a blank type name.
 * @param itemType - the served object's itemType, or '' when it carried none.
 * @param key - the object key, for the unconfirmed message.
 */
export function assertAttachmentTarget(itemType: string, key: string): void {
  if (itemType === 'attachment') return
  throw new ZoteroError(
    itemType === ''
      ? `The referenced object ${key} could not be confirmed as an attachment.`
      : attachmentTargetKindMessage(itemType),
    ZOTERO_INVALID_ARGUMENT,
  )
}

/**
 * Validate and clamp one child-listing page window to the kind's record cap.
 * The detail read and the dedicated child-page read share this rule, so a
 * page the panel pages by is the page the host actually serves.
 */
export function childPageWindowOf(
  request: { readonly kind: ZoteroInclude; readonly offset: number; readonly limit: number },
  limits: Pick<LocalApiLimits, 'maxNoteRecords' | 'maxAttachmentRecords' | 'maxAnnotationRecords'>,
): { offset: number; limit: number } {
  if (
    !Number.isSafeInteger(request.offset) ||
    request.offset < 0 ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > ZOTERO_CHILD_PAGE_MAX_ROWS
  ) {
    throw new ZoteroError(
      `Child pages require a nonnegative offset and a limit between 1 and ${ZOTERO_CHILD_PAGE_MAX_ROWS}.`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const cap =
    request.kind === 'notes'
      ? limits.maxNoteRecords
      : request.kind === 'attachments'
        ? limits.maxAttachmentRecords
        : limits.maxAnnotationRecords
  return { offset: request.offset, limit: Math.min(request.limit, cap) }
}

/** Read metadata once, then consume requested child kinds at their own windows. */
export async function getItem(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  directory: ScopeDirectory,
  request: ZoteroGetRequest,
  signal?: AbortSignal,
): Promise<ZoteroItemDetail> {
  const ref = requireSupportedLocalRef(request.ref, ['item', 'attachment'])
  const locations = request.locations ?? 'none'
  if (
    (locations === 'included' && !request.include.has('attachments')) ||
    (ref.kind === 'attachment' &&
      (locations === 'included' || [...request.include].some((kind) => kind !== 'annotations')))
  ) {
    throw new ZoteroError(
      'Attachment targets accept annotations and locations none/best; included locations require attachments.',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  for (const kind of Object.keys(request.childPages ?? {})) {
    if (!request.include.has(kind as ZoteroInclude)) {
      throw new ZoteroError(
        'childPages must refer to requested include kinds.',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
  }
  const library = ref.library as SupportedLocalLibrary
  const parent = await deps.client.getJson<unknown>(
    `${libraryPrefix(library)}/items/${ref.key}`,
    undefined,
    { signal, serverId: ref.serverId },
  )
  const serverId = serverIdFromHeaders(parent.headers, ref.serverId)
  assertServerIdMatches(serverId, ref.serverId)
  const data = asRecord(asRecord(parent.json)?.data)
  const itemType = asString(data?.itemType) ?? ''
  if (ref.kind === 'attachment') assertAttachmentTarget(itemType, ref.key)
  const keys = collectionKeysOf(parent.json)
  const collectionNames =
    keys.length > 0
      ? await directory.collectionNamesFor(keys, library, serverId, signal)
      : undefined
  const context: NormalizeContext = { library, serverId }
  const linkBest = bestAttachmentFromLinks(parent.json)
  const normalize = () =>
    normalizeItemDetail({
      parent: parent.json,
      library,
      serverId,
      include: request.include,
      collectionNames,
      fields: request.fields,
      maxAbstractChars: Number.MAX_SAFE_INTEGER,
      maxNoteBodyChars: Number.MAX_SAFE_INTEGER,
      maxNoteChars: Number.MAX_SAFE_INTEGER,
      maxNoteRecords: Number.MAX_SAFE_INTEGER,
      maxAnnotationRecords: Number.MAX_SAFE_INTEGER,
      maxAttachmentRecords: Number.MAX_SAFE_INTEGER,
    })
  const detail = normalize()
  detail.ref = refStringFor(library, ref.kind, ref.key, serverId)
  if (itemType === 'attachment') {
    detail.contentType = asString(data?.contentType) ?? ''
    detail.children.total = 0
    detail.bestAttachment = attachmentRecordOf(normalizeAttachmentRecord(parent.json), context)
  }
  let bestRow: unknown = itemType === 'attachment' ? parent.json : undefined
  const resolveRecord = async (
    attachment: ZoteroAttachmentRecord,
    row: unknown,
    poolSignal?: AbortSignal,
  ) => {
    const target = parseSupportedRef(attachment.ref, ['attachment'])
    if (row === undefined || row === null) {
      const response = await deps.client.getJson<unknown>(
        `${libraryPrefix(library)}/items/${target.key}`,
        undefined,
        { signal: poolSignal, serverId },
      )
      assertServerIdMatches(serverIdFromHeaders(response.headers, serverId), serverId)
      row = response.json
    }
    try {
      const location = await resolveAttachmentRow(deps, { ...target, serverId }, row, poolSignal)
      attachment.location =
        location.kind === 'file'
          ? { kind: 'file', path: location.path }
          : { kind: 'url', url: location.url }
      if (location.kind === 'file') attachment.path = location.path
    } catch (error) {
      if (
        !(error instanceof ZoteroError) ||
        ![ZOTERO_FILE_MISSING, ZOTERO_FILE_UNREADABLE].includes(error.code)
      )
        throw error
      attachment.location = { kind: 'unavailable', reason: error.message }
    }
    if (detail.bestAttachment?.ref === attachment.ref)
      Object.assign(detail.bestAttachment, attachment)
    if (itemType === 'attachment' || locations === 'best') detail.location = attachment.location
    if (itemType === 'attachment' && attachment.path !== undefined) detail.path = attachment.path
  }
  const includes = INCLUDE_ORDER.filter((kind) => request.include.has(kind))
  const combined =
    includes.some((kind) => kind !== 'annotations') &&
    request.childPages?.notes === undefined &&
    request.childPages?.attachments === undefined
  const listings: (ZoteroInclude | 'direct')[] = combined
    ? ['direct', ...includes.filter((kind) => kind === 'annotations')]
    : includes

  /** One listing's answer: normalized buckets plus the raw rows a location read needs. */
  interface ListingRead {
    readonly listing: ZoteroInclude | 'direct'
    readonly kinds: readonly ZoteroInclude[]
    readonly notes: ZoteroNoteRecord[]
    readonly annotations: ZoteroAnnotationRecord[]
    readonly attachments: ZoteroAttachmentCandidate[]
    readonly attachmentRows: Map<string, unknown>
    readonly pdfRows: unknown[]
    readonly total: number
    readonly page?: { offset: number; limit: number; nextOffset?: number }
  }

  const isPdfRow = (row: unknown): boolean => {
    const key = asString(asRecord(row)?.key)
    return (
      key !== undefined &&
      isObjectKey(key) &&
      isPdfContentType(normalizeAttachmentRecord(row).contentType)
    )
  }

  const readListing = async (
    listing: ZoteroInclude | 'direct',
    poolSignal: AbortSignal,
  ): Promise<ListingRead> => {
    const kinds =
      listing === 'direct' ? includes.filter((kind) => kind !== 'annotations') : [listing]
    const requested = listing === 'direct' ? undefined : request.childPages?.[listing]
    const window =
      requested === undefined
        ? undefined
        : childPageWindowOf({ kind: listing as ZoteroInclude, ...requested }, deps.limits)
    const notes: ZoteroNoteRecord[] = []
    const annotations: ZoteroAnnotationRecord[] = []
    const attachments: ZoteroAttachmentCandidate[] = []
    const attachmentRows = new Map<string, unknown>()
    const pdfRows: unknown[] = []
    const seen = new Set<string>()
    let total = 0
    let page: ListingRead['page']
    for await (const current of childPages(deps, {
      key: ref.key,
      library,
      serverId,
      kind: listing,
      signal: poolSignal,
      ...(window !== undefined ? { window } : {}),
    })) {
      const rowsByKey = new Map(current.rows.map((row) => [asString(asRecord(row)?.key), row]))
      const partitioned = partitionDetailChildren(
        current.rows,
        context,
        request.include,
        Number.MAX_SAFE_INTEGER,
      )
      for (const row of current.rows) {
        const rowKey = asString(asRecord(row)?.key)
        if (!rowKey || seen.has(rowKey))
          throw new ZoteroError('Duplicate or invalid child key during reading.', ZOTERO_UNEXPECTED)
        seen.add(rowKey)
      }
      notes.push(...partitioned.notes)
      annotations.push(...partitioned.annotations)
      for (const candidate of partitioned.attachments) {
        attachments.push(candidate)
        const row = rowsByKey.get(candidate.key)
        if (row !== undefined) attachmentRows.set(candidate.key, row)
        if (locations === 'best' && isPdfContentType(candidate.contentType) && row !== undefined)
          pdfRows.push(row)
      }
      total = current.total
      if (window !== undefined)
        page ??= {
          offset: current.offset,
          limit: current.limit,
          ...(current.nextOffset !== undefined ? { nextOffset: current.nextOffset } : {}),
        }
    }
    return { listing, kinds, notes, annotations, attachments, attachmentRows, pdfRows, total, page }
  }

  // One batch after the parent: every listing is independent, and the first
  // failure cancels its siblings instead of letting them finish unseen.
  const pool = new AbortController()
  const relayAbort = () => pool.abort(signal?.reason)
  if (signal?.aborted) relayAbort()
  else signal?.addEventListener('abort', relayAbort, { once: true })
  let reads: ListingRead[]
  try {
    const settled = await Promise.allSettled(
      listings.map((listing) => readListing(listing, pool.signal)),
    )
    const rejected = settled.find(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    )
    if (rejected !== undefined) {
      pool.abort(rejected.reason)
      throw rejected.reason
    }
    reads = settled.map((entry) => (entry as PromiseFulfilledResult<ListingRead>).value)
  } finally {
    signal?.removeEventListener('abort', relayAbort)
  }

  for (const read of reads) {
    const completeness = read.page === undefined ? 'complete' : 'page'
    const pageFields =
      read.page === undefined
        ? {}
        : {
            offset: read.page.offset,
            limit: read.page.limit,
            ...(read.page.nextOffset !== undefined ? { nextOffset: read.page.nextOffset } : {}),
          }
    if (read.kinds.includes('notes'))
      detail.notes = {
        ...pageFields,
        completeness,
        total: read.listing === 'direct' ? read.notes.length : read.total,
        returned: read.notes.length,
        items: read.notes,
      }
    if (read.kinds.includes('annotations'))
      detail.annotations = {
        ...pageFields,
        completeness,
        total: read.listing === 'direct' ? read.annotations.length : read.total,
        returned: read.annotations.length,
        items: read.annotations,
      }
    if (read.kinds.includes('attachments')) {
      const items = read.attachments.map((candidate) => attachmentRecordOf(candidate, context))
      detail.attachments = {
        ...pageFields,
        completeness,
        total: read.listing === 'direct' ? items.length : read.total,
        returned: items.length,
        items,
      }
    }
    if (read.listing === 'direct') detail.children.total = read.total
  }

  // The link attachment keeps its place; only its title comes from the rows.
  if (detail.bestAttachment !== undefined && linkBest !== undefined) {
    const linked = reads
      .flatMap((read) => read.attachments)
      .find((candidate) => candidate.key === linkBest.key)
    if (linked !== undefined) detail.bestAttachment.title = linked.title
  }

  if (locations === 'included') {
    const rowsByKey = new Map<string, unknown>()
    for (const read of reads) for (const [key, row] of read.attachmentRows) rowsByKey.set(key, row)
    await mapWithConcurrency(
      detail.attachments?.items ?? [],
      deps.limits.graphConcurrency,
      (attachment, poolSignal) =>
        resolveRecord(
          attachment,
          rowsByKey.get(parseSupportedRef(attachment.ref, ['attachment']).key),
          poolSignal,
        ),
      { signal },
    )
  }
  if (locations === 'best' && detail.bestAttachment === undefined) {
    // Candidates only when the caller explicitly asks; the ranking is Zotero's
    // own, so it must see every PDF, not just the first page that carried one.
    const candidates = reads.flatMap((read) => read.pdfRows)
    if (candidates.length === 0 && !request.include.has('attachments')) {
      for await (const current of childPages(deps, {
        key: ref.key,
        library,
        serverId,
        kind: 'attachments',
        signal,
      }))
        candidates.push(...current.rows.filter(isPdfRow))
    }
    const [best] = selectAttachments(candidates, 'pdf')
    if (best === undefined) {
      detail.location = { kind: 'unavailable', reason: 'No attachment to resolve.' }
    } else {
      detail.bestAttachment = attachmentRecordOf(best, context)
      bestRow = candidates.find((row) => asString(asRecord(row)?.key) === best.key)
    }
  }
  if (locations === 'best' && detail.bestAttachment)
    await resolveRecord(detail.bestAttachment, bestRow, signal)
  signal?.throwIfAborted()
  return detail
}

/**
 * Read one page of a single child kind without re-reading the parent item or
 * its collection names. An attachment ref serves annotations only and is
 * validated against its target row; an item ref reads the child listing
 * directly, proving the parent exists only when the first page is empty (so a
 * deleted item still yields the typed 404 instead of a silent empty page).
 */
export async function getChildPage(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  request: ZoteroChildPageRequest,
  signal?: AbortSignal,
): Promise<ZoteroChildPage> {
  const ref = requireSupportedLocalRef(request.ref, ['item', 'attachment'])
  const library = ref.library as SupportedLocalLibrary
  const page = childPageWindowOf(request, deps.limits)
  if (ref.kind === 'attachment') {
    if (request.kind !== 'annotations') {
      throw new ZoteroError('An attachment ref serves annotations only.', ZOTERO_INVALID_ARGUMENT)
    }
    const row = await deps.client.getJson<unknown>(
      `${libraryPrefix(library)}/items/${ref.key}`,
      undefined,
      {
        signal,
        serverId: ref.serverId,
      },
    )
    const serverId = serverIdFromHeaders(row.headers, ref.serverId)
    assertServerIdMatches(serverId, ref.serverId)
    const itemType = asString(asRecord(asRecord(row.json)?.data)?.itemType) ?? ''
    assertAttachmentTarget(itemType, ref.key)
    const fetched = await fetchChildPage(deps, {
      key: ref.key,
      library,
      serverId,
      kind: 'annotations',
      signal,
      window: page,
    })
    const ctx: NormalizeContext = { library, serverId: fetched.serverId ?? serverId ?? undefined }
    const partitioned = partitionChildren(
      fetched.rows,
      ctx,
      deps.limits.maxNoteChars,
      new Set<ZoteroChildKind>(['annotation']),
    )
    return {
      kind: 'annotations',
      page: childCollection(
        partitioned.annotations,
        deps.limits.maxAnnotationRecords,
        pageMetaOf(fetched),
      ),
    }
  }
  const fetched = await fetchChildPage(deps, {
    key: ref.key,
    library,
    serverId: ref.serverId,
    kind: request.kind,
    signal,
    window: page,
  })
  let serverId = fetched.serverId ?? ref.serverId
  if (fetched.total === 0 && page.offset === 0) {
    // A missing parent must still surface as the typed 404; a parent that
    // exists with no children stays an empty page.
    const parent = await deps.client.getJson<unknown>(
      `${libraryPrefix(library)}/items/${ref.key}`,
      undefined,
      { signal, serverId: ref.serverId },
    )
    const parentServerId = serverIdFromHeaders(parent.headers, ref.serverId)
    assertServerIdMatches(parentServerId, ref.serverId)
    serverId = parentServerId ?? serverId
  }
  const ctx: NormalizeContext = { library, serverId }
  const kinds = new Set<ZoteroChildKind>(
    request.kind === 'notes'
      ? ['note']
      : request.kind === 'attachments'
        ? ['attachment']
        : ['annotation'],
  )
  const partitioned = partitionChildren(fetched.rows, ctx, deps.limits.maxNoteChars, kinds)
  const meta = pageMetaOf(fetched)
  switch (request.kind) {
    case 'notes':
      return {
        kind: 'notes',
        page: childCollection(partitioned.notes, deps.limits.maxNoteRecords, meta),
      }
    case 'attachments':
      return {
        kind: 'attachments',
        page: childCollection(
          partitioned.attachments.map((candidate) => attachmentRecordOf(candidate, ctx)),
          deps.limits.maxAttachmentRecords,
          meta,
        ),
      }
    case 'annotations':
      return {
        kind: 'annotations',
        page: childCollection(partitioned.annotations, deps.limits.maxAnnotationRecords, meta),
      }
  }
}

/** The page metadata one fetched child page reports. */
function pageMetaOf(fetched: {
  total: number
  offset: number
  limit: number
  nextOffset?: number
}): {
  total: number
  offset: number
  limit: number
  nextOffset?: number
} {
  return {
    total: fetched.total,
    offset: fetched.offset,
    limit: fetched.limit,
    ...(fetched.nextOffset !== undefined ? { nextOffset: fetched.nextOffset } : {}),
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
): Promise<{ readonly rows: readonly unknown[]; readonly directCount?: number }> {
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
    directCount: needs.direct ? direct.length : undefined,
  }
}
