/**
 * Normalize Local API rows into compact search records and shared item facts.
 * @module dsh-zotero/normalize-search
 */

import { extractAttachmentKey } from './attachments.js'
import { DEFAULT_CREATOR_TYPE } from './creators.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from './errors.js'
import { asRecord, asString, isObjectKey, stringArrayOf } from './json.js'
import { refStringFor } from './refs.js'
import {
  ITEM_WITHOUT_KEY_MESSAGE,
  parentKeyOf,
  plainNoteText,
  resolveNormalizeContext,
  type NormalizeContext,
} from './normalize-context.js'
import type { ZoteroCreator, ZoteroSearchItem } from './types.js'

/** The publication year of a parsed date string (`YYYY-…`), or undefined. */
export function parsedYearOf(parsedDate: string | undefined): number | undefined {
  return parsedDate !== undefined && /^\d{4}/.test(parsedDate)
    ? Number(parsedDate.slice(0, 4))
    : undefined
}

export function normalizeSearchItem(json: unknown, context?: NormalizeContext): ZoteroSearchItem {
  const resolved = resolveNormalizeContext(context)
  const record = asRecord(json)
  if (record === undefined) throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED)
  const key = asString(record.key)
  if (key === undefined || !isObjectKey(key)) {
    throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record.data)
  const meta = asRecord(record.meta)
  const attachment = asRecord(asRecord(record.links)?.attachment)
  const attachmentKey = extractAttachmentKey(asString(attachment?.href))
  const itemType = asString(data?.itemType) ?? asString(record.itemType) ?? ''
  let title = asString(data?.title) ?? ''
  if (itemType === 'note' && title === '') {
    title =
      plainNoteText(data?.note)
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '') ?? '(untitled note)'
  }
  const item: ZoteroSearchItem = {
    ref: refStringFor(resolved.library, 'item', key, resolved.serverId),
    title,
    creatorSummary: asString(meta?.creatorSummary) ?? '',
    itemType,
  }
  const year = parsedYearOf(asString(meta?.parsedDate))
  if (year !== undefined) item.year = year
  const parentKey = parentKeyOf(data)
  if (parentKey !== undefined)
    item.parentRef = refStringFor(resolved.library, 'item', parentKey, resolved.serverId)
  if (attachmentKey !== undefined) {
    item.bestAttachmentRef = refStringFor(
      resolved.library,
      'attachment',
      attachmentKey,
      resolved.serverId,
    )
  }
  const bestAttachmentType = asString(attachment?.attachmentType)
  if (bestAttachmentType !== undefined) item.bestAttachmentType = bestAttachmentType
  if (typeof attachment?.attachmentSize === 'number')
    item.attachmentSize = attachment.attachmentSize
  const extra = asString(data?.extra)?.trim()
  if (extra !== undefined && extra !== '') item.extra = extra
  const doi = asString(data?.DOI)?.trim()
  if (doi !== undefined && doi !== '') item.doi = doi
  return item
}

export function normalizeCreators(data: Record<string, unknown> | undefined): ZoteroCreator[] {
  const creators = Array.isArray(data?.creators) ? data.creators : []
  const normalized: ZoteroCreator[] = []
  for (const raw of creators) {
    const creator = asRecord(raw)
    if (creator === undefined) continue
    const creatorType = asString(creator.creatorType) ?? DEFAULT_CREATOR_TYPE
    const name = asString(creator.name)?.trim() || undefined
    if (name !== undefined) {
      normalized.push({ creatorType, name })
      continue
    }
    const firstName = asString(creator.firstName)?.trim() || undefined
    const lastName = asString(creator.lastName)?.trim() || undefined
    if (firstName !== undefined || lastName !== undefined) {
      normalized.push({
        creatorType,
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
      })
    }
  }
  return normalized
}

export function citekeyOf(extra?: string): string | undefined {
  if (!extra) return undefined
  const value = /(?<![A-Za-z0-9_])(?:Citation Key|citekey):\s*([^\r\n\s,]+)/i.exec(extra)?.[1]
  return value !== undefined && value !== '' ? value : undefined
}

export function normalizeVenue(data: Record<string, unknown> | undefined): string | undefined {
  for (const field of [
    'publicationTitle',
    'proceedingsTitle',
    'bookTitle',
    'journalAbbreviation',
    'conferenceName',
  ]) {
    const value = asString(data?.[field])
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

export function collectionKeysOf(json: unknown): string[] {
  return stringArrayOf(asRecord(asRecord(json)?.data)?.collections)
}
