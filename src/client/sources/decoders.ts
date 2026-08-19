/**
 * The meta decoding layer of the session source model: each tool's
 * presentation projection read off a settled block. The shapes are the
 * current wire shapes (no legacy projection versions are carried — session
 * logs are per-session snapshots); reads are defensive, so an absent or
 * malformed field degrades to nothing instead of crashing the panel. Only
 * the fields the panel renders are decoded.
 * @module dsh-zotero/client/sources/decoders
 */

import {
  boolField,
  evidenceItemsOf,
  isRecord,
  numberField,
  stringField,
  type EvidenceItemView,
} from '../presenters.ts'
import type { ExportDocumentItem, SourceAvailabilityEntry, SourceCoverage } from './model.ts'

/** One decoded search row (with Zotero's attachment selection when present). */
interface SearchRowMeta {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  readonly bestAttachmentRef?: string
  readonly bestAttachmentType?: string
}

/** The search projection view; `rows === null` means malformed. */
export interface SearchMetaView {
  readonly rows: readonly SearchRowMeta[] | null
  readonly omitted: number | null
}

/** The get projection view; a null field is absent or malformed. */
export interface GetMetaView {
  readonly title: string | null
  readonly creators: string | null
  readonly year: number | null
  readonly venue: string | null
  readonly bestAttachment: { readonly ref?: string; readonly contentType: string } | null
}

/** The retrieve projection view; `items === null` means malformed. */
export interface RetrieveMetaView {
  readonly items: readonly EvidenceItemView[] | null
  readonly count: number | null
  readonly truncated: boolean | null
  readonly attachmentRef: string | null
  readonly attachmentContentType: string | null
  readonly coverage: SourceCoverage | null
  readonly sourceAvailability: Readonly<Record<string, SourceAvailabilityEntry>>
}

/** The attachment projection view; a null field is absent or malformed. */
export interface AttachmentMetaView {
  readonly kind: 'file' | 'url' | null
  readonly title: string | null
  readonly contentType: string | null
  readonly location: string | null
  readonly ref: string | null
}

/** The export projection view; a record without refs itemizes none. */
export interface ExportMetaView {
  readonly format: string | null
  readonly style: string | null
  readonly locale: string | null
  readonly refs: readonly string[]
  readonly refsOmitted: number
  /** The bounded per-document items; empty when the projection carried none. */
  readonly items: readonly ExportDocumentItem[]
}

/** String entries of an array-shaped field; anything else yields nothing. */
function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/** The bounded per-document items of an export projection; malformed rows are dropped. */
function exportItemsOf(value: unknown): ExportDocumentItem[] {
  if (!Array.isArray(value)) return []
  const items: ExportDocumentItem[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const ref = stringField(entry, 'ref')
    if (ref === undefined) continue
    const key = stringField(entry, 'key')
    const title = stringField(entry, 'title')
    const entryIndex = numberField(entry, 'entryIndex')
    const start = numberField(entry, 'start')
    const end = numberField(entry, 'end')
    items.push({
      ref,
      ...(key === undefined ? {} : { key }),
      ...(title === undefined ? {} : { title }),
      ...(entryIndex === undefined ? {} : { entryIndex }),
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
    })
  }
  return items
}

function decodeSearchRows(value: unknown): SearchRowMeta[] | null {
  if (!Array.isArray(value)) return null
  const rows: SearchRowMeta[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const ref = stringField(item, 'ref')
    const title = stringField(item, 'title')
    const creatorSummary = stringField(item, 'creatorSummary')
    if (ref === undefined || title === undefined || creatorSummary === undefined) return null
    const year = numberField(item, 'year')
    const bestAttachmentRef = stringField(item, 'bestAttachmentRef')
    const bestAttachmentType = stringField(item, 'bestAttachmentType')
    rows.push({
      ref,
      title,
      creatorSummary,
      ...(year === undefined ? {} : { year }),
      ...(bestAttachmentRef === undefined ? {} : { bestAttachmentRef }),
      ...(bestAttachmentType === undefined ? {} : { bestAttachmentType }),
    })
  }
  return rows
}

