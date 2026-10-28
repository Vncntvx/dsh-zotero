/**
 * The write form's saved-search condition draft: trim, drop all-empty rows,
 * and refuse rows that were only partly filled, so a blank "Add condition"
 * row can never fail the whole submission at the wire.
 * @module dsh-zotero/client/components/library/write-draft
 */

/** One condition row as the form edits it. */
export interface ConditionDraftRow {
  readonly condition: string
  readonly operator: string
  readonly value: string
}

/** The draft's verdict. */
export type ConditionsDraft =
  { kind: 'ok'; conditions: ConditionDraftRow[] } | { kind: 'empty' } | { kind: 'invalid' }

/** Trim, drop all-empty rows, and classify what remains. */
export function savedSearchConditionsOf(rows: readonly ConditionDraftRow[]): ConditionsDraft {
  const trimmed = rows.map((row) => ({
    condition: row.condition.trim(),
    operator: row.operator.trim(),
    value: row.value.trim(),
  }))
  const kept = trimmed.filter(
    (row) => row.condition !== '' || row.operator !== '' || row.value !== '',
  )
  if (kept.length === 0) return { kind: 'empty' }
  if (kept.some((row) => row.condition === '' || row.operator === '' || row.value === '')) {
    return { kind: 'invalid' }
  }
  return { kind: 'ok', conditions: kept }
}
