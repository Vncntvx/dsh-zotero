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
import { asRecord, asString } from '../json.js'
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
import { childCollection, normalizeItemDetail } from '../normalize-item-detail.js'
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
import { normalizeAttachmentRecord } from '../attachments.js'
import { mapWithConcurrency } from '../concurrency.js'
import type {
  SupportedLocalLibrary,
  ZoteroChildPage,
  ZoteroChildPageRequest,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
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
  if (ref.kind === 'attachment' && itemType !== 'attachment') {
    throw new ZoteroError(attachmentTargetKindMessage(itemType), ZOTERO_INVALID_ARGUMENT)
  }
  const keys = collectionKeysOf(parent.json)
  const collectionNames =
    keys.length > 0
      ? await directory.collectionNamesFor(keys, library, serverId, signal)
      : undefined
  const context = { library, serverId }
  const normalize = (rows?: readonly unknown[]) =>
    normalizeItemDetail({
      parent: parent.json,
      library,
      serverId,
      include: request.include,
      childrenRows: rows,
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
  for (const listing of listings) {
    const kinds =
      listing === 'direct' ? includes.filter((kind) => kind !== 'annotations') : [listing]
    const requested = listing === 'direct' ? undefined : request.childPages?.[listing]
    const window =
      requested === undefined
        ? undefined
        : childPageWindowOf({ kind: listing as ZoteroInclude, ...requested }, deps.limits)
    for (const kind of kinds) {
      Object.assign(detail, {
        [kind]: { total: 0, returned: 0, items: [], completeness: window ? 'page' : 'complete' },
      })
    }
    const seen = new Set<string>()
    for await (const page of childPages(
      deps,
      ref.key,
      library,
      serverId,
      listing,
      signal,
      window,
    )) {
      const normalized = normalize(page.rows)
      if (normalized.bestAttachment) detail.bestAttachment ??= normalized.bestAttachment
      if (locations === 'best' && !detail.bestAttachment) {
        const candidateRow = page.rows.find(
          (row) =>
            asRecord(asRecord(row)?.data)?.itemType === 'attachment' &&
            normalizeAttachmentRecord(row).contentType === 'application/pdf',
        )
        if (candidateRow) {
          detail.bestAttachment = attachmentRecordOf(
            normalizeAttachmentRecord(candidateRow),
            context,
          )
          bestRow = candidateRow
        }
      }
      for (const row of page.rows) {
        const rowKey = asString(asRecord(row)?.key)
        if (!rowKey || seen.has(rowKey))
          throw new ZoteroError('Duplicate or invalid child key during reading.', ZOTERO_UNEXPECTED)
        seen.add(rowKey)
        if (
          locations === 'best' &&
          refStringFor(library, 'attachment', rowKey, serverId) === detail.bestAttachment?.ref
        )
          bestRow = row
      }
      if (locations === 'included') {
        // Resolve only this page, then discard its raw rows before fetching another.
        const pageRows = new Map(page.rows.map((row) => [asString(asRecord(row)?.key), row]))
        await mapWithConcurrency(
          normalized.attachments?.items ?? [],
          deps.limits.graphConcurrency,
          (attachment, poolSignal) =>
            resolveRecord(
              attachment,
              pageRows.get(parseSupportedRef(attachment.ref, ['attachment']).key),
              poolSignal,
            ),
          { signal },
        )
      }
      for (const kind of kinds) {
        const target = detail[kind]!
        const current = normalized[kind]!
        // Each page is normalized before another raw response is requested.
        target.items.push(...(current.items as never[]))
        target.returned += current.returned
        if (kind === 'attachments' && detail.bestAttachment) {
          const same = normalized.attachments?.items.find(
            (attachment) => attachment.ref === detail.bestAttachment?.ref,
          )
          if (same) Object.assign(detail.bestAttachment, same)
        }
        target.total = listing === 'direct' ? target.returned : page.total
        if (window)
          Object.assign(target, {
            offset: page.offset,
            limit: page.limit,
            ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
          })
      }
      if (listing === 'direct') detail.children.total = page.total
    }
  }
  if (locations !== 'none') {
    if (locations === 'best' && detail.bestAttachment === undefined) {
      // Fetch candidates only when the caller explicitly asks for a location.
      for await (const page of childPages(
        deps,
        ref.key,
        library,
        serverId,
        'attachments',
        signal,
      )) {
        for (const row of page.rows) {
          const candidate = normalizeAttachmentRecord(row)
          if (detail.bestAttachment === undefined && candidate.contentType === 'application/pdf') {
            detail.bestAttachment = attachmentRecordOf(candidate, context)
            bestRow = row
          }
        }
        if (detail.bestAttachment !== undefined) break
      }
      if (detail.bestAttachment === undefined)
        detail.location = { kind: 'unavailable', reason: 'No attachment to resolve.' }
    }
    if (locations === 'best' && detail.bestAttachment)
      await resolveRecord(detail.bestAttachment, bestRow, signal)
  }
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
    if (itemType !== 'attachment') {
      throw new ZoteroError(
        itemType === ''
          ? `The referenced object ${ref.key} could not be confirmed as an attachment.`
          : attachmentTargetKindMessage(itemType),
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    const fetched = await fetchChildPage(
      deps,
      'annotations',
      ref.key,
      library,
      serverId,
      page,
      signal,
    )
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
  const fetched = await fetchChildPage(
    deps,
    request.kind,
    ref.key,
    library,
    ref.serverId,
    page,
    signal,
  )
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
