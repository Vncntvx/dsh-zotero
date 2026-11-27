/**
 * Normalize Zotero note, annotation, and attachment child rows.
 * @module dsh-zotero/normalize-children
 */

import { normalizeAttachmentRecord, type ZoteroAttachmentCandidate } from './attachments.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asRecord, asString, isObjectKey } from './json.js'
import { refStringFor } from './refs.js'
import type { ZoteroAnnotationRecord, ZoteroNoteRecord, ZoteroAttachmentRecord } from './types.js'
import type { PdfPageRegion } from './reader/evidence.js'
import {
  normalizeTags,
  parentKeyOf,
  plainNoteText,
  resolveNormalizeContext,
  type NormalizeContext,
  truncateText,
} from './normalize-context.js'

export interface PartitionedChildren {
  readonly notes: readonly ZoteroNoteRecord[]
  readonly annotations: readonly ZoteroAnnotationRecord[]
  readonly attachments: readonly ZoteroAttachmentCandidate[]
}

export type ZoteroChildKind = 'note' | 'annotation' | 'attachment'

const ALL_CHILD_KINDS: ReadonlySet<ZoteroChildKind> = new Set(['note', 'annotation', 'attachment'])

export function normalizeNoteRecord(
  json: unknown,
  context: NormalizeContext | undefined,
  maxChars?: number,
): ZoteroNoteRecord {
  const resolved = resolveNormalizeContext(context)
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError('Zotero returned a note without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record?.data)
  const raw = plainNoteText(data?.note)
  const { text, truncated } = truncateText(raw, maxChars ?? raw.length)
  const parent = parentKeyOf(data)
  return {
    ref: refStringFor(resolved.library, 'item', key, resolved.serverId),
    text,
    truncated,
    ...(parent !== undefined
      ? { parentRef: refStringFor(resolved.library, 'item', parent, resolved.serverId) }
      : {}),
  }
}

export function normalizeAnnotationRecord(
  json: unknown,
  context?: NormalizeContext,
  includePosition = false,
): ZoteroAnnotationRecord {
  const resolved = resolveNormalizeContext(context)
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
  const version = includePosition
    ? typeof record?.version === 'number' &&
      Number.isSafeInteger(record.version) &&
      record.version >= 0
      ? record.version
      : typeof data?.version === 'number' && Number.isSafeInteger(data.version) && data.version >= 0
        ? data.version
        : undefined
    : undefined
  const position = includePosition ? annotationPositionOf(data?.annotationPosition) : undefined
  const parent = parentKeyOf(data)
  return {
    ref: refStringFor(resolved.library, 'annotation', key, resolved.serverId),
    type: asString(data?.annotationType) ?? '',
    text: asString(data?.annotationText) ?? '',
    ...(comment !== undefined ? { comment } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(pageLabel !== undefined ? { pageLabel } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(includePosition && Array.isArray(data?.tags) ? { tags: normalizeTags(data) } : {}),
    ...(position === undefined ? {} : { position }),
    ...(parent !== undefined
      ? { parentRef: refStringFor(resolved.library, 'attachment', parent, resolved.serverId) }
      : {}),
  }
}

function annotationPositionOf(raw: unknown): PdfPageRegion | undefined {
  let position: unknown = raw
  if (typeof raw === 'string') {
    try {
      position = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  const record = asRecord(position)
  const { pageIndex, rects } = record ?? {}
  if (typeof pageIndex !== 'number' || !Number.isSafeInteger(pageIndex) || pageIndex < 0)
    return undefined
  if (!Array.isArray(rects)) return { pageIndex, rects: [] }
  const rectangles = rects.slice(0, 1024).flatMap((bounds: unknown) => {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return []
    const [left, bottom, right, top] = bounds as [number, number, number, number]
    const width = Math.abs(right - left)
    const height = Math.abs(top - bottom)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0)
      return []
    return [{ x: Math.min(left, right), y: Math.min(bottom, top), width, height }]
  })
  return { pageIndex, rects: rectangles }
}

function annotationSortIndex(row: unknown): string {
  return asString(asRecord(asRecord(row)?.data)?.annotationSortIndex) ?? ''
}

export function partitionChildren(
  rows: readonly unknown[],
  context: NormalizeContext | undefined,
  noteMaxChars?: number,
  kinds: ReadonlySet<ZoteroChildKind> = ALL_CHILD_KINDS,
  includeAnnotationPosition = false,
): PartitionedChildren {
  const resolved = resolveNormalizeContext(context)
  const notes: ZoteroNoteRecord[] = []
  const annotationRows: unknown[] = []
  const attachments: ZoteroAttachmentCandidate[] = []
  for (const row of rows) {
    const itemType = asString(asRecord(asRecord(row)?.data)?.itemType)
    if (itemType === 'note') {
      if (kinds.has('note')) notes.push(normalizeNoteRecord(row, resolved, noteMaxChars))
    } else if (itemType === 'annotation') {
      if (kinds.has('annotation')) annotationRows.push(row)
    } else if (itemType === 'attachment' && kinds.has('attachment')) {
      attachments.push(normalizeAttachmentRecord(row))
    }
  }
  annotationRows.sort((left, right) => {
    const leftIndex = annotationSortIndex(left)
    const rightIndex = annotationSortIndex(right)
    return leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0
  })
  return {
    notes,
    annotations: annotationRows.map((row) =>
      normalizeAnnotationRecord(row, resolved, includeAnnotationPosition),
    ),
    attachments,
  }
}

export function attachmentRecordOf(
  candidate: ZoteroAttachmentCandidate,
  context: NormalizeContext,
): ZoteroAttachmentRecord {
  return {
    ref: refStringFor(context.library, 'attachment', candidate.key, context.serverId),
    title: candidate.title,
    contentType: candidate.contentType,
    ...(candidate.linkMode !== undefined ? { linkMode: candidate.linkMode } : {}),
    ...(candidate.url !== undefined ? { url: candidate.url } : {}),
  }
}
