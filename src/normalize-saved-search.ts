/**
 * @module dsh-zotero/normalize-saved-search
 */

import type { ZoteroSavedSearchCondition } from './types.js'
import { asRecord, asString } from './json.js'

/** Return undefined when any saved-search condition row is malformed. */
export function normalizeSavedSearchConditions(
  value: unknown,
): ZoteroSavedSearchCondition[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ZoteroSavedSearchCondition[] = []
  for (const row of value) {
    const record = asRecord(row)
    const condition = asString(record?.condition)
    const operator = asString(record?.operator)
    const matched = asString(record?.value)
    if (condition === undefined || operator === undefined || matched === undefined) return undefined
    out.push({ condition, operator, value: matched })
  }
  return out
}
