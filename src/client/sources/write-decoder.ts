/**
 * @module dsh-zotero/client/sources/write-decoder
 */

import { numberField } from '../../json.ts'

/**
 * The write projection view, decoded once for every reader. `kind` is the
 * only field the shared row needs, so the arms below carry the counts a tool
 * reported beside it:
 *
 * - `declined`: the plan card was answered without approval; nothing written.
 * - `committed-unverified`: the write landed but its saved state was never
 *   proven, and the tool's own answer says not to retry.
 * - `applied`: the write reported its applied fact, and counts are null on
 *   whichever tool (or malformed record) left them unreported.
 * - `deleted`: the delete reported its receipt; the count is null when
 *   unreported.
 * - `restored`: the restore reported per-item outcomes; both counts are null
 *   when the record carried neither.
 *
 * The unverified arm's `reason` and `key` are deliberately not decoded here:
 * the receipt shows the tool's own sentence, which already names both, and a
 * second copy of that wording is a second thing to keep in step.
 */
const WRITE_KINDS = ['declined', 'applied', 'deleted', 'committed-unverified', 'restored'] as const

type WriteKind = (typeof WRITE_KINDS)[number]

export interface WriteMetaView {
  readonly kind: WriteKind
  readonly restoredCount: number | null
  readonly failedCount: number | null
  /** Tags/collections actually added; null on every other tool. */
  readonly addedCount: number | null
  /** Tags/collections actually removed; null on every other tool. */
  readonly removedCount: number | null
  /** Tags deleted library-wide; null on every other tool. */
  readonly deletedCount: number | null
}

function writeKindOf(value: unknown): WriteKind {
  return WRITE_KINDS.find((kind) => kind === value) ?? 'applied'
}

/**
 * The write projections decoded from one record. An unrecognized `kind`
 * reads as `applied` with every applied field null: the write may or may not
 * have landed, and the receipt must not claim a count it cannot prove, while
 * the tool's own rendered text carries the full statement either way.
 */
export function writeMetaOf(meta: Record<string, unknown>): WriteMetaView {
  return {
    kind: writeKindOf(meta['kind']),
    restoredCount: numberField(meta, 'restoredCount') ?? null,
    failedCount: numberField(meta, 'failedCount') ?? null,
    addedCount: numberField(meta, 'addedCount') ?? null,
    removedCount: numberField(meta, 'removedCount') ?? null,
    deletedCount: numberField(meta, 'deletedCount') ?? null,
  }
}
