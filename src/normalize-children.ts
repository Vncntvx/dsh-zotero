/**
 * Normalize Zotero note, annotation, and attachment child rows.
 * @module dsh-zotero/normalize-children
 */

import { normalizeAttachmentRecord, type ZoteroAttachmentCandidate } from './attachments.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asRecord, asString, isObjectKey } from './json.js'
import { refStringFor } from './refs.js'
import type { ZoteroAnnotationRecord, ZoteroNoteRecord, ZoteroAttachmentRecord } from './types.js'
import {
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
  const parent = parentKeyOf(data)
  return {
    ref: refStringFor(resolved.library, 'annotation', key, resolved.serverId),
    type: asString(data?.annotationType) ?? '',
    text: asString(data?.annotationText) ?? '',
    ...(comment !== undefined ? { comment } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(pageLabel !== undefined ? { pageLabel } : {}),
    ...(parent !== undefined
      ? { parentRef: refStringFor(resolved.library, 'attachment', parent, resolved.serverId) }
      : {}),
  }
}

function annotationSortIndex(row: unknown): string {
  return asString(asRecord(asRecord(row)?.data)?.annotationSortIndex) ?? ''
}

export function partitionChildren(
  rows: readonly unknown[],
  context: NormalizeContext | undefined,
  noteMaxChars?: number,
  kinds: ReadonlySet<ZoteroChildKind> = ALL_CHILD_KINDS,
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
    annotations: annotationRows.map((row) => normalizeAnnotationRecord(row, resolved)),
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
  }
}
