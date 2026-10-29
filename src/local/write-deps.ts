/**
 * The collaborators and per-read item state every write operation shares.
 * Kept out of `write-domain.ts` so the focused write modules (notes,
 * collections, item lists, batch, library maintenance, saved searches) and
 * the commit-proof module can name the contract without importing the
 * item-write operation home; `write-domain.ts` remains the home of the
 * versioned item write itself.
 * @module dsh-zotero/local/write-deps
 */

import type { ZoteroHttpClient } from '../http-client.js'
import type { WriteAuthorizer } from '../write-auth.js'
import type { ZoteroWriteHttpClient } from '../write-http.js'
import type { ZoteroObjectRef } from '../types.js'

/**
 * The collaborators one write-domain call needs; built per call by the
 * provider. The collection resolvers and the item-type field reader are
 * injected rather than imported so the write modules stay free of the scope
 * directory's cache semantics and of provider lifetime decisions.
 */
export interface WriteDomainDeps {
  readonly client: ZoteroHttpClient
  readonly writer: ZoteroWriteHttpClient
  readonly authorizer: WriteAuthorizer
  /** Resolve one collection from a ref or an exact name. */
  readonly resolveCollection: (refOrName: string, signal?: AbortSignal) => Promise<ZoteroObjectRef>
  /**
   * Resolve a mixed batch of collection refs and names, preserving input
   * order. Refs resolve through one cached listing (per-key reads only for
   * keys the listing lacks), so a 50-entry membership edit costs one request
   * in the common case.
   */
  readonly resolveCollections: (
    inputs: readonly string[],
    signal?: AbortSignal,
  ) => Promise<ZoteroObjectRef[]>
  /**
   * The field names one item type accepts, memoized per (serving instance,
   * item type) by the provider; the field set is static for a running build.
   */
  readonly itemTypeFields: (itemType: string, signal?: AbortSignal) => Promise<ReadonlySet<string>>
  /**
   * Called after a collection create or delete lands, so the scope directory
   * drops its cached listings before the next name resolution. Wired by the
   * provider; absent in direct-domain tests that own no directory.
   */
  readonly onCollectionsChanged?: () => void
}

/**
 * One item's write-relevant state, read fresh for every read-merge-write.
 * `readItem` pins the read to the serving instance and always reports the
 * identity the response was answered under, so the state is never partial.
 */
export interface ItemSnapshot {
  readonly version: number
  readonly itemType: string
  readonly serverId: string
}
