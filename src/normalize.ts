/**
 * Forward-tolerant normalization of Zotero Local API JSON into the plugin's
 * domain records. External JSON is a compatibility boundary: unknown fields
 * are ignored, missing optional fields are tolerated, but a broken required
 * invariant (an object key that is not a Zotero key) fails loud — silently
 * returning partially incorrect research metadata is never acceptable.
 * @module dsh-zotero/normalize
 */

import {
  bestAttachmentFromLinks,
  extractAttachmentKey,
  normalizeAttachmentRecord,
  type ZoteroAttachmentCandidate,
} from './attachments.js'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asJsonValue, asRecord, asString, isObjectKey } from './json.js'
import { formatRef, parseZoteroRelationUri, refForLibrary } from './refs.js'
import type {
  SupportedLocalLibrary,
  ZoteroAnnotationRecord,
  ZoteroAttachmentRecord,
  ZoteroChildCollection,
  ZoteroCollectionRecord,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroNoteRecord,
  ZoteroRelation,
  ZoteroSearchItem,
} from './types.js'

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined
}

function asInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** The publication year of a parsed date string (`YYYY-…`), or undefined. */
function parsedYearOf(parsedDate: string | undefined): number | undefined {
  return parsedDate !== undefined && /^\d{4}/.test(parsedDate)
    ? Number(parsedDate.slice(0, 4))
    : undefined
}

/**
 * Reduce a Zotero note body to plain text: block-level tags become line
 * breaks, remaining tags are dropped, and the common HTML entities are
 * decoded. Whitespace otherwise stays verbatim.
 */
export function plainNoteText(value: unknown): string {
  const raw = asString(value) ?? ''
  if (raw === '') return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|div|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim()
}

/** A valid parent-item key from `data.parentItem`, or undefined. */
function parentKeyOf(data: Record<string, unknown> | undefined): string | undefined {
  const parent = asString(data?.parentItem)
  return parent !== undefined && isObjectKey(parent) ? parent : undefined
}

export interface NormalizeContext {
  readonly library: SupportedLocalLibrary
  readonly serverId?: string
}

const PERSONAL_CTX: NormalizeContext = { library: { type: 'user', id: 0 } }

function resolveContext(ctx?: NormalizeContext): NormalizeContext {
  return ctx ?? PERSONAL_CTX
}

/**
 * Normalize one item JSON object into a compact search hit.
 * @param json - the raw API object; anything outside the documented shape is ignored.
 * @param ctx - the library+serverId context; omitted means the personal library without provenance.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeSearchItem(json: unknown, ctx?: NormalizeContext): ZoteroSearchItem {
  const context = resolveContext(ctx)
  const record = asRecord(json)
  if (record === undefined) {
    throw new ZoteroError('Zotero returned an item without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const key = asString(record.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError('Zotero returned an item without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record.data)
  const meta = asRecord(record.meta)
  const attachment = asRecord(asRecord(record.links)?.attachment)
  const attachmentKey = extractAttachmentKey(asString(attachment?.href))
  const parsedDate = asString(meta?.parsedDate)
  const itemType = asString(data?.itemType) ?? asString(record.itemType) ?? ''
  let title = asString(data?.title) ?? ''
  // Notes carry their content in `data.note` and often no title; synthesize
  // one from the first non-empty line so search hits stay distinguishable.
  if (itemType === 'note' && title === '') {
    title =
      plainNoteText(data?.note)
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '') ?? '(untitled note)'
  }
  // Optional fields are omitted rather than set to undefined, so the record
  // is always a pure lossless-JSON value for the tool output snapshot.
  const item: ZoteroSearchItem = {
    ref: formatRef(refForLibrary(context.library, 'item', key, context.serverId)),
    title,
    creatorSummary: asString(meta?.creatorSummary) ?? '',
    itemType,
  }
  const year = parsedYearOf(parsedDate)
  if (year !== undefined) item.year = year
  const parentKey = parentKeyOf(data)
  if (parentKey !== undefined)
    item.parentRef = formatRef(refForLibrary(context.library, 'item', parentKey, context.serverId))
  if (attachmentKey !== undefined)
    item.bestAttachmentRef = formatRef(
      refForLibrary(context.library, 'attachment', attachmentKey, context.serverId),
    )
  const bestAttachmentType = asString(attachment?.attachmentType)
  if (bestAttachmentType !== undefined) item.bestAttachmentType = bestAttachmentType
  if (typeof attachment?.attachmentSize === 'number')
    item.attachmentSize = attachment.attachmentSize
  return item
}

/**
 * Normalize one collection or saved-search JSON object into its identity pair.
 * Collections also carry their parent key, so a cached listing is rich enough
 * to rebuild breadcrumbs without a second fetch.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeScopeEntry(json: unknown): ScopeNameEntry {
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(
      'Zotero returned a scope object without a valid object key.',
      ZOTERO_UNEXPECTED,
    )
  }
  const data = asRecord(record?.data)
  const parent = asString(data?.parentCollection)
  const parentKey = parent !== undefined && isObjectKey(parent) ? parent : undefined
  return {
    key,
    name: asString(data?.name) ?? '',
    ...(parentKey !== undefined ? { parentKey } : {}),
  }
}

export interface ScopeNameEntry {
  readonly key: string
  readonly name: string
  /** Parent collection key; present only for non-root collections. */
  readonly parentKey?: string
}

