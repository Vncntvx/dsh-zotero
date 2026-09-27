/**
 * The meta decoding layer of the session source model: each tool's
 * presentation projection read off a settled block. The shapes are the
 * current wire shapes (no legacy projection versions are carried — session
 * logs are per-session snapshots); reads are defensive, so an absent or
 * malformed field degrades to nothing instead of crashing the panel. Only
 * the fields the panel renders are decoded.
 * @module dsh-zotero/client/sources/decoders
 */

import { evidenceItemsOf } from '../presenters.ts'
import { boolField, isRecord, numberField, stringField } from '../../json.ts'
import type { EvidenceItem } from '../../evidence-item.ts'
import { stringArrayOf } from '../../json.ts'
import { browseRowOf, isBrowseKind, type BrowseRow } from '../../browse-rows.ts'
import {
  CHANGE_SECTIONS,
  DELETED_OTHER_TOTAL_KEY,
  DELETION_SECTIONS,
} from '../../changes-contract.ts'
import type {
  ExportDocumentItem,
  SourceAvailabilityEntry,
  SourceCoverage,
  SupportedLocalLibrary,
} from './model.ts'
import type { ZoteroResolvedScope } from '../../types.ts'

/** One decoded search row (with Zotero's attachment selection when present). */
interface SearchRowMeta {
  readonly ref: string
  readonly title: string
  readonly creatorSummary: string
  readonly year?: number
  /** The item's own Zotero type, e.g. `journalArticle` — what the row is, not just its title. */
  readonly itemType?: string
  readonly bestAttachmentRef?: string
  readonly bestAttachmentType?: string
}

