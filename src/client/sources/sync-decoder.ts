/**
 * Sources projections for library synchronization and background jobs.
 * @module dsh-zotero/client/sources/sync-decoder
 */

import { isRecord, numberField, stringArrayOf, stringField } from '../../json.ts'
import {
  CHANGE_SECTIONS,
  DELETED_OTHER_TOTAL_KEY,
  DELETION_SECTIONS,
} from '../../changes-contract.ts'
import { detailOmittedOf } from './decoders.ts'

/**
 * One changed-object section of a diff: the keys the read returned, each with
 * its own version, and the true count behind them when the listing was
 * capped. A section the call did not ask for is absent, not empty.
 */
interface ChangesSection {
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
 * `other` is the tool's own bucket for kinds it does not report individually;
 * without it a removal summary would be smaller than the count the tool
 * states, while being presented as authoritative.
 */
interface DeletionsSection {
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
  /** True when the meta budget dropped the detail rows behind these facts. */
  readonly detailOmitted: boolean
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
// its own (the tool counts removals of kinds it does not report individually),
// so it contributes a count and no rows.
function totalOf(totals: Record<string, unknown> | null, key: string): number | null {
  return totals === null ? null : (numberField(totals, key) ?? null)
}

/**
 * The changed keys of one section, each with its own version. A diff's
 * `changed.<kind>` is a bare array, unlike a children listing, which wraps
 * its rows in a counted section, so this reads the array directly.
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
  // `deleted` on a heavy diff while keeping `totals`, so an over-budget diff
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
    // present" is the *normal* shape of a diff carrying a coverage gap, not a
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
    detailOmitted: detailOmittedOf(meta),
  }
}
