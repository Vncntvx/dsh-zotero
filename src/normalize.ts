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
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asRecord, asString, isObjectKey } from './json.js'
import { formatRef, localRef } from './refs.js'
import type {
  ZoteroAnnotationRecord,
  ZoteroAttachmentRecord,
  ZoteroChildCollection,
  ZoteroCollectionRecord,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroNoteRecord,
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

/**
 * Normalize one item JSON object into a compact search hit.
 * @param json - the raw API object; anything outside the documented shape is ignored.
 * @param serverId - the instance that served the response; recorded as ref provenance.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeSearchItem(json: unknown, serverId?: string): ZoteroSearchItem {
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
    ref: formatRef(localRef('item', key, serverId)),
    title,
    creatorSummary: asString(meta?.creatorSummary) ?? '',
    itemType,
  }
  const year = parsedYearOf(parsedDate)
  if (year !== undefined) item.year = year
  const parentKey = parentKeyOf(data)
  if (parentKey !== undefined) item.parentRef = formatRef(localRef('item', parentKey, serverId))
  if (attachmentKey !== undefined)
    item.bestAttachmentRef = formatRef(localRef('attachment', attachmentKey, serverId))
  const bestAttachmentType = asString(attachment?.attachmentType)
  if (bestAttachmentType !== undefined) item.bestAttachmentType = bestAttachmentType
  if (typeof attachment?.attachmentSize === 'number')
    item.attachmentSize = attachment.attachmentSize
  return item
}

/**
 * Normalize one collection or saved-search JSON object into its identity pair.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeScopeEntry(json: unknown): { key: string; name: string } {
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(
      'Zotero returned a scope object without a valid object key.',
      ZOTERO_UNEXPECTED,
    )
  }
  return { key, name: asString(asRecord(record?.data)?.name) ?? '' }
}

export interface ScopeNameEntry {
  readonly key: string
  readonly name: string
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
  serverId: string | undefined,
  maxChars?: number,
): ZoteroNoteRecord {
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
    ref: formatRef(localRef('item', key, serverId)),
    text,
    truncated,
    ...(parentKey !== undefined
      ? { parentRef: formatRef(localRef('item', parentKey, serverId)) }
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
  serverId?: string,
): ZoteroAnnotationRecord {
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
    ref: formatRef(localRef('item', key, serverId)),
    type: asString(data?.annotationType) ?? '',
    text: asString(data?.annotationText) ?? '',
    ...(comment !== undefined ? { comment } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(pageLabel !== undefined ? { pageLabel } : {}),
    ...(parentKey !== undefined
      ? { parentRef: formatRef(localRef('attachment', parentKey, serverId)) }
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
 * @param serverId - the instance that served the rows; recorded as ref provenance.
 * @param noteMaxChars - per-note budget; undefined keeps the full body.
 * @param kinds - the kinds to normalize; defaults to all three.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` on a requested-kind child without a valid key.
 */
export function partitionChildren(
  rows: readonly unknown[],
  serverId: string | undefined,
  noteMaxChars?: number,
  kinds: ReadonlySet<ZoteroChildKind> = ALL_CHILD_KINDS,
): PartitionedChildren {
  const notes: ZoteroNoteRecord[] = []
  const annotationRows: unknown[] = []
  const attachments: ZoteroAttachmentCandidate[] = []
  const wantsNotes = kinds.has('note')
  const wantsAnnotations = kinds.has('annotation')
  const wantsAttachments = kinds.has('attachment')
  for (const row of rows) {
    const itemType = asString(asRecord(asRecord(row)?.data)?.itemType)
    if (itemType === 'note') {
      if (wantsNotes) notes.push(normalizeNoteRecord(row, serverId, noteMaxChars))
    } else if (itemType === 'annotation') {
      if (wantsAnnotations) annotationRows.push(row)
    } else if (itemType === 'attachment') {
      if (wantsAttachments) attachments.push(normalizeAttachmentRecord(row))
    }
  }
  annotationRows.sort((a, b) => annotationSortIndex(a).localeCompare(annotationSortIndex(b)))
  return {
    notes,
    annotations: annotationRows.map((row) => normalizeAnnotationRecord(row, serverId)),
    attachments,
  }
}

export interface NormalizeItemDetailInput {
  /** The single-item response body of `GET /users/0/items/<key>`. */
  readonly parent: unknown
  /** The instance that served the parent; recorded as ref provenance. */
  readonly serverId?: string
  /** The child kinds the caller asked to include; unrequested kinds are omitted. */
  readonly include: ReadonlySet<ZoteroInclude>
  /** Rows of `GET /users/0/items/<key>/children`; undefined when not fetched. */
  readonly childrenRows?: readonly unknown[]
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
}

function childCollection<T>(items: readonly T[], cap: number): ZoteroChildCollection<T> {
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

function attachmentRecordOf(
  candidate: ZoteroAttachmentCandidate,
  serverId: string | undefined,
): ZoteroAttachmentRecord {
  return {
    ref: formatRef(localRef('attachment', candidate.key, serverId)),
    title: candidate.title,
    contentType: candidate.contentType,
    ...(candidate.linkMode !== undefined ? { linkMode: candidate.linkMode } : {}),
  }
}

/**
 * Normalize a full item detail from the single-item response plus its
 * optional children and collection names. Only the include-requested child
 * kinds appear in the result; `bestAttachment` always prefers Zotero's own
 * `links.attachment` choice and borrows the child row's title when present.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the parent or a claimed child has no valid key.
 */
export function normalizeItemDetail(input: NormalizeItemDetailInput): ZoteroItemDetail {
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
      ref: formatRef(localRef('collection', collectionKey, input.serverId)),
      ...(name !== undefined ? { name } : {}),
    }
  })

  const partitioned =
    input.childrenRows === undefined
      ? undefined
      : partitionChildren(
          input.childrenRows,
          input.serverId,
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
      const records = partitioned.attachments.map((candidate) =>
        attachmentRecordOf(candidate, input.serverId),
      )
      childCollections.attachments = childCollection(records, records.length)
    }
  }

  let bestAttachment: ZoteroAttachmentRecord | undefined
  const linkAttachment = bestAttachmentFromLinks(input.parent)
  if (linkAttachment !== undefined) {
    const child = partitioned?.attachments.find((candidate) => candidate.key === linkAttachment.key)
    bestAttachment = {
      ref: formatRef(localRef('attachment', linkAttachment.key, input.serverId)),
      title: child?.title ?? '',
      contentType: linkAttachment.contentType,
    }
  }

  return {
    ref: formatRef(localRef('item', key, input.serverId)),
    itemType,
    title: asString(data?.title) ?? '',
    creators: normalizeCreators(data),
    abstractTruncated: abstract.truncated,
    tags,
    collections,
    children: { total: childrenTotal(meta, input.childrenRows) },
    ...(abstract.text !== '' ? { abstract: abstract.text } : {}),
    ...(noteBody !== undefined ? { noteBody } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(url !== undefined ? { url } : {}),
    ...childCollections,
    ...(bestAttachment !== undefined ? { bestAttachment } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(input.serverId !== undefined ? { serverId: input.serverId } : {}),
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
): number {
  const numChildren = asInteger(meta?.numChildren)
  if (numChildren !== undefined && numChildren >= 0) return numChildren
  return childrenRows?.length ?? 0
}
