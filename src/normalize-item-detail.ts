/**
 * Normalize a parent item and its bounded child listings into item detail.
 * @module dsh-zotero/normalize-item-detail
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { bestAttachmentFromLinks } from './attachments.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asJsonValue, asRecord, asString, isObjectKey } from './json.js'
import { refStringFor, relationTargetRef } from './refs.js'
import { ITEM_WITHOUT_KEY_MESSAGE, plainNoteText, truncateText } from './normalize-context.js'
import type { NormalizeContext } from './normalize-context.js'
import {
  attachmentRecordOf,
  partitionChildren,
  type ZoteroChildKind,
} from './normalize-children.js'
import {
  collectionKeysOf,
  normalizeCreators,
  normalizeVenue,
  parsedYearOf,
} from './normalize-search.js'
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
} from './types.js'

export interface ChildPageMeta {
  readonly total: number
  readonly offset: number
  readonly limit: number
  readonly nextOffset?: number
}

export interface NormalizeItemDetailInput {
  readonly parent: unknown
  readonly library?: SupportedLocalLibrary
  readonly serverId?: string
  readonly include: ReadonlySet<ZoteroInclude>
  readonly childrenRows?: readonly unknown[]
  readonly directChildCount?: number
  readonly childPages?: Partial<Record<'notes' | 'attachments' | 'annotations', ChildPageMeta>>
  readonly collectionNames?: ReadonlyMap<string, string>
  readonly maxAbstractChars: number
  readonly maxNoteBodyChars: number
  readonly maxNoteChars: number
  readonly maxNoteRecords: number
  readonly maxAnnotationRecords: number
  readonly maxAttachmentRecords: number
  readonly fields?: 'standard' | 'all'
}

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
  'extra',
])

function extraFieldsOf(
  data: Record<string, unknown> | undefined,
): Record<string, JsonValue> | undefined {
  if (data === undefined) return undefined
  const output: Record<string, JsonValue> = {}
  for (const key of Object.keys(data).sort()) {
    if (CONSUMED_DATA_KEYS.has(key) || key === '__proto__') continue
    const value = asJsonValue(data[key])
    if (value !== undefined) output[key] = value
  }
  return Object.keys(output).length > 0 ? output : undefined
}

export function childCollection<T>(
  items: readonly T[],
  cap: number,
  page?: ChildPageMeta,
): ZoteroChildCollection<T> {
  const bounded = items.slice(0, cap)
  return {
    total: page?.total ?? items.length,
    returned: bounded.length,
    items: bounded,
    ...(page !== undefined ? { offset: page.offset, limit: page.limit } : {}),
    ...(page?.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
  }
}

function detailChildKinds(include: ReadonlySet<ZoteroInclude>): ReadonlySet<ZoteroChildKind> {
  const kinds = new Set<ZoteroChildKind>(['attachment'])
  if (include.has('notes')) kinds.add('note')
  if (include.has('annotations')) kinds.add('annotation')
  return kinds
}

function normalizeRelations(
  data: Record<string, unknown> | undefined,
  context: NormalizeContext,
  parentLibraryId?: number,
): ZoteroRelation[] | undefined {
  const raw = data?.relations
  if (raw === undefined || raw === null) return undefined
  const record = asRecord(raw)
  if (record === undefined) return undefined
  const relations: ZoteroRelation[] = []
  for (const [predicate, value] of Object.entries(record)) {
    const targets = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    for (const target of targets) {
      if (typeof target !== 'string' || target === '') continue
      const targetRef = relationTargetRef(target, context.serverId, {
        library: context.library,
        parentLibraryId,
      })
      relations.push(
        targetRef === undefined
          ? { predicate, targetUri: target }
          : { predicate, targetUri: target, targetRef },
      )
    }
  }
  return relations.length > 0 ? relations : undefined
}

function normalizeTags(data: Record<string, unknown> | undefined): string[] {
  const rawTags = Array.isArray(data?.tags) ? data.tags : []
  const tags: string[] = []
  for (const raw of rawTags) {
    const tag = asString(asRecord(raw)?.tag)
    if (tag !== undefined && tag !== '') tags.push(tag)
  }
  return tags
}

function childrenTotal(
  meta: Record<string, unknown> | undefined,
  rows: readonly unknown[] | undefined,
  directCount?: number,
): number {
  const count = meta?.numChildren
  if (typeof count === 'number' && Number.isInteger(count) && count >= 0) return count
  if (directCount !== undefined) return directCount
  if (rows === undefined) return 0
  return rows.filter((row) => asRecord(asRecord(row)?.data)?.itemType !== 'annotation').length
}

export function normalizeItemDetail(input: NormalizeItemDetailInput): ZoteroItemDetail {
  const context: NormalizeContext = {
    library: input.library ?? { type: 'user', id: 0 },
    serverId: input.serverId,
  }
  const record = asRecord(input.parent)
  if (record === undefined) {
    throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record.data)
  const meta = asRecord(record.meta)
  const parsedDate = asString(meta?.parsedDate)
  const abstract = truncateText(asString(data?.abstractNote) ?? '', input.maxAbstractChars)
  const date = asString(data?.date) || undefined
  const doi = asString(data?.DOI) || undefined
  const url = asString(data?.url) || undefined
  const venue = normalizeVenue(data)
  const year = parsedYearOf(parsedDate)
  const version = record.version
  const versionNumber =
    typeof version === 'number' && Number.isInteger(version) ? version : undefined
  const tags = normalizeTags(data)
  const itemType = asString(data?.itemType) ?? asString(record.itemType) ?? ''
  const noteBody =
    itemType === 'note'
      ? truncateText(plainNoteText(data?.note), input.maxNoteBodyChars)
      : undefined

  const collections: ZoteroCollectionRecord[] = collectionKeysOf(input.parent).map(
    (collectionKey) => {
      const name = input.collectionNames?.get(collectionKey)
      return {
        ref: refStringFor(context.library, 'collection', collectionKey, context.serverId),
        ...(name !== undefined ? { name } : {}),
      }
    },
  )

  const partitioned =
    input.childrenRows === undefined
      ? undefined
      : partitionChildren(
          input.childrenRows,
          context,
          input.maxNoteChars,
          detailChildKinds(input.include),
        )
  const childCollections: {
    notes?: ZoteroChildCollection<ZoteroNoteRecord>
    annotations?: ZoteroChildCollection<ZoteroAnnotationRecord>
    attachments?: ZoteroChildCollection<ZoteroAttachmentRecord>
  } = {}
  if (partitioned !== undefined) {
    if (input.include.has('notes')) {
      childCollections.notes = childCollection(
        partitioned.notes,
        input.maxNoteRecords,
        input.childPages?.notes,
      )
    }
    if (input.include.has('annotations')) {
      childCollections.annotations = childCollection(
        partitioned.annotations,
        input.maxAnnotationRecords,
        input.childPages?.annotations,
      )
    }
    if (input.include.has('attachments')) {
      childCollections.attachments = childCollection(
        partitioned.attachments.map((candidate) => attachmentRecordOf(candidate, context)),
        input.maxAttachmentRecords,
        input.childPages?.attachments,
      )
    }
  }

  let bestAttachment: ZoteroAttachmentRecord | undefined
  const linkAttachment = bestAttachmentFromLinks(input.parent)
  if (linkAttachment !== undefined) {
    const child = partitioned?.attachments.find((candidate) => candidate.key === linkAttachment.key)
    bestAttachment = {
      ref: refStringFor(context.library, 'attachment', linkAttachment.key, context.serverId),
      title: child?.title ?? '',
      contentType: linkAttachment.contentType,
    }
  }

  const libraryRecord = asRecord(record.library)
  const libraryIdCandidates: unknown[] = [
    libraryRecord?.id,
    libraryRecord?.libraryID,
    libraryRecord?.libraryId,
    record.libraryID,
    record.libraryId,
  ]
  let parentLibraryId: number | undefined
  for (const candidate of libraryIdCandidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      parentLibraryId = candidate
      break
    }
    if (typeof candidate === 'string' && /^\d+$/.test(candidate.trim())) {
      const parsed = Number(candidate)
      if (Number.isInteger(parsed)) {
        parentLibraryId = parsed
        break
      }
    }
  }
  const relations = normalizeRelations(data, context, parentLibraryId)
  const extraFields = input.fields === 'all' ? extraFieldsOf(data) : undefined
  const extra = asString(data?.extra)?.trim()

  return {
    ref: refStringFor(context.library, 'item', key, context.serverId),
    itemType,
    title: asString(data?.title) ?? '',
    creators: normalizeCreators(data),
    ...(extra !== undefined && extra !== '' ? { extra } : {}),
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
    ...(versionNumber !== undefined ? { version: versionNumber } : {}),
    ...(context.serverId !== undefined ? { serverId: context.serverId } : {}),
    ...(extraFields !== undefined ? { extraFields } : {}),
  }
}
