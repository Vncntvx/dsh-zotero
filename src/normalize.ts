/**
 * Forward-tolerant normalization of Zotero Local API JSON into the plugin's
 * domain records. External JSON is a compatibility boundary: unknown fields
 * are ignored, missing optional fields are tolerated, but a broken required
 * invariant (an object key that is not a Zotero key) fails loud — silently
 * returning partially incorrect research metadata is never acceptable.
 * @module dsh-zotero/normalize
 */

import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { formatRef, localRef } from './refs.js'
import type { ZoteroSearchItem } from './types.js'

const OBJECT_KEY_PATTERN = /^[A-Z0-9]{8}$/

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Extract a Zotero object key from an API `links.attachment.href`. */
export function extractAttachmentKey(href: string | undefined): string | undefined {
  if (href === undefined) return undefined
  return /\/items\/([A-Z0-9]{8})(?:[/?#]|$)/.exec(href)?.[1]
}

/**
 * Normalize one item JSON object into a compact search hit.
 * @param json - the raw API object; anything outside the documented shape is ignored.
 * @param serverId - the instance that served the response; recorded as ref provenance.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeSearchItem(json: unknown, serverId?: string): ZoteroSearchItem {
  const record = asRecord(json)
  if (record === undefined) {
    throw new ZoteroError('Zotero returned an item without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const key = asString(record.key)
  if (key === undefined || !OBJECT_KEY_PATTERN.test(key)) {
    throw new ZoteroError('Zotero returned an item without a valid object key.', ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record.data)
  const meta = asRecord(record.meta)
  const attachment = asRecord(asRecord(record.links)?.attachment)
  const attachmentKey = extractAttachmentKey(asString(attachment?.href))
  const parsedDate = asString(meta?.parsedDate)
  // Optional fields are omitted rather than set to undefined, so the record
  // is always a pure lossless-JSON value for the tool output snapshot.
  const item: ZoteroSearchItem = {
    ref: formatRef(localRef('item', key, serverId)),
    title: asString(data?.title) ?? '',
    creatorSummary: asString(meta?.creatorSummary) ?? '',
    itemType: asString(data?.itemType) ?? asString(record.itemType) ?? '',
  }
  if (parsedDate !== undefined && /^\d{4}/.test(parsedDate)) item.year = Number(parsedDate.slice(0, 4))
  if (attachmentKey !== undefined) item.bestAttachmentRef = formatRef(localRef('attachment', attachmentKey, serverId))
  const bestAttachmentType = asString(attachment?.attachmentType)
  if (bestAttachmentType !== undefined) item.bestAttachmentType = bestAttachmentType
  if (typeof attachment?.attachmentSize === 'number') item.attachmentSize = attachment.attachmentSize
  return item
}

/**
 * Normalize one collection or saved-search JSON object into its identity pair.
 * @throws {ZoteroError} `ZOTERO_UNEXPECTED` when the object has no valid Zotero key.
 */
export function normalizeScopeEntry(json: unknown): { key: string; name: string } {
  const record = asRecord(json)
  const key = asString(record?.key)
  if (key === undefined || !OBJECT_KEY_PATTERN.test(key)) {
    throw new ZoteroError('Zotero returned a scope object without a valid object key.', ZOTERO_UNEXPECTED)
  }
  return { key, name: asString(asRecord(record?.data)?.name) ?? '' }
}

export interface ScopeNameEntry {
  readonly key: string
  readonly name: string
}

/**
 * Match a wanted name against scope entries: an exact Unicode match wins;
 * otherwise every case-insensitive match is returned (possibly none).
 */
export function matchScopeName(entries: readonly ScopeNameEntry[], wanted: string): { exact: boolean; matched: ScopeNameEntry[] } {
  const exact = entries.filter((entry) => entry.name === wanted)
  if (exact.length > 0) return { exact: true, matched: exact }
  const wantedLower = wanted.toLowerCase()
  return { exact: false, matched: entries.filter((entry) => entry.name.toLowerCase() === wantedLower) }
}

/**
 * Near-match candidates for diagnostics: case-insensitive substring matches,
 * shortest names first, capped at `limit`.
 */
export function nearScopeCandidates(entries: readonly ScopeNameEntry[], wanted: string, limit = 5): ScopeNameEntry[] {
  const wantedLower = wanted.toLowerCase()
  return entries
    .filter((entry) => entry.name.toLowerCase().includes(wantedLower))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
}