export function searchMetaOf(meta: Record<string, unknown>): SearchMetaView {
  return {
    rows: decodeSearchRows(meta['items']),
    omitted: numberField(meta, 'omitted') ?? null,
  }
}

export function getMetaOf(meta: Record<string, unknown>): GetMetaView {
  let bestAttachment: GetMetaView['bestAttachment'] = null
  const attachment = meta['bestAttachment']
  if (isRecord(attachment)) {
    const contentType = stringField(attachment, 'contentType')
    if (contentType !== undefined) {
      const ref = stringField(attachment, 'ref')
      bestAttachment = { contentType, ...(ref === undefined ? {} : { ref }) }
    }
  }
  return {
    title: stringField(meta, 'title') ?? null,
    creators: stringField(meta, 'creators') ?? null,
    year: numberField(meta, 'year') ?? null,
    venue: stringField(meta, 'venue') ?? null,
    bestAttachment,
  }
}

function decodeSourceAvailability(value: unknown): Record<string, SourceAvailabilityEntry> {
  if (!isRecord(value)) return {}
  const result: Record<string, SourceAvailabilityEntry> = {}
  for (const [source, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    const requested = boolField(entry, 'requested')
    const unavailable = boolField(entry, 'unavailable')
    const returnedPassages = numberField(entry, 'returnedPassages')
    if (requested === undefined || unavailable === undefined || returnedPassages === undefined)
      continue
    result[source] = { requested, returnedPassages, unavailable }
  }
  return result
}

function decodeCoverage(value: unknown): SourceCoverage | null {
  if (!isRecord(value)) return null
  const complete = boolField(value, 'complete')
  if (complete === undefined) return null
  const indexedPages = numberField(value, 'indexedPages')
  const totalPages = numberField(value, 'totalPages')
  const indexedChars = numberField(value, 'indexedChars')
  const totalChars = numberField(value, 'totalChars')
  return {
    complete,
    ...(indexedPages === undefined ? {} : { indexedPages }),
    ...(totalPages === undefined ? {} : { totalPages }),
    ...(indexedChars === undefined ? {} : { indexedChars }),
    ...(totalChars === undefined ? {} : { totalChars }),
  }
}

export function retrieveMetaOf(meta: Record<string, unknown>): RetrieveMetaView {
  const truncated = boolField(meta, 'truncated')
  return {
    items: evidenceItemsOf(meta),
    count: numberField(meta, 'count') ?? null,
    truncated: truncated === undefined ? null : truncated,
    attachmentRef: stringField(meta, 'attachmentRef') ?? null,
    attachmentContentType: stringField(meta, 'attachmentContentType') ?? null,
    coverage: decodeCoverage(meta['coverage']),
    sourceAvailability: decodeSourceAvailability(meta['sourceAvailability']),
  }
}

export function attachmentMetaOf(meta: Record<string, unknown>): AttachmentMetaView {
  const kindValue = stringField(meta, 'kind')
  const kind = kindValue === 'file' || kindValue === 'url' ? kindValue : null
  return {
    kind,
    title: stringField(meta, 'title') ?? null,
    contentType: stringField(meta, 'contentType') ?? null,
    location: kind === null ? null : (stringField(meta, kind === 'file' ? 'path' : 'url') ?? null),
    ref: stringField(meta, 'ref') ?? null,
  }
}

export function exportMetaOf(meta: Record<string, unknown>): ExportMetaView {
  return {
    format: stringField(meta, 'format') ?? null,
    style: stringField(meta, 'style') ?? null,
    locale: stringField(meta, 'locale') ?? null,
    refs: stringArrayOf(meta['refs']),
    refsOmitted: numberField(meta, 'refsOmitted') ?? 0,
    items: exportItemsOf(meta['items']),
  }
}
