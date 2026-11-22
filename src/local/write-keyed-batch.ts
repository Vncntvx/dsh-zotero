/** Native keyed POST updates prove each object's identity and committed fields. */
import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'
import {
  ZoteroError,
  ZOTERO_UNEXPECTED,
  ZoteroWriteCommitUnknownError,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_NOT_FOUND,
  ZOTERO_INVALID_ARGUMENT,
} from '../errors.js'
import { asRecord, isNonNegativeSafeInteger } from '../json.js'
import type { WriteDomainDeps } from './write-deps.js'
import { withWriteKey } from './write-domain.js'
import { submittedFieldsMatch } from './write-content-proof.js'
import { isWriteReceiptIndex } from './write-verdicts.js'

export interface KeyedItemUpdate {
  readonly key: string
  readonly version: number
  readonly fields: Readonly<Record<string, unknown>>
}
type KeyedItemVerdict =
  | {
      readonly kind: 'applied'
      readonly key: string
      readonly version: number
      readonly unchanged: boolean
    }
  | { readonly kind: 'failed'; readonly error: ZoteroError }
  | { readonly kind: 'unverified' }

export async function writeKeyedItems(
  deps: WriteDomainDeps,
  entries: readonly KeyedItemUpdate[],
  serverId: string,
  signal?: AbortSignal,
): Promise<{ libraryVersion: number; verdicts: KeyedItemVerdict[] }> {
  if (
    entries.length === 0 ||
    entries.length > ZOTERO_WRITE_OBJECT_BATCH ||
    new Set(entries.map((entry) => entry.key)).size !== entries.length
  )
    throw new ZoteroError('A keyed batch requires 1–50 distinct items.', ZOTERO_INVALID_ARGUMENT)
  const batch = await withWriteKey(deps, serverId, signal, (apiKey) =>
    deps.writer.batch(
      'users/0/items',
      entries.map((entry) => ({ ...entry.fields, key: entry.key, version: entry.version })),
      { serverId, apiKey, signal },
    ),
  )
  const buckets = [batch.successful, batch.success, batch.unchanged, batch.failed]
  const invalidIndex = buckets.some((bucket) =>
    Object.keys(bucket).some((index) => !isWriteReceiptIndex(index, entries.length)),
  )
  const owners = new Map<string, Set<number>>()
  entries.forEach((_entry, index) => {
    for (const key of [
      asRecord(batch.successful[index])?.key,
      batch.success[index],
      batch.unchanged[index],
    ]) {
      if (typeof key !== 'string') continue
      const indexes = owners.get(key) ?? new Set<number>()
      indexes.add(index)
      owners.set(key, indexes)
    }
  })
  const verdicts = entries.map((entry, index): KeyedItemVerdict => {
    const has = (bucket: Record<string, unknown>) => Object.hasOwn(bucket, String(index))
    const successful = has(batch.successful),
      success = has(batch.success),
      unchanged = has(batch.unchanged),
      failed = has(batch.failed)
    if (
      invalidIndex ||
      (owners.get(entry.key)?.size ?? 0) > 1 ||
      (failed && (successful || success || unchanged)) ||
      (unchanged && (successful || success)) ||
      (!failed && !successful && !success && !unchanged)
    )
      return { kind: 'unverified' }
    if (failed) {
      const refusal = batch.failed[index]!
      if (refusal.key !== entry.key) return { kind: 'unverified' }
      const code =
        refusal.code === 412
          ? ZOTERO_WRITE_CONFLICT
          : refusal.code === 404
            ? ZOTERO_NOT_FOUND
            : refusal.code === 400
              ? ZOTERO_INVALID_ARGUMENT
              : ZOTERO_UNEXPECTED
      return { kind: 'failed', error: new ZoteroError(refusal.message, code) }
    }
    if (unchanged)
      return batch.unchanged[index] === entry.key
        ? { kind: 'applied', key: entry.key, version: entry.version, unchanged: true }
        : { kind: 'unverified' }
    const row = batch.successful[index],
      data = asRecord(row?.data)
    if (
      row?.key !== entry.key ||
      (success && batch.success[index] !== entry.key) ||
      !isNonNegativeSafeInteger(row.version) ||
      row.version <= entry.version ||
      data?.key !== entry.key ||
      data.version !== row.version ||
      !submittedFieldsMatch(data, entry.fields)
    )
      return { kind: 'unverified' }
    return { kind: 'applied', key: entry.key, version: row.version, unchanged: false }
  })
  return { libraryVersion: batch.libraryVersion, verdicts }
}

export function throwKeyedVerdict(
  verdict: KeyedItemVerdict,
): asserts verdict is Extract<KeyedItemVerdict, { kind: 'applied' }> {
  if (verdict.kind === 'failed') throw verdict.error
  if (verdict.kind === 'unverified')
    throw new ZoteroWriteCommitUnknownError(
      'Zotero did not prove the keyed item write. Reconcile the item before further action.',
      ZOTERO_UNEXPECTED,
    )
}
