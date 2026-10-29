/**
 * The meta decoding layer of the session source model for the search, get,
 * children, retrieve, attachment, and browse projections: each tool's
 * presentation projection read off a settled block. Export, write, and sync
 * (changes/job) projections own their decoders in `export-decoder.ts`,
 * `write-decoder.ts`, and `sync-decoder.ts`. The shapes are the
 * current wire shapes (session logs are per-session snapshots, so no legacy
 * projection versions are carried); reads are defensive, so an absent or
 * malformed field degrades to nothing instead of crashing the panel. Only
 * the fields the panel renders are decoded.
 * @module dsh-zotero/client/sources/decoders
 */

import { evidenceItemsOf } from '../presenters.ts'
import { boolField, isRecord, numberField, stringField } from '../../json.ts'
import type { EvidenceItem } from '../../evidence-item.ts'
import { browseRowOf, isBrowseKind, type BrowseRow } from '../../browse-rows.ts'
import type { SourceAvailabilityEntry, SourceCoverage, SupportedLocalLibrary } from './model.ts'
import type { ZoteroResolvedScope } from '../../contract.ts'

/** One decoded search row (with Zotero's attachment selection when present). */
interface SearchRowMeta {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  /** The item's own Zotero type, e.g. `journalArticle`. */
  readonly itemType?: string
  readonly bestAttachmentRef?: string
  readonly bestAttachmentType?: string
}

/**
 * Whether the host's 8 KiB meta budget dropped this projection's detail keys:
 * the summary facts stay (counts, totals) and `detailOmitted` stamps the cut,
 * so a card can say "details were omitted" instead of showing fewer rows with
 * no reason. See `presentation-meta.ts` (`boundedPresentationMeta`).
 */
export function detailOmittedOf(meta: Record<string, unknown>): boolean {
  return boolField(meta, 'detailOmitted') === true
}

