/**
 * Chunked `itemKey=` reads shared by the note scan, the filtered-search page
 * reader, and the collection-membership resolver. One spelling of the wire
 * batch contract: dedupe, `ZOTERO_ITEMKEY_BATCH` chunks, `limit` at the batch
 * size, identity assertion, and cross-batch library-version agreement.
 * @module dsh-zotero/local/item-batch
 */

import { ZOTERO_ITEMKEY_BATCH, ZOTERO_LIBRARY_VERSION_HEADER } from '../constants.js'
import { mapWithConcurrency } from '../concurrency.js'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../errors.js'
import { asRecord, asString, parseNonNegativeSafeInteger } from '../json.js'
import { libraryPrefix } from '../refs.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import { chunkItemKeyBatches, requireArrayBody } from './pagination.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits } from './limits.js'
import type { SupportedLocalLibrary } from '../types.js'

/** One batched read's behavior. */
export interface ItemKeyBatchOptions<T> {
  /** The instance claim every batch must match; absent lets the headers choose. */
  readonly serverId?: string
  /** Whether the request asks Zotero to include trashed rows. */
  readonly includeTrashed?: boolean
  readonly signal?: AbortSignal
  /** The listing label used in body/version errors. */
  readonly what: string
  /** Map one row; `key` is the object key the row proved. */
  readonly mapRow: (row: unknown, key: string) => T
  /** A row without an object key is a breach (`throw`) or ignorable (`skip`). */
  readonly onMissingKey: 'throw' | 'skip'
}

/** The rows one batched read returned, keyed by object key. */
export interface ItemKeyBatchResult<T> {
  readonly byKey: Map<string, T>
  readonly libraryVersion?: number
}

/**
 * Read exactly the requested keys in chunked `itemKey=` batches.
 * @param deps - the transport and its configured concurrency.
 * @param library - the library the keys belong to.
 * @param keys - the object keys to read; duplicates collapse.
 * @param options - batch behavior and the row mapper.
 * @returns the rows by key and the library version every batch agreed on.
 */
export async function fetchItemKeyBatches<T>(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  library: SupportedLocalLibrary,
  keys: readonly string[],
  options: ItemKeyBatchOptions<T>,
): Promise<ItemKeyBatchResult<T>> {
  const unique = [...new Set(keys)]
  if (unique.length === 0) return { byKey: new Map(), libraryVersion: undefined }
  const chunks = chunkItemKeyBatches(unique)
  const batches = await mapWithConcurrency(
    chunks,
    deps.limits.searchConcurrency,
    async (chunk, poolSignal) => {
      const params = new URLSearchParams({
        itemKey: chunk.join(','),
        // The batch cap is the request cap: `itemKey=` never returns more
        // than `ZOTERO_ITEMKEY_BATCH` rows, and relying on the server's
        // default limit would silently truncate the batch.
        limit: String(ZOTERO_ITEMKEY_BATCH),
      })
      if (options.includeTrashed === true) params.set('includeTrashed', '1')
      const { json, headers } = await deps.client.getJson<unknown>(
        `${libraryPrefix(library)}/items`,
        params,
        { signal: poolSignal, serverId: options.serverId },
      )
      assertServerIdMatches(serverIdFromHeaders(headers, options.serverId), options.serverId)
      const version = parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER))
      const byKey = new Map<string, T>()
      for (const row of requireArrayBody(json, options.what)) {
        const key = asString(asRecord(row)?.key)
        if (key === undefined) {
          if (options.onMissingKey === 'skip') continue
          throw new ZoteroError(
            `A ${options.what} row arrived without an object key.`,
            ZOTERO_UNEXPECTED,
          )
        }
        byKey.set(key, options.mapRow(row, key))
      }
      return { byKey, version }
    },
    { signal: options.signal },
  )
  const byKey = new Map<string, T>()
  let libraryVersion: number | undefined
  for (const batch of batches) {
    for (const [key, item] of batch.byKey) byKey.set(key, item)
    if (batch.version !== undefined) {
      if (libraryVersion !== undefined && libraryVersion !== batch.version) {
        throw new ZoteroError(
          `Zotero's library version changed while the ${options.what} was fetched.`,
          ZOTERO_UNEXPECTED,
        )
      }
      libraryVersion = batch.version
    }
  }
  return { byKey, libraryVersion }
}