/** The search projection view; `rows === null` means malformed. */
export interface SearchMetaView {
  readonly rows: readonly SearchRowMeta[] | null
  /** Hits the call actually returned, including the note-body matches folded into the first page. */
  readonly returned: number | null
  /** The whole hit count the scope carries, past the returned page. */
  readonly total: number | null
  readonly omitted: number | null
  readonly scope: ZoteroResolvedScope | null
  readonly library: SupportedLocalLibrary | null
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
export interface GetMetaView {
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
export interface RetrieveMetaView {
  readonly items: readonly EvidenceItem[] | null
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

/**
 * The browse projection view. `returned`/`total`/`nextOffset` are the page
 * facts the summary and the pagination note read; they are never among the
 * keys the byte budget drops, so a summary stays exact even on a page too
 * heavy to itemize. `rows` is null exactly when the rows are unavailable —
 * an over-budget projection, an absent meta, or a malformed `items`.
 */
export interface BrowseMetaView {
  readonly kind: string | null
  readonly returned: number | null
  readonly total: number | null
  readonly nextOffset: number | null
  readonly rows: readonly BrowseRow[] | null
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
  }
}

/**
 * The write projection view, decoded once for every reader. `kind` is the
 * only field the shared row needs, so the arms below carry just the fact their
 * tool is the only one that can report:
 *
 * - `declined` — the plan card was answered without approval; nothing written.
 * - `committed-unverified` — the write landed but its saved state was never
 *   proven, and the tool's own answer says not to retry.
 * - `applied` — the write reported its applied fact, and that fact is null on
 *   whichever tool (or malformed record) left it unreported.
 *
 * The unverified arm's `reason` and `key` are deliberately not decoded here:
 * the receipt shows the tool's own sentence, which already names both, and a
 * second copy of that wording is a second thing to keep in step.
 */
export interface WriteMetaView {
  readonly kind: 'declined' | 'applied' | 'committed-unverified'
  /** Tags actually added by `zotero_add_tags`; null on every other tool. */
  readonly addedCount: number | null
  /** Whether `zotero_add_to_collection` added the membership; null elsewhere. */
  readonly added: boolean | null
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
  if (kind === 'library' || kind === 'publications') {
    const lib = decodeSupportedLibrary(value['library'])
    if (lib === null) return null
    // Split the personal/group arms so each matches its wire-contract shape.
    if (lib.type === 'user') {
      return kind === 'library'
        ? { kind: 'library', library: { type: 'user', id: 0 } }
        : { kind: 'publications', library: { type: 'user', id: 0 } }
    }
    return kind === 'library'
      ? { kind: 'library', library: { type: 'group', id: lib.id } }
      : { kind: 'publications', library: { type: 'group', id: lib.id } }
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
    scope: decodeResolvedScope(meta['scope']),
    library: decodeSupportedLibrary(meta['library']),
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
export interface ChildrenMetaView {
  readonly itemType: string | null
  readonly sections: readonly ChildSection[]
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
  return { itemType: stringField(meta, 'itemType') ?? null, sections }
}

/**
 * One changed-object section of a diff: the keys the read returned, each with
 * its own version, and the true count behind them when the listing was
 * capped. A section the call did not ask for is absent, not empty.
 */
export interface ChangesSection {
  readonly key: string
  readonly label:
    | 'toolChangesItems'
    | 'toolChangesChildItems'
    | 'toolChangesTrashedItems'
    | 'toolChangesCollections'
    | 'toolChangesSavedSearches'
    | 'toolChangesFulltext'
  readonly total: number | null
  readonly entries: readonly { readonly key: string; readonly version: number }[]
}

/**
 * One tombstoned-object section: the keys removed, and the true count behind them.
 * `other` is the tool's own bucket for kinds it does not report individually —
 * without it a removal summary would be smaller than the count the tool
 * states, while being presented as authoritative.
 */
export interface DeletionsSection {
  readonly key: string
  readonly label:
    | 'toolDeletedItems'
    | 'toolDeletedCollections'
    | 'toolDeletedSavedSearches'
    | 'toolDeletedTags'
    | 'toolDeletedOther'
  readonly total: number | null
  readonly keys: readonly string[]
}

/** The diff projection view. */
export interface ChangesMetaView {
  readonly fromVersion: number | null
  /** The cursor this diff is safe to resume from; null when it withholds one. */
  readonly cursor: { readonly version: number; readonly serverId: string } | null
  /**
   * Why the diff withholds a cursor. A diff with no cursor is not a diff that
   * found nothing, and the tool spells out each reason in its own words; these
   * are the machine-readable forms of those sentences.
   */
  readonly withheld: readonly ChangesWithheldReason[] | null
  /**
   * Objects that changed, across every requested kind. Removals are counted
   * separately: a deletion is not a change, and a summary that added the two
   * together reported more changes than the library had.
   */
  readonly changedTotal: number | null
  readonly changed: readonly ChangesSection[]
  readonly deletedTotal: number | null
  readonly deleted: readonly DeletionsSection[]
}

/** One kind this diff could not cover, and the reason it could not. */
export interface ChangesWithheldReason {
  readonly kind: string
  readonly reason: 'not-served' | 'range-not-covered' | 'unreadable'
}

const CHANGE_WITHHELD_REASONS = new Set(['not-served', 'range-not-covered', 'unreadable'])

/**
 * The kinds this diff could not cover. `null` when the projection named none,
 * which is the ordinary case; an empty array never happens, because the tool
 * only emits the list when it has something in it.
 */
function withheldOf(value: unknown): ChangesWithheldReason[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const withheld: ChangesWithheldReason[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const kind = stringField(entry, 'kind')
    const reason = stringField(entry, 'reason')
    if (kind === undefined || reason === undefined) continue
    if (!CHANGE_WITHHELD_REASONS.has(reason)) continue
    withheld.push({ kind, reason: reason as ChangesWithheldReason['reason'] })
  }
  return withheld.length === 0 ? null : withheld
}

// A changed kind's `totals` entry is spelled exactly as its `changed.<kind>`,
// so the tables carry one key; a tombstone family prefixes it with `deleted`,
// which is the one place a second name is needed. `other` has no listing of
// its own — the tool counts removals of kinds it does not report individually —
// so it contributes a count and no rows.
function totalOf(totals: Record<string, unknown> | null, key: string): number | null {
  return totals === null ? null : (numberField(totals, key) ?? null)
}

/**
 * The changed keys of one section, each with its own version. A diff's
 * `changed.<kind>` is a bare array — unlike a children listing, which wraps
 * its rows in a counted section — so this reads the array directly.
 */
function changedEntriesOf(value: unknown): ChangesSection['entries'] {
  if (!Array.isArray(value)) return []
  const entries: { key: string; version: number }[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const key = stringField(entry, 'key')
    const version = numberField(entry, 'version')
    if (key === undefined || version === undefined) continue
    entries.push({ key, version })
  }
  return entries
}

/**
 * A long call handed to a background job instead of running inline. Both
 * `zotero_export` and `zotero_changes` can take this arm, so it is read once
 * here: the job id is the one value a user needs to collect the result, and a
 * card that rendered its diff shape instead would show an empty page and
 * report no changes.
 */
export interface JobArmView {
  readonly kind: 'background' | 'promoted'
  readonly jobId: string
}

/** The background-job arm of a settled call, or null when it ran inline. */
export function jobArmOf(meta: Record<string, unknown>): JobArmView | null {
  const kind = stringField(meta, 'kind')
  if (kind !== 'background' && kind !== 'promoted') return null
  const jobId = stringField(meta, 'jobId')
  if (jobId === undefined) return null
  return { kind, jobId }
}

/** Locale key for a job arm's collapsed summary; shared by export and changes cards. */
export function jobSummaryKeyOf(
  job: JobArmView,
): 'toolSummaryJobBackground' | 'toolSummaryJobPromoted' {
  return job.kind === 'background' ? 'toolSummaryJobBackground' : 'toolSummaryJobPromoted'
}

export function changesMetaOf(meta: Record<string, unknown>): ChangesMetaView {
  const totals = isRecord(meta['totals']) ? meta['totals'] : null
  const changedRecord = isRecord(meta['changed']) ? meta['changed'] : null
  const deletedRecord = isRecord(meta['deleted']) ? meta['deleted'] : null
  const cursorRecord = isRecord(meta['cursor']) ? meta['cursor'] : null

  const changed: ChangesSection[] = []
  for (const { key, label } of CHANGE_SECTIONS) {
    const section = changedRecord?.[key]
    if (section === undefined) continue
    changed.push({
      key,
      label,
      total: totalOf(totals, key),
      entries: changedEntriesOf(section),
    })
  }

  const deleted: DeletionsSection[] = []
  for (const { key, label, totalKey } of DELETION_SECTIONS) {
    const section = deletedRecord?.[key]
    if (section === undefined) continue
    deleted.push({
      key,
      label,
      total: totalOf(totals, totalKey),
      // `deleted.<kind>` is a bare string array.
      keys: stringArrayOf(section),
    })
  }
  // Removals of kinds this tool does not report individually still happened,
  // and the tool counts them; a removal summary that omitted them would be
  // smaller than the count beside it.
  const otherTotal = totalOf(totals, DELETED_OTHER_TOTAL_KEY)
  if (otherTotal !== null && otherTotal > 0) {
    deleted.push({ key: 'other', label: 'toolDeletedOther', total: otherTotal, keys: [] })
  }

  // A section's true count comes from `totals`; without it, the listing is all
  // there is and the count is the listing's own size. The two are summed
  // independently of the listings, because the byte budget drops `changed` and
  // `deleted` on a heavy diff while keeping `totals` — an over-budget diff
  // still reports exactly how much changed.
  const sumSections = (
    sections: readonly { total: number | null; size: number }[],
  ): number | null => {
    if (sections.length === 0) return null
    const sum = sections.reduce((acc, section) => acc + (section.total ?? section.size), 0)
    return sum === 0 ? null : sum
  }
  const sumTotals = (totalKeys: readonly string[]): number | null => {
    if (totals === null) return null
    const sum = totalKeys.reduce((acc, key) => acc + (numberField(totals, key) ?? 0), 0)
    return sum === 0 ? null : sum
  }
  const changedTotalKeys = CHANGE_SECTIONS.map((section) => section.key)
  const deletedTotalKeys = [
    ...DELETION_SECTIONS.map((section) => section.totalKey),
    DELETED_OTHER_TOTAL_KEY,
  ]

  const cursorVersion =
    cursorRecord === null ? null : (numberField(cursorRecord, 'version') ?? null)
  const cursorServerId =
    cursorRecord === null ? null : (stringField(cursorRecord, 'serverId') ?? null)

  return {
    fromVersion: numberField(meta, 'fromVersion') ?? null,
    cursor:
      cursorVersion !== null && cursorServerId !== null
        ? { version: cursorVersion, serverId: cursorServerId }
        : null,
    // Decoded unconditionally, and the cursor has nothing to do with it: for a
    // standalone resource, `not-served` and `range-not-covered` deliberately keep
    // the cursor (those changes were never observable in any range), so "cursor
    // present" is the *normal* shape of a diff carrying a coverage gap — not a
    // sign the gap went away. Only `unreadable` withholds the cursor, and that
    // fact is the card's separate no-cursor notice.
    withheld: withheldOf(meta['unobservable']),
    changedTotal:
      sumTotals(changedTotalKeys) ??
      sumSections(
        changed.map((section) => ({ total: section.total, size: section.entries.length })),
      ),
    changed,
    deletedTotal:
      sumTotals(deletedTotalKeys) ??
      sumSections(deleted.map((section) => ({ total: section.total, size: section.keys.length }))),
    deleted,
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

const WRITE_KINDS = new Set(['declined', 'applied', 'committed-unverified'])

function writeKindOf(value: unknown): WriteMetaView['kind'] {
  return typeof value === 'string' && WRITE_KINDS.has(value)
    ? (value as WriteMetaView['kind'])
    : 'applied'
}

/**
 * The three write projections decoded from one record. An unrecognized `kind`
 * reads as `applied` with every applied field null: the write may or may not
 * have landed, and the receipt must not claim a count it cannot prove — the
 * tool's own rendered text carries the full statement either way.
 */
export function writeMetaOf(meta: Record<string, unknown>): WriteMetaView {
  return {
    kind: writeKindOf(meta['kind']),
    addedCount: numberField(meta, 'addedCount') ?? null,
    added: boolField(meta, 'added') ?? null,
  }
}