/** The search projection view; `rows === null` means malformed. */
interface SearchMetaView {
  readonly rows: readonly SearchRowMeta[] | null
  /** Hits the paged primary listing returned; the note-body supplement is counted separately. */
  readonly returned: number | null
  /** The whole hit count the scope carries, past the returned page. */
  readonly total: number | null
  readonly omitted: number | null
  /**
   * Note-body matches folded into the first page. `null` means the call made
   * no note scan at all (the producer's `supplemental` is absent), which is
   * distinct from `0`, the scan ran and found nothing.
   */
  readonly noteMatches: number | null
  readonly scope: ZoteroResolvedScope | null
  readonly library: SupportedLocalLibrary | null
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

/** One child collection's own page facts: how many exist, how many came back. */
export interface ChildCountView {
  readonly total: number
  readonly returned: number
}

/** One bounded child preview: a note or annotation the projection kept. */
export interface ChildPreviewView {
  readonly ref: string
  readonly preview: string
  readonly pageLabel: string | null
  /** The note's parent item, or an annotation's own PDF attachment. */
  readonly parentRef: string | null
}

/** The get projection view; a null field is absent or malformed. */
interface GetMetaView {
  readonly title: string | null
  readonly creators: string | null
  readonly year: number | null
  readonly venue: string | null
  readonly bestAttachment: { readonly ref?: string; readonly contentType: string } | null
  /** Per-kind child counts; a key is absent when the call did not ask for it. */
  readonly notes: ChildCountView | null
  readonly annotations: ChildCountView | null
  readonly attachments: ChildCountView | null
  readonly notesPreview: readonly ChildPreviewView[]
  readonly annotationsPreview: readonly ChildPreviewView[]
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

/**
 * One `{total, returned}` pair, or null when the projection carried neither.
 * A record that states a total but not a `returned` reads as everything came
 * back: that is the only reading a partial record supports, and a section
 * dropped over a missing count would hide a fact the projection did state.
 */
function childCountOf(value: unknown): ChildCountView | null {
  if (!isRecord(value)) return null
  const total = numberField(value, 'total')
  if (total === undefined) return null
  return { total, returned: numberField(value, 'returned') ?? total }
}

/**
 * The bounded child previews the projection kept. A row without its ref or
 * preview text is dropped rather than rendered half: the panel reads the
 * complete data from the canonical result, and a card row that names nothing
 * is noise.
 */
function childPreviewsOf(value: unknown): ChildPreviewView[] {
  if (!Array.isArray(value)) return []
  const rows: ChildPreviewView[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const ref = stringField(entry, 'ref')
    const preview = stringField(entry, 'preview')
    if (ref === undefined || preview === undefined) continue
    const pageLabel = stringField(entry, 'pageLabel')
    const parentRef = stringField(entry, 'parentRef')
    rows.push({
      ref,
      preview,
      pageLabel: pageLabel ?? null,
      parentRef: parentRef ?? null,
    })
  }
  return rows
}

/** The retrieve projection view; `items === null` means malformed. */
interface RetrieveMetaView {
  readonly items: readonly EvidenceItem[] | null
  readonly count: number | null
  readonly truncated: boolean | null
  readonly attachmentRef: string | null
  readonly attachmentContentType: string | null
  readonly coverage: SourceCoverage | null
  readonly sourceAvailability: Readonly<Record<string, SourceAvailabilityEntry>>
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

/** The attachment projection view; a null field is absent or malformed. */
interface AttachmentMetaView {
  readonly kind: 'file' | 'url' | null
  readonly title: string | null
  readonly contentType: string | null
  readonly location: string | null
  readonly ref: string | null
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

/**
 * The browse projection view. `returned`/`total`/`nextOffset` are the page
 * facts the summary and the pagination note read; they are never among the
 * keys the byte budget drops, so a summary stays exact even on a page too
 * heavy to itemize. `rows` is null exactly when the rows are unavailable:
 * an over-budget projection, an absent meta, or a malformed `items`.
 */
interface BrowseMetaView {
  readonly kind: string | null
  readonly returned: number | null
  readonly total: number | null
  readonly nextOffset: number | null
  readonly rows: readonly BrowseRow[] | null
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

export function browseMetaOf(meta: Record<string, unknown>): BrowseMetaView {
  const kind = stringField(meta, 'kind')
  const items = meta['items']
  const rows = Array.isArray(items) ? items.map((item) => browseRowOf(item)) : null
  const nextOffset = numberField(meta, 'nextOffset')
  return {
    kind: isBrowseKind(kind) ? kind : null,
    returned: numberField(meta, 'returned') ?? null,
    total: numberField(meta, 'total') ?? null,
    nextOffset: nextOffset ?? null,
    rows,
    detailOmitted: detailOmittedOf(meta),
  }
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
    const itemType = stringField(item, 'itemType')
    const bestAttachmentRef = stringField(item, 'bestAttachmentRef')
    const bestAttachmentType = stringField(item, 'bestAttachmentType')
    rows.push({
      ref,
      title,
      creatorSummary,
      ...(year === undefined ? {} : { year }),
      ...(itemType === undefined ? {} : { itemType }),
      ...(bestAttachmentRef === undefined ? {} : { bestAttachmentRef }),
      ...(bestAttachmentType === undefined ? {} : { bestAttachmentType }),
    })
  }
  return rows
}

function decodeSupportedLibrary(value: unknown): SupportedLocalLibrary | null {
  if (!isRecord(value)) return null
  const type = stringField(value, 'type')
  const id = numberField(value, 'id')
  if (type === 'user' && id === 0) return { type: 'user', id: 0 }
  // isSafeInteger: an over-long group id loses precision in transit, so an
  // unsafe integer never names its digits.
  if (type === 'group' && id !== undefined && Number.isSafeInteger(id) && id > 0) {
    return { type: 'group', id }
  }
  return null
}

function decodeResolvedScope(value: unknown): ZoteroResolvedScope | null {
  if (!isRecord(value)) return null
  const kind = stringField(value, 'kind')
  if (kind === 'library') {
    const lib = decodeSupportedLibrary(value['library'])
    if (lib === null) return null
    return { kind: 'library', library: lib } as ZoteroResolvedScope
  }
  if (kind === 'publications') {
    const lib = decodeSupportedLibrary(value['library'])
    if (lib === null || lib.type !== 'user') return null
    return { kind: 'publications', library: lib }
  }
  if (kind === 'collection' || kind === 'savedSearch') {
    const ref = stringField(value, 'ref')
    const name = stringField(value, 'name')
    if (ref === undefined || name === undefined) return null
    return kind === 'collection'
      ? { kind: 'collection', ref, name }
      : { kind: 'savedSearch', ref, name }
  }
  return null
}

export function searchMetaOf(meta: Record<string, unknown>): SearchMetaView {
  return {
    rows: decodeSearchRows(meta['items']),
    returned: numberField(meta, 'returned') ?? null,
    total: numberField(meta, 'total') ?? null,
    omitted: numberField(meta, 'omitted') ?? null,
    noteMatches: numberField(meta, 'noteMatches') ?? null,
    scope: decodeResolvedScope(meta['scope']),
    library: decodeSupportedLibrary(meta['library']),
    detailOmitted: detailOmittedOf(meta),
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
    notes: childCountOf(meta['notes']),
    annotations: childCountOf(meta['annotations']),
    attachments: childCountOf(meta['attachments']),
    notesPreview: childPreviewsOf(meta['notesPreview']),
    annotationsPreview: childPreviewsOf(meta['annotationsPreview']),
    detailOmitted: detailOmittedOf(meta),
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

/** One child row of a `zotero_children` listing, in the kind's own shape. */
export type ChildRow =
  | { readonly kind: 'note'; readonly ref: string; readonly text: string }
  | {
      readonly kind: 'attachment'
      readonly ref: string
      readonly title: string
      readonly contentType: string
    }
  | {
      readonly kind: 'annotation'
      readonly ref: string
      readonly type: string
      readonly text: string
      /** Zotero's own annotation colour, e.g. `#ffd400`. */
      readonly color: string | null
      readonly pageLabel: string | null
      readonly parentRef: string | null
    }

/** One child kind's section of a children listing. */
export interface ChildSection {
  readonly kind: ChildRow['kind']
  readonly total: number
  /** How many rows the projection returned, before this decoder drops malformed ones. */
  readonly returned: number
  /** The rows a card can actually draw; the count beside a section must be this. */
  readonly shown: number
  readonly rows: readonly ChildRow[]
}

/**
 * The children projection view. `sections` lists only the kinds the call
 * returned: a kind it did not ask for is absent, which is a different fact
 * from "that kind has no children".
 */
interface ChildrenMetaView {
  readonly itemType: string | null
  readonly sections: readonly ChildSection[]
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
}

const CHILD_SECTIONS = [
  { key: 'notes', kind: 'note' },
  { key: 'attachments', kind: 'attachment' },
  { key: 'annotations', kind: 'annotation' },
] as const satisfies readonly { readonly key: string; readonly kind: ChildRow['kind'] }[]

function childRowOf(kind: ChildRow['kind'], value: unknown): ChildRow | null {
  if (!isRecord(value)) return null
  const ref = stringField(value, 'ref')
  if (ref === undefined) return null
  if (kind === 'note') {
    const text = stringField(value, 'text')
    return text === undefined ? null : { kind, ref, text }
  }
  if (kind === 'attachment') {
    const title = stringField(value, 'title')
    const contentType = stringField(value, 'contentType')
    if (title === undefined || contentType === undefined) return null
    return { kind, ref, title, contentType }
  }
  const type = stringField(value, 'type')
  const text = stringField(value, 'text')
  if (type === undefined || text === undefined) return null
  const color = stringField(value, 'color')
  const pageLabel = stringField(value, 'pageLabel')
  const parentRef = stringField(value, 'parentRef')
  return {
    kind,
    ref,
    type,
    text,
    color: color === undefined || color === '' ? null : color,
    pageLabel: pageLabel ?? null,
    parentRef: parentRef ?? null,
  }
}

export function childrenMetaOf(meta: Record<string, unknown>): ChildrenMetaView {
  const sections: ChildSection[] = []
  for (const { key, kind } of CHILD_SECTIONS) {
    const count = childCountOf(meta[key])
    if (count === null) continue
    const items = isRecord(meta[key]) ? meta[key]['items'] : undefined
    const rows = Array.isArray(items)
      ? items.map((item) => childRowOf(kind, item)).filter((row): row is ChildRow => row !== null)
      : []
    sections.push({ kind, total: count.total, returned: count.returned, shown: rows.length, rows })
  }
  return {
    itemType: stringField(meta, 'itemType') ?? null,
    sections,
    detailOmitted: detailOmittedOf(meta),
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
    detailOmitted: detailOmittedOf(meta),
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
    detailOmitted: detailOmittedOf(meta),
  }
}
