/**
 * @module dsh-zotero/normalize-scope
 */

import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asRecord, asString, isObjectKey } from './json.js'

export interface ScopeNameEntry {
  readonly key: string
  readonly name: string
  /** Parent collection key; present only for non-root collections. */
  readonly parentKey?: string
}

export function normalizeScopeEntry(json: unknown): ScopeNameEntry {
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(
      'Zotero returned a scope object without a valid object key.',
      ZOTERO_UNEXPECTED,
    )
  }
  const data = asRecord(record?.data)
  const parent = asString(data?.parentCollection)
  const parentKey = parent !== undefined && isObjectKey(parent) ? parent : undefined
  return {
    key,
    name: asString(data?.name) ?? '',
    ...(parentKey !== undefined ? { parentKey } : {}),
  }
}

export function matchScopeName(
  entries: readonly ScopeNameEntry[],
  wanted: string,
): ScopeNameEntry[] {
  const exact = entries.filter((entry) => entry.name === wanted)
  if (exact.length > 0) return exact
  const wantedLower = wanted.toLowerCase()
  return entries.filter((entry) => entry.name.toLowerCase() === wantedLower)
}

export function nearScopeCandidates(
  entries: readonly ScopeNameEntry[],
  wanted: string,
  limit = 5,
): ScopeNameEntry[] {
  const wantedLower = wanted.toLowerCase()
  return entries
    .filter((entry) => entry.name.toLowerCase().includes(wantedLower))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}