/**
 * Match a wanted name against scope entries: an exact Unicode match wins;
 * otherwise every case-insensitive match is returned (possibly none).
 * @returns the matching entries, exact or case-insensitive.
 */
export function matchScopeName(
  entries: readonly ScopeNameEntry[],
  wanted: string,
): ScopeNameEntry[] {
  const exact = entries.filter((entry) => entry.name === wanted)
  if (exact.length > 0) return exact
  const wantedLower = wanted.toLowerCase()
  return entries.filter((entry) => entry.name.toLowerCase() === wantedLower)
}

/**
 * Near-match candidates for diagnostics: case-insensitive substring matches,
 * shortest names first, capped at `limit`.
 */
export function nearScopeCandidates(
  entries: readonly ScopeNameEntry[],
  wanted: string,
  limit = 5,
): ScopeNameEntry[] {
  const wantedLower = wanted.toLowerCase()
  return entries
    .filter((entry) => entry.name.toLowerCase().includes(wantedLower))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Format creator records as display names: a creator carrying a single
 * `name` field wins; otherwise first and last names are joined. Empty or
 * malformed entries are skipped.
 */
export function normalizeCreators(data: Record<string, unknown> | undefined): string[] {
  const creators = Array.isArray(data?.creators) ? data.creators : []
  const names: string[] = []
  for (const raw of creators) {
    const creator = asRecord(raw)
    const name = asString(creator?.name)
    if (name !== undefined && name !== '') {
      names.push(name)
      continue
    }
    const combined =
      `${asString(creator?.firstName) ?? ''} ${asString(creator?.lastName) ?? ''}`.trim()
    if (combined !== '') names.push(combined)
  }
  return names
}

/** The first non-empty publication venue field, in Zotero's own priority order. */
export function normalizeVenue(data: Record<string, unknown> | undefined): string | undefined {
  for (const field of [
    'publicationTitle',
    'proceedingsTitle',
    'bookTitle',
    'journalAbbreviation',
    'conferenceName',
  ]) {
    const value = asString(data?.[field])
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/** The collection keys an item belongs to, from its `data.collections` block. */
export function collectionKeysOf(json: unknown): string[] {
  const collections = asRecord(asRecord(json)?.data)?.collections
  return Array.isArray(collections)
    ? collections.filter((key): key is string => typeof key === 'string')
    : []
}

/** Cut a text at `max` characters; `truncated` records whether the cut happened. */
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false }
}

/**
 * Normalize one note child row. When `maxChars` is undefined the full body
 * is kept — retrieve chunks untruncated notes itself.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the row has no valid Zotero key.
 */
export function normalizeNoteRecord(
  json: unknown,
  ctx: NormalizeContext | undefined,
  maxChars?: number,
): ZoteroNoteRecord {
  const context = resolveContext(ctx)
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError('Zotero returned a note without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record?.data)
  const raw = plainNoteText(data?.note)
  const { text, truncated } = truncateText(raw, maxChars ?? raw.length)
  const parentKey = parentKeyOf(data)
  return {
    ref: formatRef(refForLibrary(context.library, 'item', key, context.serverId)),
    text,
    truncated,
    ...(parentKey !== undefined
      ? {
          parentRef: formatRef(refForLibrary(context.library, 'item', parentKey, context.serverId)),
        }
      : {}),
  }
}

/**
 * Normalize one annotation child row. Optional fields are omitted rather
 * than undefined so the record stays lossless JSON.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the row has no valid Zotero key.
 */
export function normalizeAnnotationRecord(
  json: unknown,
  ctx?: NormalizeContext,
): ZoteroAnnotationRecord {
  const context = resolveContext(ctx)
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(
      'Zotero returned an annotation without a valid object key.',
      ZOTERO_UNEXPECTED,
    )
  }
  const data = asRecord(record?.data)
  const comment = asString(data?.annotationComment)
  const color = asString(data?.annotationColor)
  const pageLabel = asString(data?.annotationPageLabel)
  const parentKey = parentKeyOf(data)
  return {
    // Annotations are semantic first-class objects: the ref grammar's
    // `annotation` kind, not the generic `item` kind. Their parentRef points
    // at the attachment they annotate.
    ref: formatRef(refForLibrary(context.library, 'annotation', key, context.serverId)),
    type: asString(data?.annotationType) ?? '',
    text: asString(data?.annotationText) ?? '',
    ...(comment !== undefined ? { comment } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(pageLabel !== undefined ? { pageLabel } : {}),
    ...(parentKey !== undefined
      ? {
          parentRef: formatRef(
            refForLibrary(context.library, 'attachment', parentKey, context.serverId),
          ),
        }
      : {}),
  }
}

/** Child rows partitioned by kind. Attachments stay ref-free; callers add provenance. */
export interface PartitionedChildren {
  readonly notes: readonly ZoteroNoteRecord[]
  readonly annotations: readonly ZoteroAnnotationRecord[]
  readonly attachments: readonly ZoteroAttachmentCandidate[]
}

/** The child kinds `partitionChildren` can partition and normalize. */
export type ZoteroChildKind = 'note' | 'annotation' | 'attachment'

const ALL_CHILD_KINDS: ReadonlySet<ZoteroChildKind> = new Set<ZoteroChildKind>([
  'note',
  'annotation',
  'attachment',
])

function annotationSortIndex(row: unknown): string {
  return asString(asRecord(asRecord(row)?.data)?.annotationSortIndex) ?? ''
}

/**
 * Partition child rows into notes, annotations, and attachments. Notes keep
 * API order and are truncated to `noteMaxChars` when given (undefined keeps
 * the full body); annotations are ordered by Zotero's `annotationSortIndex`.
 * Only the requested kinds are normalized — rows of other kinds are still
 * classified by their `itemType` but never read deeper. Unknown child kinds
 * are ignored — the plugin only claims the three kinds it understands — but
 * a malformed row of a requested kind fails loud.
 * @param rows - raw child item JSON objects.
 * @param ctx - the library+serverId context.
 * @param noteMaxChars - per-note budget; undefined keeps the full body.
 * @param kinds - the kinds to normalize; defaults to all three.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` on a requested-kind child without a valid key.
 */
export function partitionChildren(
  rows: readonly unknown[],
  ctx: NormalizeContext | undefined,
  noteMaxChars?: number,
  kinds: ReadonlySet<ZoteroChildKind> = ALL_CHILD_KINDS,
): PartitionedChildren {
  const context = resolveContext(ctx)
  const notes: ZoteroNoteRecord[] = []
  const annotationRows: unknown[] = []
  const attachments: ZoteroAttachmentCandidate[] = []
  const wantsNotes = kinds.has('note')
  const wantsAnnotations = kinds.has('annotation')
  const wantsAttachments = kinds.has('attachment')
  for (const row of rows) {
    const itemType = asString(asRecord(asRecord(row)?.data)?.itemType)
    if (itemType === 'note') {
      if (wantsNotes) notes.push(normalizeNoteRecord(row, context, noteMaxChars))
    } else if (itemType === 'annotation') {
      if (wantsAnnotations) annotationRows.push(row)
    } else if (itemType === 'attachment') {
      if (wantsAttachments) attachments.push(normalizeAttachmentRecord(row))
    }
  }
  annotationRows.sort((a, b) => annotationSortIndex(a).localeCompare(annotationSortIndex(b)))
  return {
    notes,
    annotations: annotationRows.map((row) => normalizeAnnotationRecord(row, context)),
    attachments,
  }
}

export interface NormalizeItemDetailInput {
  /** The single-item response body of `GET /users/0/items/<key>`. */
  readonly parent: unknown
  /** Library context (canonical personal or group); omitted defaults to user/0. */
  readonly library?: SupportedLocalLibrary
  /** The instance that served the parent; recorded as ref provenance. */
  readonly serverId?: string
  /** The child kinds the caller asked to include; unrequested kinds are omitted. */
  readonly include: ReadonlySet<ZoteroInclude>
  /** Rows of `GET /users/0/items/<key>/children`; undefined when not fetched. */
  readonly childrenRows?: readonly unknown[]
  /**
   * The parent's direct child count when annotation rows gathered from
   * attachments were merged into `childrenRows` — the merged array is longer
   * than the direct child set, so the fallback total needs the original count.
   */
  readonly directChildCount?: number
  /** Collection names by key; missing entries render ref-only records. */
  readonly collectionNames?: ReadonlyMap<string, string>
  /** Character budget for the abstract preview. */
  readonly maxAbstractChars: number
  /** Character budget for a note item's own body; `truncated` signals the cut. */
  readonly maxNoteBodyChars: number
  /** Per-note character budget; `truncated` signals the cut. */
  readonly maxNoteChars: number
  /** Upper bound for returned note records. */
  readonly maxNoteRecords: number
  /** Upper bound for returned annotation records. */
  readonly maxAnnotationRecords: number
  /** `all` passes through `data` fields the normalized model does not consume. */
  readonly fields?: 'standard' | 'all'
}

/**
 * The `data` keys the normalized detail model consumes (directly or via the
 * venue fallback chain). Everything else is eligible for `extraFields`.
 */
const CONSUMED_DATA_KEYS: ReadonlySet<string> = new Set([
  'itemType',
  'key',
  'version',
  'title',
  'creators',
  'date',
  'DOI',
  'url',
  'abstractNote',
  'tags',
  'collections',
  'relations',
  'note',
  'parentItem',
  'publicationTitle',
  'proceedingsTitle',
  'bookTitle',
  'journalAbbreviation',
  'conferenceName',
])

/**
 * Collect the `data` fields the normalized model does not consume, sorted by
 * key for stable output. Non-JSON-safe values (undefined, functions) drop.
 */
function extraFieldsOf(
  data: Record<string, unknown> | undefined,
): Record<string, JsonValue> | undefined {
  if (data === undefined) return undefined
  const out: Record<string, JsonValue> = {}
  for (const key of Object.keys(data).sort()) {
    if (CONSUMED_DATA_KEYS.has(key)) continue
    // `__proto__` assignment would mutate the prototype instead of defining an
    // own property; external API keys are never trusted with it.
    if (key === '__proto__') continue
    const value = asJsonValue(data[key])
    if (value === undefined) continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Bound records to `cap` while keeping Zotero's total honest. */
export function childCollection<T>(items: readonly T[], cap: number): ZoteroChildCollection<T> {
  const bounded = items.slice(0, cap)
  return { total: items.length, returned: bounded.length, items: bounded }
}

/**
 * The partition kinds an item detail needs: the requested note/annotation
 * kinds, plus attachments always — the best-attachment choice borrows the
 * child row's title even when the caller did not include attachments.
 */
function detailChildKinds(include: ReadonlySet<ZoteroInclude>): ReadonlySet<ZoteroChildKind> {
  const kinds = new Set<ZoteroChildKind>(['attachment'])
  if (include.has('notes')) kinds.add('note')
  if (include.has('annotations')) kinds.add('annotation')
  return kinds
}

/** Project an attachment candidate into its ref-carrying record. */
export function attachmentRecordOf(
  candidate: ZoteroAttachmentCandidate,
  ctx: NormalizeContext,
): ZoteroAttachmentRecord {
  return {
    ref: formatRef(refForLibrary(ctx.library, 'attachment', candidate.key, ctx.serverId)),
    title: candidate.title,
    contentType: candidate.contentType,
    ...(candidate.linkMode !== undefined ? { linkMode: candidate.linkMode } : {}),
  }
}

function normalizeRelations(
  data: Record<string, unknown> | undefined,
  ctx: NormalizeContext,
  parentLibraryId?: number,
): ZoteroRelation[] | undefined {
  const raw = data?.relations
  if (raw === undefined || raw === null) return undefined
  const record = asRecord(raw)
  if (record === undefined) return undefined
  const out: ZoteroRelation[] = []
  for (const [predicate, value] of Object.entries(record)) {
    const targets = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    for (const target of targets) {
      if (typeof target !== 'string' || target === '') continue
      const parsed = parseZoteroRelationUri(target)
      let targetRef: string | undefined
      if (parsed !== null) {
        if (
          parsed.library.type === 'group' &&
          ctx.library.type === 'group' &&
          parsed.library.id === ctx.library.id
        ) {
          targetRef = formatRef(refForLibrary(ctx.library, 'item', parsed.key, ctx.serverId))
        } else if (parsed.library.type === 'user' && ctx.library.type === 'user') {
          // Personal library: only canonicalize if URI's user id matches parent's real id or is 0
          if (parsed.library.id === 0) {
            targetRef = formatRef(refForLibrary(ctx.library, 'item', parsed.key, ctx.serverId))
          } else if (parentLibraryId !== undefined && parsed.library.id === parentLibraryId) {
            targetRef = formatRef(refForLibrary(ctx.library, 'item', parsed.key, ctx.serverId))
          }
        }
      }
      out.push(
        targetRef === undefined
          ? { predicate, targetUri: target }
          : { predicate, targetUri: target, targetRef },
      )
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * Normalize a full item detail from the single-item response plus its
 * optional children and collection names. Only the include-requested child
 * kinds appear in the result; `bestAttachment` always prefers Zotero's own
 * `links.attachment` choice and borrows the child row's title when present.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the parent or a claimed child has no valid key.
 */
export function normalizeItemDetail(input: NormalizeItemDetailInput): ZoteroItemDetail {
  const ctx: NormalizeContext = {
    library: input.library ?? { type: 'user', id: 0 },
    serverId: input.serverId,
  }
  const record = asRecord(input.parent)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError('Zotero returned an item without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record?.data)
  const meta = asRecord(record?.meta)
  const parsedDate = asString(meta?.parsedDate)
  const abstract = truncateText(asString(data?.abstractNote) ?? '', input.maxAbstractChars)
  const date = nonEmpty(asString(data?.date))
  const doi = nonEmpty(asString(data?.DOI))
  const url = nonEmpty(asString(data?.url))
  const venue = normalizeVenue(data)
  const year = parsedYearOf(parsedDate)
  const version = asInteger(record?.version)
  const tags = normalizeTags(data)
  const itemType = asString(data?.itemType) ?? asString(record?.itemType) ?? ''
  // A note item's own body is its content; `include` governs child kinds only.
  const noteBody =
    itemType === 'note'
      ? truncateText(plainNoteText(data?.note), input.maxNoteBodyChars)
      : undefined

  const keys = collectionKeysOf(input.parent)
  const collections: ZoteroCollectionRecord[] = keys.map((collectionKey) => {
    const name = input.collectionNames?.get(collectionKey)
    return {
      ref: formatRef(refForLibrary(ctx.library, 'collection', collectionKey, ctx.serverId)),
      ...(name !== undefined ? { name } : {}),
    }
  })

  const partitioned =
    input.childrenRows === undefined
      ? undefined
      : partitionChildren(
          input.childrenRows,
          ctx,
          input.maxNoteChars,
          detailChildKinds(input.include),
        )
  const childCollections: {
    notes?: ZoteroChildCollection<ZoteroNoteRecord>
    annotations?: ZoteroChildCollection<ZoteroAnnotationRecord>
    attachments?: ZoteroChildCollection<ZoteroAttachmentRecord>
  } = {}
  if (partitioned !== undefined) {
    if (input.include.has('notes'))
      childCollections.notes = childCollection(partitioned.notes, input.maxNoteRecords)
    if (input.include.has('annotations'))
      childCollections.annotations = childCollection(
        partitioned.annotations,
        input.maxAnnotationRecords,
      )
    if (input.include.has('attachments')) {
      const records = partitioned.attachments.map((candidate) => attachmentRecordOf(candidate, ctx))
      childCollections.attachments = childCollection(records, records.length)
    }
  }

  let bestAttachment: ZoteroAttachmentRecord | undefined
  const linkAttachment = bestAttachmentFromLinks(input.parent)
  if (linkAttachment !== undefined) {
    const child = partitioned?.attachments.find((candidate) => candidate.key === linkAttachment.key)
    bestAttachment = {
      ref: formatRef(refForLibrary(ctx.library, 'attachment', linkAttachment.key, ctx.serverId)),
      title: child?.title ?? '',
      contentType: linkAttachment.contentType,
    }
  }

  const parentLibraryId = (() => {
    const lib = asRecord(record?.library)
    const candidates: unknown[] = [
      lib?.id,
      lib?.libraryID,
      (lib as Record<string, unknown> | undefined)?.libraryId,
      asRecord(record)?.libraryID,
      (record as Record<string, unknown> | undefined)?.libraryId,
    ]
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isInteger(c)) return c
      if (typeof c === 'string' && /^\d+$/.test(c.trim()) && Number.isInteger(Number(c)))
        return Number(c)
    }
    return undefined
  })()
  const relations = normalizeRelations(data, ctx, parentLibraryId)
  const extraFields = input.fields === 'all' ? extraFieldsOf(data) : undefined

  return {
    ref: formatRef(refForLibrary(ctx.library, 'item', key, ctx.serverId)),
    itemType,
    title: asString(data?.title) ?? '',
    creators: normalizeCreators(data),
    abstractTruncated: abstract.truncated,
    tags,
    collections,
    children: { total: childrenTotal(meta, input.childrenRows, input.directChildCount) },
    ...(abstract.text !== '' ? { abstract: abstract.text } : {}),
    ...(noteBody !== undefined ? { noteBody } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(url !== undefined ? { url } : {}),
    ...childCollections,
    ...(bestAttachment !== undefined ? { bestAttachment } : {}),
    ...(relations !== undefined ? { relations } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}),
    ...(extraFields !== undefined ? { extraFields } : {}),
  }
}

function normalizeTags(data: Record<string, unknown> | undefined): string[] {
  const tags = Array.isArray(data?.tags) ? data.tags : []
  const names: string[] = []
  for (const raw of tags) {
    const tag = asString(asRecord(raw)?.tag)
    if (tag !== undefined && tag !== '') names.push(tag)
  }
  return names
}

function childrenTotal(
  meta: Record<string, unknown> | undefined,
  childrenRows: readonly unknown[] | undefined,
  directChildCount?: number,
): number {
  const numChildren = asInteger(meta?.numChildren)
  if (numChildren !== undefined && numChildren >= 0) return numChildren
  // The merged array inflates the row count by the attachment-nested
  // annotations, so prefer the caller's direct count when it rode along.
  if (directChildCount !== undefined) return directChildCount
  return childrenRows?.length ?? 0
}
