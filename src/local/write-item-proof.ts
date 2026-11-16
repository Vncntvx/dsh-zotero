/** Prove the identity, duplicated version and item type before a write uses a read. */
import { asRecord, asString, isNonNegativeSafeInteger } from '../json.js'
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js'

export function proveItemRead(
  json: unknown,
  key: string,
  messages: {
    readonly version: string
    readonly identity: string
    readonly itemType: string
  },
): { data: Record<string, unknown>; version: number; itemType: string } {
  const record = asRecord(json)
  const version = record?.version
  if (!isNonNegativeSafeInteger(version)) throw new ZoteroError(messages.version, ZOTERO_UNEXPECTED)
  const data = asRecord(record?.data)
  if (record?.key !== key || data?.key !== key || data.version !== version)
    throw new ZoteroError(messages.identity, ZOTERO_UNEXPECTED)
  const itemType = asString(data.itemType)
  if (itemType === undefined || itemType === '')
    throw new ZoteroError(messages.itemType, ZOTERO_UNEXPECTED)
  return { data, version, itemType }
}
