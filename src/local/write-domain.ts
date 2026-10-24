/**
 * The write domain: notes, item tags, collection membership, collections,
 * items, and library tags against the Local API's write endpoints. Every
 * function here owns the full write lifecycle the Zotero 10 protocol implies:
 *
 * - the target is always the personal library (`users/0`); a ref naming a
 *   group or a foreign user id is refused before any network happens;
 * - the serving instance id is established (and pinned) before any read or
 *   write, because every write must carry `Zotero-Server-ID`;
 * - the API key comes from {@link WriteAuthorizer}, and a 401 replays the
 *   same request exactly once after a fresh authorization: single-use keys
 *   are consumed at authentication time, so a burned key is forgotten;
 * - tag, collection-membership, and scalar updates are read-merge-write under
 *   an `If-Unmodified-Since-Version` precondition: PATCH replaces arrays
 *   wholesale, so the merged list must be sent whole;
 * - collection and tag deletes carry the library version of their preceding
 *   read; item Trash PATCHes carry each object's version while processing its
 *   complete child graph, so concurrent changes fail closed;
 * - one object per batch means a Zotero refusal surfaces as a typed error,
 *   never as a silently skipped entry in a bucket.
 *
 * There is no retry beyond the re-authorization replay, and a version
 * conflict (412) is reported as `ZOTERO_WRITE_CONFLICT` for the model to
 * re-run: the tool re-reads and reapplies on top of what is there now.
 * Non-idempotent creates (note, item, collection) never retry: an unprovable
 * commit surfaces as `committed-unverified` with `retryable: false`.
 * @module dsh-zotero/local/write-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'
import {
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  WRITE_IDENTITY_UNSUPPORTED_MESSAGE,
  WRITE_LIST_SELECTION_MESSAGE,
  WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
  WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
  WRITE_ITEM_TYPE_MISSING_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  writeCollectionNameExistsMessage,
  writeFieldNotForItemTypeMessage,
  writeListEmptyMessage,
  writeListTooLongMessage,
  writeObjectRefusedMessage,
  writeObjectStateMissingMessage,
  requireNonBlank,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroError,
} from '../errors.js'
import {
  asRecord,
  asString,
  isNonNegativeSafeInteger,
  isObjectKey,
  parseNonNegativeSafeInteger,
  stringArrayOf,
} from '../json.js'
import {
  formatRef,
  formatZoteroRelationUri,
  isRefString,
  libraryPrefix,
  parseRef,
  PERSONAL_LIBRARY,
  refForLibrary,
  relationTargetRef,
  requireSupportedLocalRef,
  requireWritableRef,
} from '../refs.js'
import { readAllPages } from './pagination.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import {
  normalizeCreator,
  requireCreatableItemType,
  requireTitleOrUrl,
  validateItemUpdateFields,
  wireFieldOf,
} from '../write-item-rules.js'
import { markdownToNoteHtml } from './note-format.js'
import { readTrashGraph } from './trash-item.js'
import type { WriteAuthorizer } from '../write-auth.js'
import {
  ZoteroWriteCommitUnknownError,
  type ZoteroBatchWrite,
  type ZoteroWriteHttpClient,
  type ZoteroWriteObjectFailure,
} from '../write-http.js'
import {
  type ZoteroCreateCollectionCommittedOutcome,
  type ZoteroCreateCollectionRequest,
  type ZoteroCreateItemCommittedOutcome,
  type ZoteroCreateItemRequest,
  type ZoteroCreateNoteCommittedOutcome,
  type ZoteroCreateNoteRequest,
  type ZoteroDeleteCollectionRequest,
  type ZoteroDeleteCollectionResult,
  type ZoteroDeleteLibraryTagsRequest,
  type ZoteroDeleteLibraryTagsResult,
  type ZoteroObjectRef,
  type ZoteroUpdateItemCollectionsRequest,
  type ZoteroUpdateItemCollectionsResult,
  type ZoteroUpdateItemRequest,
  type ZoteroUpdateItemResult,
  type ZoteroUpdateItemTagsRequest,
  type ZoteroUpdateItemTagsResult,
  type ZoteroUpdateNoteRequest,
  type ZoteroUpdateNoteResult,
  type ZoteroUpdateCollectionRequest,
  type ZoteroUpdateCollectionResult,
  type ZoteroRestoreItemsRequest,
  type ZoteroRestoreItemsResult,
  type ZoteroCreateSavedSearchRequest,
  type ZoteroSavedSearchResult,
  type ZoteroUpdateSavedSearchRequest,
  type ZoteroDeleteSavedSearchRequest,
  type ZoteroDeleteSavedSearchResult,
  type ZoteroSavedSearchCondition,
  type ZoteroWriteCommittedUnverified,
  type ZoteroBatchItemsRequest,
  type ZoteroBatchItemsResult,
  type ZoteroBatchCreateItemResult,
  type ZoteroBatchUpdateItemResult,
  type ZoteroBatchDeleteItemResult,
  type ZoteroBatchCreateUnverified,
  type ZoteroBatchOperationFailure,
} from '../types.js'

/**
 * The collaborators one write-domain call needs; built per call by the
 * provider. The collection resolvers and the item-type field reader are
 * injected rather than imported so this module stays free of the scope
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

/** One item's write-relevant state, read fresh for every read-merge-write. */
interface ItemSnapshot {
  readonly version: number
  readonly itemType: string
  readonly serverId: string | undefined
}

type ItemTags = readonly { readonly tag: string; readonly type?: number }[]
type ItemStateReader<S> = (data: Record<string, unknown>) => S

function tagState(data: Record<string, unknown>): { tags: ItemTags } {
  const tags = tagsOf(data)
  if (data.tags === undefined || tags === undefined)
    throw new ZoteroError(writeObjectStateMissingMessage('tags'), ZOTERO_UNEXPECTED)
  return { tags }
}

function collectionState(data: Record<string, unknown>): { collectionKeys: readonly string[] } {
  if (typeof data.parentItem === 'string' && data.parentItem !== '') {
    throw new ZoteroError(
      'Child items inherit collection membership from their parent; update the parent instead.',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const collectionKeys = strictCollectionKeysOf(data)
  if (data.collections === undefined || collectionKeys === undefined)
    throw new ZoteroError(writeObjectStateMissingMessage('collections'), ZOTERO_UNEXPECTED)
  return { collectionKeys }
}

/** True when the error is Zotero refusing the write for a missing or consumed key. */
function isWriteUnauthorized(error: unknown): boolean {
  return error instanceof ZoteroError && error.code === ZOTERO_WRITE_UNAUTHORIZED
}

/**
 * The one legitimate write replay: authorize, send once; on a 401 forget the
 * key (single-use keys are consumed at authentication, and a stored grant may
 * have been revoked), authorize again, send the identical request once more.
 * A second 401 escalates with the after-authorization guidance; a one-time
 * key is always forgotten once its write settles, consumed either way.
 */
async function withWriteKey<T>(
  deps: WriteDomainDeps,
  serverId: string,
  signal: AbortSignal | undefined,
  send: (apiKey: string) => Promise<T>,
): Promise<T> {
  const first = await deps.authorizer.keyFor(serverId, signal)
  try {
    return await send(first.key)
  } catch (error) {
    if (!isWriteUnauthorized(error)) throw error
    await deps.authorizer.invalidate(serverId, first.key)
    const second = await deps.authorizer.keyFor(serverId, signal)
    try {
      return await send(second.key)
    } catch (retried) {
      if (isWriteUnauthorized(retried)) {
        await deps.authorizer.invalidate(serverId, second.key)
        throw new ZoteroError(WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED, {
          cause: retried,
        })
      }
      throw retried
    } finally {
      if (second.oneTime) deps.authorizer.forget(second.key)
    }
  } finally {
    if (first.oneTime) deps.authorizer.forget(first.key)
  }
}

/**
 * The instance id every write must carry. The read client remembers it from
 * the latest response; when this process has read nothing yet, one probe of
 * `/api/` establishes it. A build that reports no instance id has no local
 * write protocol to talk to.
 */
async function ensureServerId(deps: WriteDomainDeps, signal?: AbortSignal): Promise<string> {
  const remembered = deps.client.serverId
  if (remembered !== undefined) return remembered
  await deps.client.get('', undefined, { signal })
  const id = deps.client.serverId
  if (id === undefined) {
    throw new ZoteroError(WRITE_IDENTITY_UNSUPPORTED_MESSAGE, ZOTERO_UNEXPECTED)
  }
  return id
}

/**
 * The library's current transaction version, read cheaply for delete
 * preconditions. One single-row listing; the version rides the response
 * header, so the body is discarded. Absence is protocol drift.
 */
async function readLibraryVersion(
  deps: WriteDomainDeps,
  serverId: string,
  signal?: AbortSignal,
): Promise<{ libraryVersion: number; serverId: string }> {
  const params = new URLSearchParams()
  params.set('limit', '1')
  const response = await deps.client.get(`${libraryPrefix(PERSONAL_LIBRARY)}/items/top`, params, {
    signal,
    serverId,
  })
  const libraryVersion = parseNonNegativeSafeInteger(
    response.headers.get(ZOTERO_LIBRARY_VERSION_HEADER),
  )
  if (libraryVersion === undefined) {
    throw new ZoteroError(WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const observed = serverIdFromHeaders(response.headers)
  assertServerIdMatches(observed, serverId)
  return { libraryVersion, serverId: observed ?? serverId }
}

/** Refuse a qualified ref that names another Zotero instance before any write. */
function requireWritableRefAtServer(
  ref: ZoteroObjectRef,
  kinds: readonly ZoteroObjectRef['kind'][],
  serverId: string,
): ZoteroObjectRef {
  const checked = requireWritableRef(ref, kinds)
  assertServerIdMatches(ref.serverId, serverId)
  return checked
}

/** Refuse a qualified ref that names another Zotero instance before citing as relation source. */
function requireSupportedRefAtServer(
  ref: ZoteroObjectRef,
  kinds: readonly ZoteroObjectRef['kind'][],
  serverId: string,
): ZoteroObjectRef {
  const checked = requireSupportedLocalRef(ref, kinds)
  assertServerIdMatches(ref.serverId, serverId)
  return checked
}

function normalizeWriteList(name: string, values: readonly string[]): string[] {
  return [...new Set(values.map((value) => requireNonBlank(name, value)))]
}

/** Validate a ref-shaped collection argument locally; names remain live lookups. */
function normalizeCollectionInput(name: string, value: string): string {
  const collection = requireNonBlank(name, value)
  if (isRefString(collection)) requireWritableRef(parseRef(collection), ['collection'])
  return collection
}

/**
 * Merge string lists: `merged = (existing − remove) ∪ (add − existing)`.
 * Order is existing-first, then genuinely new additions in request order;
 * duplicates collapse. `added`/`removed` name the actual changes, not the
 * request, and `changed` is false exactly when nothing would move.
 */
export function mergeList(
  existing: readonly string[],
  remove: readonly string[],
  add: readonly string[],
): { merged: string[]; added: string[]; removed: string[]; changed: boolean } {
  const existingSet = new Set(existing)
  const removeSet = new Set(remove)
  const remaining = existing.filter((entry) => !removeSet.has(entry))
  const seen = new Set(remaining)
  const merged = [...remaining]
  const added: string[] = []
  for (const entry of add) {
    // (add − existing): an entry already present is not an addition, even when
    // it was also removed; the removal wins for saved entries.
    if (existingSet.has(entry)) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
    added.push(entry)
  }
  const mergedSet = new Set(merged)
  const removed = existing.filter((entry) => !mergedSet.has(entry))
  // Deduplicate the removed report while preserving first-seen order; the
  // existing list itself should hold no duplicates, but a malformed saved
  // state must not report one removal twice.
  const dedupedRemoved = [...new Set(removed)]
  return {
    merged,
    added,
    removed: dedupedRemoved,
    changed: added.length > 0 || dedupedRemoved.length > 0,
  }
}

/**
 * Merge tag entries, preserving each retained tag's type. New tags carry no
 * type; removed tags are gone. Shape mirrors {@link mergeList} for the
 * collection and tag tools to share one semantic.
 */
export function mergeTagList(
  existing: readonly { readonly tag: string; readonly type?: number }[],
  remove: readonly string[],
  add: readonly string[],
): {
  merged: { tag: string; type?: number }[]
  added: string[]
  removed: string[]
  changed: boolean
} {
  const names = existing.map((entry) => entry.tag)
  const { merged, added, removed, changed } = mergeList(names, remove, add)
  const typeOf = new Map(existing.map((entry) => [entry.tag, entry.type] as const))
  return {
    merged: merged.map((tag) => {
      const type = typeOf.get(tag)
      return type === undefined ? { tag } : { tag, type }
    }),
    added,
    removed,
    changed,
  }
}

/**
 * Read one item's write-relevant state, pinning the read to the instance the
 * write will target. Only the operation's reader requires list state;
 * child items legitimately omit collections in Zotero's JSON.
 */
async function readItem<S>(
  deps: WriteDomainDeps,
  ref: ZoteroObjectRef,
  serverId: string,
  readState: ItemStateReader<S>,
  signal?: AbortSignal,
): Promise<ItemSnapshot & S> {
  const { json, headers } = await deps.client.getJson<unknown>(
    `${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`,
    undefined,
    { signal, serverId },
  )
  const record = asRecord(json)
  const version = isNonNegativeSafeInteger(record?.version) ? record.version : undefined
  if (version === undefined) {
    throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record?.data)
  const responseKey = asString(record?.key)
  const dataKey = asString(data?.key)
  if (data === undefined || responseKey !== ref.key || dataKey !== ref.key) {
    throw new ZoteroError(
      `Zotero answered the write read with a different item than ${ref.key}; the response cannot be used for this write.`,
      ZOTERO_UNEXPECTED,
    )
  }
  const itemType = asString(data?.itemType)
  if (itemType === undefined || itemType === '') {
    throw new ZoteroError(WRITE_ITEM_TYPE_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const observedServerId = serverIdFromHeaders(headers)
  assertServerIdMatches(observedServerId, serverId)
  return {
    ...readState(data),
    version,
    itemType,
    serverId: observedServerId ?? serverId,
  }
}

/**
 * Read one collection or saved search under the instance pin and prove the
 * object version its update must carry. Deletes additionally use the library
 * version this same read reports as their precondition, so any concurrent
 * write fails the delete instead of slipping past it.
 */
async function readRecordForWrite(
  deps: WriteDomainDeps,
  object: 'collection' | 'search',
  key: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<{
  data: Record<string, unknown> | undefined
  version: number
  libraryVersion: number | undefined
  serverId: string
}> {
  const segment = object === 'collection' ? 'collections' : 'searches'
  const { json, headers } = await deps.client.getJson<unknown>(
    `${libraryPrefix(PERSONAL_LIBRARY)}/${segment}/${key}`,
    undefined,
    { signal, serverId },
  )
  const record = asRecord(json)
  const data = asRecord(record?.data)
  const version = isNonNegativeSafeInteger(record?.version) ? record.version : undefined
  if (version === undefined) {
    throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  if (asString(record?.key) !== key || asString(data?.key) !== key) {
    throw new ZoteroError(
      `Zotero answered the write read with a different ${object} than ${key}; the response cannot be used for this write.`,
      ZOTERO_UNEXPECTED,
    )
  }
  const observed = serverIdFromHeaders(headers)
  assertServerIdMatches(observed, serverId)
  return {
    data,
    version,
    libraryVersion: parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER)),
    serverId: observed ?? serverId,
  }
}

/** The delete paths cannot proceed without the library version their read reported. */
function requireLibraryVersion(libraryVersion: number | undefined): number {
  if (libraryVersion === undefined) {
    throw new ZoteroError(WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE, ZOTERO_UNEXPECTED)
  }
  return libraryVersion
}

/** Parse a saved tag array strictly; undefined means malformed, absent means empty. */
function tagsOf(data: Record<string, unknown> | undefined): ItemTags | undefined {
  const raw = data?.tags
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return undefined
  const entries: { tag: string; type?: number }[] = []
  for (const row of raw) {
    const record = asRecord(row)
    const tag = record === undefined ? asString(row) : asString(record.tag)
    if (tag === undefined || tag.trim() === '') return undefined
    const type = record?.type
    if (type !== undefined && !isNonNegativeSafeInteger(type)) return undefined
    entries.push(type === undefined ? { tag } : { tag, type })
  }
  return entries
}

/** Parse a saved collection-key array strictly; undefined means malformed. */
function strictCollectionKeysOf(data: Record<string, unknown> | undefined): string[] | undefined {
  const raw = data?.collections
  if (raw === undefined) return []
  if (
    !Array.isArray(raw) ||
    raw.some((entry) => typeof entry !== 'string' || !isObjectKey(entry))
  ) {
    return undefined
  }
  return raw as string[]
}

/** The Zotero relations key carrying source-item links. */
const DC_RELATION = 'dc:relation'

function relationUrisOf(data: Record<string, unknown> | undefined): string[] {
  const relations = asRecord(data?.relations)
  const raw = relations === undefined ? undefined : relations[DC_RELATION]
  if (typeof raw === 'string') return [raw]
  return stringArrayOf(raw)
}

function itemRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'item', key, serverId))
}

function collectionRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'collection', key, serverId))
}

function searchRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'search', key, serverId))
}

function batchCreateUnverified(
  index: number,
  reason: ZoteroBatchCreateUnverified['reason'],
  serverId: string,
  key?: string,
  version?: number,
): ZoteroBatchCreateUnverified {
  return {
    op: 'create',
    index,
    committed: true,
    retryable: false,
    reason,
    serverId,
    ...(key !== undefined && isObjectKey(key) ? { key, ref: itemRef(key, serverId) } : {}),
    ...(version !== undefined ? { version } : {}),
  }
}

/** Settle every requested index using the same proof rules as a single create. */
function settleBatchCreates(
  batch: ZoteroBatchWrite,
  creates: readonly { readonly itemType: string }[],
  serverId: string,
  created: ZoteroBatchCreateItemResult[],
  unverified: ZoteroBatchCreateUnverified[],
  failed: ZoteroBatchOperationFailure[],
): void {
  const indices = new Set(creates.map((_, index) => String(index)))
  const buckets = [batch.successful, batch.success, batch.failed, batch.unchanged]
  const unexpectedIndex = buckets.some((bucket) =>
    Object.keys(bucket).some((index) => !indices.has(index)),
  )
  const owners = new Map<string, Set<number>>()
  for (let index = 0; index < creates.length; index++) {
    for (const key of [asString(batch.successful[index]?.key), batch.success[index]]) {
      if (key === undefined || !isObjectKey(key)) continue
      const indicesForKey = owners.get(key) ?? new Set<number>()
      indicesForKey.add(index)
      owners.set(key, indicesForKey)
    }
  }
  const at = <T>(bucket: Record<string, T>, index: number): Record<string, T> =>
    Object.hasOwn(bucket, String(index)) ? { '0': bucket[index] } : {}
  for (let index = 0; index < creates.length; index++) {
    const duplicateKey = [asString(batch.successful[index]?.key), batch.success[index]].some(
      (key) => key !== undefined && (owners.get(key)?.size ?? 0) > 1,
    )
    if (unexpectedIndex || duplicateKey) {
      unverified.push(batchCreateUnverified(index, 'commit-unknown', serverId))
      continue
    }
    try {
      const settled = settleSingleEntryBatch(
        {
          successful: at(batch.successful, index),
          success: at(batch.success, index),
          failed: at(batch.failed, index),
          unchanged: at(batch.unchanged, index),
          libraryVersion: batch.libraryVersion,
        },
        'item',
        serverId,
        (data) => {
          const itemType = asString(data.itemType)
          if (itemType !== creates[index].itemType) return undefined
          return { itemType, title: asString(data.title), url: asString(data.url) }
        },
      )
      if (settled.status === 'unverified') {
        const { kind: _kind, ...receipt } = settled.result
        unverified.push({ ...receipt, op: 'create', index })
      } else {
        const { key, version, payload } = settled.entry
        created.push({
          index,
          ref: itemRef(key, serverId),
          key,
          version,
          itemType: payload.itemType,
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.url !== undefined ? { url: payload.url } : {}),
        })
      }
    } catch (error) {
      if (!(error instanceof ZoteroError)) throw error
      failed.push({ op: 'create', index, code: error.code, message: error.message })
    }
  }
}

/** The canonical relation URI for a source item. */
function relationUriOf(ref: ZoteroObjectRef): string {
  return formatZoteroRelationUri(ref)
}

/** Map Zotero's per-object refusal onto the typed domain error it names. */
function objectRefusedError(refused: ZoteroWriteObjectFailure): ZoteroError {
  switch (refused.code) {
    case 400:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_INVALID_ARGUMENT,
      )
    case 404:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_NOT_FOUND,
      )
    case 412:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_WRITE_CONFLICT,
      )
    default:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_UNEXPECTED,
      )
  }
}

type CommittedUnverifiedKind = 'note' | 'item' | 'collection' | 'search'

interface CommittedUnverifiedOptions {
  kind: CommittedUnverifiedKind
  serverId: string
  batch?: ZoteroBatchWrite
  key?: string
  version?: number
  reason?: 'saved-state-unverified' | 'commit-unknown'
}

/**
 * The shared non-retryable outcome for non-idempotent creates. Notes, items,
 * and collections share one shape; only the ref builder differs (items and
 * notes are item refs, collections are collection refs).
 */
function committedUnverified(options: CommittedUnverifiedOptions): ZoteroWriteCommittedUnverified {
  const { kind, batch, serverId, key, version, reason = 'saved-state-unverified' } = options
  const safeKey = key !== undefined && isObjectKey(key) ? key : undefined
  const ref =
    safeKey === undefined
      ? undefined
      : kind === 'collection'
        ? collectionRef(safeKey, serverId)
        : kind === 'search'
          ? searchRef(safeKey, serverId)
          : itemRef(safeKey, serverId)
  return {
    kind: 'committed-unverified',
    committed: true,
    retryable: false,
    reason,
    ...(safeKey !== undefined
      ? {
          key: safeKey,
          ...(ref !== undefined ? { ref } : {}),
          ...(version !== undefined ? { version } : {}),
        }
      : {}),
    ...(batch !== undefined ? { libraryVersion: batch.libraryVersion } : {}),
    serverId,
  }
}

/**
 * A single-create batch outcome: the parsed batch, or the marker for a commit
 * the transport could not prove. The marker keeps the commit-unknown
 * translation in one place while each caller maps it to its own
 * {@link committedUnverified} kind.
 */
type SingleCreateOutcome = ZoteroBatchWrite | { readonly commitUnknown: true }

/**
 * Send one non-idempotent create as a single-entry batch. A commit that
 * could not be verified settles as the marker; every other failure rethrows
 * untouched.
 */
async function sendSingleCreate(
  deps: WriteDomainDeps,
  path: string,
  entry: Record<string, unknown>,
  serverId: string,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<SingleCreateOutcome> {
  try {
    return await deps.writer.batch(path, [entry], { serverId, apiKey, signal })
  } catch (error) {
    if (error instanceof ZoteroWriteCommitUnknownError) return { commitUnknown: true }
    throw error
  }
}

/**
 * The proven saved state of a single-entry batch: the object's key, version,
 * raw echo, library version, and whatever `proven` shaped from the echo.
 */
interface SettledEntry<P> {
  readonly key: string
  readonly version: number
  readonly data: Record<string, unknown>
  readonly libraryVersion: number
  readonly payload: P
}

/**
 * Settle a one-entry write batch: the single retry-safety contract for the
 * three non-idempotent creates (note, item, collection). The flow:
 *
 * 1. the four outcome buckets must be mutually exclusive and carry no index
 *    but `'0'`; any other shape means the commit state is unknowable;
 * 2. an entry in `failed` is Zotero's own refusal and surfaces as a typed
 *    error;
 * 3. the key comes from `successful['0'].key` with `success['0']` as the
 *    fallback; a conflict or a malformed key leaves the commit unproven;
 * 4. the object version, the echo record, and the echo's own key/version
 *    must all be present and agree;
 * 5. `proven` has the final word: it shapes the caller's saved-state claim
 *    from the echo (requested parent, name, item type, …) and returning
 *    `undefined` leaves the commit unproven.
 *
 * Every doubt becomes a committed-unverified result: the caller never
 * retries and never fills saved state from the request.
 */
function settleSingleEntryBatch<P>(
  batch: ZoteroBatchWrite,
  kind: CommittedUnverifiedKind,
  serverId: string,
  proven: (data: Record<string, unknown>, key: string, version: number) => P | undefined,
):
  | { status: 'applied'; entry: SettledEntry<P> }
  | { status: 'unverified'; result: ZoteroWriteCommittedUnverified } {
  const has = (bucket: Record<string, unknown>, index: string): boolean =>
    Object.prototype.hasOwnProperty.call(bucket, index)
  const hasUnexpectedIndex = (bucket: Record<string, unknown>): boolean =>
    Object.keys(bucket).some((index) => index !== '0')
  const failed = has(batch.failed, '0')
  const successful = has(batch.successful, '0')
  const success = has(batch.success, '0')
  const unchanged = has(batch.unchanged, '0')
  if (
    hasUnexpectedIndex(batch.failed) ||
    hasUnexpectedIndex(batch.successful) ||
    hasUnexpectedIndex(batch.success) ||
    hasUnexpectedIndex(batch.unchanged) ||
    (failed && (successful || success || unchanged)) ||
    (unchanged && (successful || success)) ||
    (!failed && !successful && !success && !unchanged)
  ) {
    return {
      status: 'unverified',
      result: committedUnverified({ kind, batch, serverId, reason: 'commit-unknown' }),
    }
  }
  const refused = batch.failed['0']
  if (refused !== undefined) throw objectRefusedError(refused)
  const written = batch.successful['0']
  const writtenKey = written === undefined ? undefined : asString(written.key)
  const successKey = asString(batch.success['0'])
  const key =
    writtenKey !== undefined && isObjectKey(writtenKey)
      ? writtenKey
      : successKey !== undefined && isObjectKey(successKey)
        ? successKey
        : undefined
  const keyConflict =
    writtenKey !== undefined &&
    successKey !== undefined &&
    isObjectKey(writtenKey) &&
    isObjectKey(successKey) &&
    writtenKey !== successKey
  if (
    (writtenKey !== undefined && !isObjectKey(writtenKey)) ||
    (successKey !== undefined && !isObjectKey(successKey)) ||
    (written !== undefined && writtenKey === undefined) ||
    keyConflict
  ) {
    return {
      status: 'unverified',
      result: committedUnverified({ kind, batch, serverId, key: keyConflict ? undefined : key }),
    }
  }
  if (key === undefined) {
    return { status: 'unverified', result: committedUnverified({ kind, batch, serverId }) }
  }
  const version = isNonNegativeSafeInteger(written?.version) ? written.version : undefined
  if (version === undefined) {
    return { status: 'unverified', result: committedUnverified({ kind, batch, serverId, key }) }
  }
  const data = asRecord(written.data)
  if (data === undefined || data.key !== key || data.version !== version) {
    return {
      status: 'unverified',
      result: committedUnverified({ kind, batch, serverId, key, version }),
    }
  }
  const payload = proven(data, key, version)
  if (payload === undefined) {
    return {
      status: 'unverified',
      result: committedUnverified({ kind, batch, serverId, key, version }),
    }
  }
  return {
    status: 'applied',
    entry: { key, version, data, libraryVersion: batch.libraryVersion, payload },
  }
}

/**
 * Create a research note: standalone or under a parent item, with tags,
 * collections (standalone only), and `dc:relation` source links. The note
 * body is converted to note HTML before it leaves this module; the created
 * note's saved state comes back inside the batch's `successful` bucket, so
 * no follow-up read is needed.
 *
 * Cross-field invariant at both ends of the call: a child note never carries
 * collections. The model-facing tool refuses the combination in
 * `tools/create-note.ts` `buildRequest` (before the plan card); this entry
 * refuses it again for any caller that reaches the domain without that tool
 * (`service.createNote` or provider direct use). Both ends throw the shared
 * `WRITE_CHILD_COLLECTIONS_MESSAGE`. The entry-field assembly below is
 * structural only (collections key only when standalone); it is not the gate.
 */
export async function createNote(
  deps: WriteDomainDeps,
  request: ZoteroCreateNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateNoteCommittedOutcome> {
  requireNonBlank('markdown', request.markdown)
  const localParent =
    request.parentItem === undefined ? undefined : requireWritableRef(request.parentItem, ['item'])
  const collectionInputs = (request.collections ?? []).map((value) =>
    normalizeCollectionInput('collections', value),
  )
  const localSources = (request.sourceRefs ?? []).map((ref) =>
    requireSupportedLocalRef(ref, ['item']),
  )
  const tags = normalizeWriteList('tags', request.tags ?? [])
  if (localParent !== undefined && collectionInputs.length > 0) {
    throw new ZoteroError(WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }

  const serverId = await ensureServerId(deps, signal)
  const parent =
    localParent === undefined
      ? undefined
      : requireWritableRefAtServer(localParent, ['item'], serverId)
  const collections: ZoteroObjectRef[] = (
    await deps.resolveCollections(collectionInputs, signal)
  ).map((ref) => requireWritableRefAtServer(ref, ['collection'], serverId))
  const sources = localSources.map((ref) => requireSupportedRefAtServer(ref, ['item'], serverId))
  const entry: Record<string, unknown> = {
    itemType: 'note',
    note: markdownToNoteHtml(request.markdown),
    ...(parent !== undefined ? { parentItem: parent.key } : {}),
    ...(tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : {}),
    ...(parent === undefined && collections.length > 0
      ? { collections: collections.map((ref) => ref.key) }
      : {}),
    ...(sources.length > 0
      ? { relations: { [DC_RELATION]: sources.map((ref) => relationUriOf(ref)) } }
      : {}),
  }
  return await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const batch = await sendSingleCreate(
      deps,
      `${libraryPrefix(PERSONAL_LIBRARY)}/items`,
      entry,
      serverId,
      apiKey,
      signal,
    )
    if ('commitUnknown' in batch) {
      return committedUnverified({
        kind: 'note',
        serverId,
        reason: 'commit-unknown',
      })
    }
    // The requested parent is part of the saved-state claim too. Never fill a
    // missing or contradictory parent from the request after Zotero has
    // already committed the note; the caller must reconcile an unverified
    // child-note result by its key instead of receiving a false guarantee.
    const proven = (
      data: Record<string, unknown>,
    ):
      | { savedTags: string[]; savedCollectionKeys: string[]; savedRelations: string[] }
      | undefined => {
      if (
        data.itemType !== 'note' ||
        typeof data.note !== 'string' ||
        (parent !== undefined && data.parentItem !== parent.key) ||
        (parent === undefined && data.parentItem !== undefined)
      ) {
        return undefined
      }
      const savedTagState = tagsOf(data)
      const savedCollectionState = strictCollectionKeysOf(data)
      if (savedTagState === undefined || savedCollectionState === undefined) return undefined
      return {
        savedTags: savedTagState.map((tagged) => tagged.tag),
        savedCollectionKeys: savedCollectionState,
        savedRelations: relationUrisOf(data),
      }
    }
    const settled = settleSingleEntryBatch(batch, 'note', serverId, proven)
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: itemRef(key, serverId),
      key,
      version,
      ...(parent !== undefined ? { parentItem: itemRef(parent.key, serverId) } : {}),
      collections:
        parent !== undefined
          ? []
          : payload.savedCollectionKeys.map((collectionKey) =>
              collectionRef(collectionKey, serverId),
            ),
      tags: payload.savedTags,
      sourceRefs: payload.savedRelations.map((uri) => relationUriToRef(uri, serverId)),
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
}

/**
 * A saved relation URI back to the ref form the model uses; unparseable or
 * unprovable URIs stay verbatim. The echo of a personal note only ever
 * carries `users/0` outbound, so any `users/<id>` in it is Zotero's
 * canonicalization of that same personal library (see
 * `refs.relationTargetRef`); group targets are explicit cross-library refs.
 */
function relationUriToRef(uri: string, serverId: string): string {
  return relationTargetRef(uri, serverId, { personalContext: true }) ?? uri
}

/** What one read-merge-write plan receives, and how it sends its patch. */
interface ItemWriteContext<S> {
  /** The item's write-relevant state as read under the pinned instance. */
  readonly snapshot: ItemSnapshot & S
  /** The serving instance id the read was answered under. */
  readonly serverId: string
  /** The provenance-qualified result ref for the outcome. */
  readonly resultRef: string
  /** Send one whole-object PATCH under the read's version precondition. */
  readonly send: (body: Record<string, unknown>) => Promise<{ libraryVersion: number }>
}

/**
 * The read-merge-write scaffold shared by every item update: pin the instance,
 * check the ref against it, read the item once, and hand the plan a snapshot
 * plus a `send` that carries the version precondition. The plan owns the merge
 * and the result shaping; an unchanged plan simply never calls `send`.
 */
async function withItemWrite<T>(
  deps: WriteDomainDeps,
  item: ZoteroObjectRef,
  signal: AbortSignal | undefined,
  plan: (context: ItemWriteContext<unknown>) => Promise<T>,
): Promise<T> {
  return await withItemStateWrite(deps, item, signal, () => ({}), plan)
}

/**
 * The same scaffold for plans that merge list state: the reader decides what
 * the snapshot must carry, and its result is the only place that state is
 * read, so a plan never guesses at a field the read did not prove.
 */
async function withItemStateWrite<S, T>(
  deps: WriteDomainDeps,
  item: ZoteroObjectRef,
  signal: AbortSignal | undefined,
  readState: ItemStateReader<S>,
  plan: (context: ItemWriteContext<S>) => Promise<T>,
): Promise<T> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(item, ['item'], serverId)
  const snapshot = await readItem(deps, ref, serverId, readState, signal)
  const effectiveServerId = snapshot.serverId ?? serverId
  const send = (body: Record<string, unknown>): Promise<{ libraryVersion: number }> =>
    withWriteKey(
      deps,
      effectiveServerId,
      signal,
      async (apiKey) =>
        await deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`, body, {
          serverId: effectiveServerId,
          apiKey,
          ifUnmodifiedSinceVersion: snapshot.version,
          signal,
        }),
    )
  return await plan({
    snapshot,
    serverId: effectiveServerId,
    resultRef: itemRef(ref.key, effectiveServerId),
    send,
  })
}

/**
 * Update one item's tags: add and remove settle in a single read-merge-write.
 * `add` and `remove` share one call so the same array never suffers two
 * competing preconditions; overlapping entries follow
 * `next = existing − remove ∪ (add − existing)` (a saved entry named in both
 * is removed, a new entry named in both is added).
 */
export async function updateItemTags(
  deps: WriteDomainDeps,
  request: ZoteroUpdateItemTagsRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateItemTagsResult> {
  const localRef = requireWritableRef(request.item, ['item'])
  const add = normalizeWriteList('add', request.add ?? [])
  const remove = normalizeWriteList('remove', request.remove ?? [])
  if (add.length === 0 && remove.length === 0) {
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  return await withItemStateWrite(
    deps,
    localRef,
    signal,
    tagState,
    async ({ snapshot, serverId, resultRef, send }) => {
      const { merged, added, removed, changed } = mergeTagList(snapshot.tags, remove, add)
      if (!changed) {
        return {
          kind: 'applied',
          ref: resultRef,
          version: snapshot.version,
          tags: merged.map((entry) => entry.tag),
          added: [],
          removed: [],
          unchanged: true,
          serverId,
        }
      }
      const { libraryVersion } = await send({ tags: merged })
      return {
        kind: 'applied',
        ref: resultRef,
        version: libraryVersion,
        tags: merged.map((entry) => entry.tag),
        added,
        removed,
        unchanged: false,
        libraryVersion,
        serverId,
      }
    },
  )
}

/**
 * Update one item's collection membership. Names resolve to keys before any
 * item read, so an unknown or ambiguous name fails before the versioned cycle
 * starts; the merged key list is then written whole under the version
 * precondition.
 */
export async function updateItemCollections(
  deps: WriteDomainDeps,
  request: ZoteroUpdateItemCollectionsRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateItemCollectionsResult> {
  const localRef = requireWritableRef(request.item, ['item'])
  const addInputs = (request.add ?? []).map((value) => normalizeCollectionInput('add', value))
  const removeInputs = (request.remove ?? []).map((value) =>
    normalizeCollectionInput('remove', value),
  )
  if (addInputs.length === 0 && removeInputs.length === 0) {
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  // Names resolve to keys before any item read, so an unknown or ambiguous
  // name fails before the versioned cycle starts. One batched resolution
  // serves both lists; the split below restores each list's own order.
  const serverId = await ensureServerId(deps, signal)
  const resolved = await deps.resolveCollections([...addInputs, ...removeInputs], signal)
  const addKeys = resolved
    .slice(0, addInputs.length)
    .map((target) => requireWritableRefAtServer(target, ['collection'], serverId).key)
  const removeKeys = resolved
    .slice(addInputs.length)
    .map((target) => requireWritableRefAtServer(target, ['collection'], serverId).key)
  return await withItemStateWrite(
    deps,
    localRef,
    signal,
    collectionState,
    async ({ snapshot, serverId: effectiveServerId, resultRef, send }) => {
      const { merged, added, removed, changed } = mergeList(
        snapshot.collectionKeys,
        removeKeys,
        addKeys,
      )
      const toRefs = (keys: readonly string[]): string[] =>
        keys.map((key) => collectionRef(key, effectiveServerId))
      if (!changed) {
        return {
          kind: 'applied',
          ref: resultRef,
          version: snapshot.version,
          collections: toRefs(merged),
          added: [],
          removed: [],
          unchanged: true,
          serverId: effectiveServerId,
        }
      }
      const { libraryVersion } = await send({ collections: merged })
      return {
        kind: 'applied',
        ref: resultRef,
        version: libraryVersion,
        collections: toRefs(merged),
        added: toRefs(added),
        removed: toRefs(removed),
        unchanged: false,
        libraryVersion,
        serverId: effectiveServerId,
      }
    },
  )
}

/**
 * Refuse a create whose sibling already carries the target name. Reads the
 * sibling listing fresh (no directory cache) of the parent's children, or of
 * the top-level collections, and throws on the first match, so the pages
 * after it are never fetched. The read runs to the honest total, because a
 * check that stopped at the first page would let a duplicate beyond it slip
 * through, which is exactly the ambiguity this check exists to prevent.
 */
async function assertNoSiblingWithName(
  deps: WriteDomainDeps,
  name: string,
  parentKey: string | undefined,
  serverId: string,
  signal?: AbortSignal,
): Promise<void> {
  const listPath =
    parentKey === undefined
      ? `${libraryPrefix(PERSONAL_LIBRARY)}/collections/top`
      : `${libraryPrefix(PERSONAL_LIBRARY)}/collections/${parentKey}/collections`
  await readAllPages(
    deps.client,
    listPath,
    {},
    serverId,
    signal,
    { body: 'the collections listing', page: 'sibling collections' },
    undefined,
    (rows) => {
      for (const row of rows) {
        const record = asRecord(row)
        const key = asString(record?.key)
        const rowName = asString(asRecord(record?.data)?.name)
        if (key === undefined || !isObjectKey(key) || rowName === undefined) {
          throw new ZoteroError(
            'Zotero returned a malformed collection row in the sibling listing',
            ZOTERO_UNEXPECTED,
          )
        }
        if (rowName === name) {
          throw new ZoteroError(writeCollectionNameExistsMessage(name), ZOTERO_INVALID_ARGUMENT)
        }
      }
    },
  )
}

/**
 * Create a collection, optionally under a parent. A sibling that already
 * carries the name refuses the write before any POST: creating a second
 * same-named sibling would only manufacture resolution ambiguity.
 */
export async function createCollection(
  deps: WriteDomainDeps,
  request: ZoteroCreateCollectionRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateCollectionCommittedOutcome> {
  const name = requireNonBlank('name', request.name)
  const parentInput =
    request.parent === undefined ? undefined : normalizeCollectionInput('parent', request.parent)
  const serverId = await ensureServerId(deps, signal)
  const parent =
    parentInput === undefined
      ? undefined
      : requireWritableRefAtServer(
          await deps.resolveCollection(parentInput, signal),
          ['collection'],
          serverId,
        )
  const parentKey = parent?.key
  await assertNoSiblingWithName(deps, name, parentKey, serverId, signal)
  const entry: Record<string, unknown> = {
    name,
    ...(parentKey !== undefined ? { parentCollection: parentKey } : {}),
  }
  const created = await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const batch = await sendSingleCreate(
      deps,
      `${libraryPrefix(PERSONAL_LIBRARY)}/collections`,
      entry,
      serverId,
      apiKey,
      signal,
    )
    if ('commitUnknown' in batch) {
      return committedUnverified({
        kind: 'collection',
        serverId,
        reason: 'commit-unknown',
      })
    }
    const proven = (data: Record<string, unknown>): string | undefined => {
      if (asString(data.name) !== name) return undefined
      // Zotero echoes no parent key for top-level collections, so both sides
      // normalize to undefined there; any other mismatch between the
      // requested and the echoed parent leaves the saved state unproven.
      const savedParent = asString(data.parentCollection)
      return (parentKey ?? undefined) === (savedParent ?? undefined) ? name : undefined
    }
    const settled = settleSingleEntryBatch(batch, 'collection', serverId, proven)
    if (settled.status === 'unverified') return settled.result
    const { key, version } = settled.entry
    return {
      kind: 'applied' as const,
      ref: collectionRef(key, serverId),
      key,
      version,
      name,
      ...(parentKey !== undefined ? { parentRef: collectionRef(parentKey, serverId) } : {}),
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
  if (created.key !== undefined) {
    deps.onCollectionsChanged?.()
  }
  return created
}

/**
 * Delete a collection by ref or name. One collection read serves both the
 * existence proof and the library-version precondition, so any concurrent
 * write fails the delete instead of slipping past it. A ref input skips name
 * resolution entirely, because the read itself proves the ref; a name input
 * resolves first, because ambiguity is a pre-read refusal. Entries keep
 * their items (membership only); child collections go with the parent, per
 * Zotero semantics.
 */
export async function deleteCollection(
  deps: WriteDomainDeps,
  request: ZoteroDeleteCollectionRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteCollectionResult> {
  const input = normalizeCollectionInput('collection', request.collection)
  const serverId = await ensureServerId(deps, signal)
  const checked = isRefString(input)
    ? requireWritableRefAtServer(parseRef(input), ['collection'], serverId)
    : requireWritableRefAtServer(
        await deps.resolveCollection(input, signal),
        ['collection'],
        serverId,
      )
  const read = await readRecordForWrite(deps, 'collection', checked.key, serverId, signal)
  const effectiveServerId = read.serverId
  const precondition = requireLibraryVersion(read.libraryVersion)
  const resultRef = collectionRef(checked.key, effectiveServerId)
  const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => {
    try {
      return await deps.writer.delete(
        `${libraryPrefix(PERSONAL_LIBRARY)}/collections/${checked.key}`,
        { serverId: effectiveServerId, apiKey, ifUnmodifiedSinceVersion: precondition, signal },
      )
    } catch (error) {
      if (error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND) {
        throw new ZoteroError(
          writeObjectRefusedMessage('The collection no longer exists.', 404),
          ZOTERO_NOT_FOUND,
        )
      }
      throw error
    }
  })
  deps.onCollectionsChanged?.()
  return {
    kind: 'deleted',
    ref: resultRef,
    key: checked.key,
    deleted: true,
    libraryVersion,
    serverId: effectiveServerId,
  }
}

/** Rename/reparent one collection under its object version precondition. */
export async function updateCollection(
  deps: WriteDomainDeps,
  request: ZoteroUpdateCollectionRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateCollectionResult> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(request.collection, ['collection'], serverId)
  if (request.name === undefined && request.parent === undefined) {
    throw new ZoteroError(
      'At least one of name or parent must be provided.',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const { version } = await readRecordForWrite(deps, 'collection', ref.key, serverId, signal)
  const patch: Record<string, unknown> = {}
  if (request.name !== undefined) patch.name = requireNonBlank('name', request.name)
  if (request.parent !== undefined) {
    if (request.parent === null) patch.parentCollection = false
    else {
      const parent = requireWritableRefAtServer(request.parent, ['collection'], serverId)
      patch.parentCollection = parent.key
    }
  }
  const { libraryVersion } = await withWriteKey(deps, serverId, signal, async (apiKey) =>
    deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/collections/${ref.key}`, patch, {
      serverId,
      apiKey,
      ifUnmodifiedSinceVersion: version,
      signal,
    }),
  )
  deps.onCollectionsChanged?.()
  return {
    kind: 'applied',
    ref: collectionRef(ref.key, serverId),
    version: libraryVersion,
    ...(request.name !== undefined ? { name: requireNonBlank('name', request.name) } : {}),
    ...(request.parent && request.parent !== null ? { parentRef: formatRef(request.parent) } : {}),
    libraryVersion,
    serverId,
  }
}

function savedSearchConditionsOf(
  data: Record<string, unknown>,
): ZoteroSavedSearchCondition[] | undefined {
  if (!Array.isArray(data.conditions)) return undefined
  const out: ZoteroSavedSearchCondition[] = []
  for (const row of data.conditions) {
    const record = asRecord(row)
    const condition = asString(record?.condition)
    const operator = asString(record?.operator)
    const value = asString(record?.value)
    if (condition === undefined || operator === undefined || value === undefined) return undefined
    out.push({ condition, operator, value })
  }
  return out
}

export async function createSavedSearch(
  deps: WriteDomainDeps,
  request: ZoteroCreateSavedSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroSavedSearchResult | ZoteroWriteCommittedUnverified> {
  const name = requireNonBlank('name', request.name)
  if (request.conditions.length === 0)
    throw new ZoteroError('conditions cannot be empty.', ZOTERO_INVALID_ARGUMENT)
  const serverId = await ensureServerId(deps, signal)
  const entry = { name, conditions: request.conditions }
  return await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const batch = await sendSingleCreate(
      deps,
      `${libraryPrefix(PERSONAL_LIBRARY)}/searches`,
      entry,
      serverId,
      apiKey,
      signal,
    )
    if ('commitUnknown' in batch) {
      return committedUnverified({
        kind: 'search',
        serverId,
        reason: 'commit-unknown',
      })
    }
    const settled = settleSingleEntryBatch(batch, 'search', serverId, (data) => {
      const savedName = asString(data.name)
      const conditions = savedSearchConditionsOf(data)
      return savedName === name && conditions !== undefined ? { savedName, conditions } : undefined
    })
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: searchRef(key, serverId),
      key,
      version,
      name: payload.savedName,
      conditions: payload.conditions,
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
}

export async function updateSavedSearch(
  deps: WriteDomainDeps,
  request: ZoteroUpdateSavedSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroSavedSearchResult> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(request.search, ['search'], serverId)
  if (request.name === undefined && request.conditions === undefined)
    throw new ZoteroError(
      'At least one of name or conditions must be provided.',
      ZOTERO_INVALID_ARGUMENT,
    )
  const { data, version } = await readRecordForWrite(deps, 'search', ref.key, serverId, signal)
  const patch: Record<string, unknown> = {}
  if (request.name !== undefined) patch.name = requireNonBlank('name', request.name)
  if (request.conditions !== undefined) patch.conditions = request.conditions
  const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
    deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/searches/${ref.key}`, patch, {
      serverId,
      apiKey,
      ifUnmodifiedSinceVersion: version,
      signal,
    }),
  )
  const name = request.name ?? asString(data?.name) ?? ''
  const conditions = request.conditions ?? savedSearchConditionsOf(data ?? {}) ?? []
  return {
    kind: 'applied',
    ref: searchRef(ref.key, serverId),
    key: ref.key,
    version: libraryVersion,
    name,
    conditions,
    libraryVersion,
    serverId,
  }
}

export async function deleteSavedSearch(
  deps: WriteDomainDeps,
  request: ZoteroDeleteSavedSearchRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteSavedSearchResult> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(request.search, ['search'], serverId)
  const read = await readRecordForWrite(deps, 'search', ref.key, serverId, signal)
  const effectiveServerId = read.serverId
  const precondition = requireLibraryVersion(read.libraryVersion)
  const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, (apiKey) =>
    deps.writer.delete(`${libraryPrefix(PERSONAL_LIBRARY)}/searches/${ref.key}`, {
      serverId: effectiveServerId,
      apiKey,
      ifUnmodifiedSinceVersion: precondition,
      signal,
    }),
  )
  return {
    kind: 'deleted',
    ref: searchRef(ref.key, effectiveServerId),
    key: ref.key,
    deleted: true,
    libraryVersion,
    serverId: effectiveServerId,
  }
}

/**
 * Create a bibliographic item from the closed field set. No BibTeX/CSL-JSON
 * channel exists: `POST /items` only accepts Zotero item JSON, so the entry
 * is assembled field-by-field and anything outside the set never leaves this
 * module.
 */
export async function createItem(
  deps: WriteDomainDeps,
  request: ZoteroCreateItemRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateItemCommittedOutcome> {
  const itemType = requireCreatableItemType(requireNonBlank('itemType', request.itemType))
  const title = request.title?.trim() ?? ''
  const url = request.url?.trim() ?? ''
  requireTitleOrUrl(title, url)
  const date = request.date?.trim() ?? ''
  const doi = request.doi?.trim() ?? ''
  const abstractNote = request.abstractNote?.trim() ?? ''
  const publicationTitle = request.publicationTitle?.trim() ?? ''
  const creators = (request.creators ?? []).map((creator, index) =>
    normalizeCreator(creator, index),
  )
  const serverId = await ensureServerId(deps, signal)
  const tags = normalizeWriteList('tags', request.tags ?? [])
  const collectionInputs = (request.collections ?? []).map((value) =>
    typeof value === 'string' ? normalizeCollectionInput('collection', value) : formatRef(value),
  )
  const collectionRefs =
    collectionInputs.length > 0 ? await deps.resolveCollections(collectionInputs, signal) : []
  for (const ref of collectionRefs) requireWritableRefAtServer(ref, ['collection'], serverId)
  const entry: Record<string, unknown> = {
    itemType,
    ...(title !== '' ? { title } : {}),
    ...(url !== '' ? { url } : {}),
    ...(date !== '' ? { date } : {}),
    ...(doi !== '' ? { DOI: doi } : {}),
    ...(abstractNote !== '' ? { abstractNote } : {}),
    ...(publicationTitle !== '' ? { publicationTitle } : {}),
    ...(creators.length > 0 ? { creators } : {}),
    ...(tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : {}),
    ...(collectionRefs.length > 0 ? { collections: collectionRefs.map((ref) => ref.key) } : {}),
  }
  return await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const batch = await sendSingleCreate(
      deps,
      `${libraryPrefix(PERSONAL_LIBRARY)}/items`,
      entry,
      serverId,
      apiKey,
      signal,
    )
    if ('commitUnknown' in batch) {
      return committedUnverified({
        kind: 'item',
        serverId,
        reason: 'commit-unknown',
      })
    }
    const proven = (
      data: Record<string, unknown>,
    ):
      | { savedTitle: string | undefined; savedTags: string[]; savedCollections: string[] }
      | undefined => {
      if (asString(data.itemType) !== itemType) return undefined
      const savedTags = tagsOf(data)
      const savedCollections = strictCollectionKeysOf(data)
      if (savedTags === undefined || savedCollections === undefined) return undefined
      return {
        savedTitle: asString(data.title),
        savedTags: savedTags.map((entry) => entry.tag),
        savedCollections: savedCollections.map((key) => collectionRef(key, serverId)),
      }
    }
    const settled = settleSingleEntryBatch(batch, 'item', serverId, proven)
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: itemRef(key, serverId),
      key,
      version,
      itemType,
      ...(payload.savedTitle !== undefined
        ? { title: payload.savedTitle }
        : title !== ''
          ? { title }
          : {}),
      tags: payload.savedTags,
      collections: payload.savedCollections,
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
}

/**
 * Fetch the field names one item type accepts. Uncached by design: the
 * provider wraps this with the per-(instance, item type) memo and injects it
 * as {@link WriteDomainDeps.itemTypeFields}. The field set is static for a
 * running build, but each Zotero instance may speak its own schema.
 */
export async function fetchItemTypeFields(
  deps: Pick<WriteDomainDeps, 'client'>,
  itemType: string,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  const params = new URLSearchParams()
  params.set('itemType', itemType)
  const { json } = await deps.client.getJson<unknown>('itemTypeFields', params, { signal })
  if (!Array.isArray(json)) {
    throw new ZoteroError(
      `Zotero answered the item-type fields without a valid array; a safe field check is impossible.`,
      ZOTERO_UNEXPECTED,
    )
  }
  const valid = new Set<string>()
  for (const row of json) {
    const field = asString(asRecord(row)?.field)
    if (field !== undefined) valid.add(field)
  }
  return valid
}

/**
 * Update one item's scalar metadata. Every requested field must belong to the
 * closed set and be valid for the item's own type (checked against the
 * injected `itemTypeFields` reader); the PATCH then carries only wire names
 * under the version precondition. `creators`, `itemType`, `tags`, and
 * `collections` have their own tools and never enter here.
 */
export async function updateItem(
  deps: WriteDomainDeps,
  request: ZoteroUpdateItemRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateItemResult> {
  const localRef = requireWritableRef(request.item, ['item'])
  const updates = validateItemUpdateFields(request.set)
  return await withItemWrite(
    deps,
    localRef,
    signal,
    async ({ snapshot, serverId, resultRef, send }) => {
      const valid = await deps.itemTypeFields(snapshot.itemType, signal)
      const patch: Record<string, string> = {}
      const changed: string[] = []
      for (const [field, value] of updates) {
        const wire = wireFieldOf(field)
        if (!valid.has(wire)) {
          throw new ZoteroError(
            writeFieldNotForItemTypeMessage(field, snapshot.itemType),
            ZOTERO_INVALID_ARGUMENT,
          )
        }
        patch[wire] = value
        changed.push(field)
      }
      changed.sort()
      const { libraryVersion } = await send(patch)
      return {
        kind: 'applied',
        ref: resultRef,
        version: libraryVersion,
        changed,
        libraryVersion,
        serverId,
      }
    },
  )
}

/** Update a note body as markdown, converted to Zotero's safe note HTML. */
export async function updateNote(
  deps: WriteDomainDeps,
  request: ZoteroUpdateNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateNoteResult> {
  const markdown = requireNonBlank('markdown', request.markdown)
  const localRef = requireWritableRef(request.item, ['item'])
  return await withItemWrite(
    deps,
    localRef,
    signal,
    async ({ snapshot, serverId, resultRef, send }) => {
      if (snapshot.itemType !== 'note') {
        throw new ZoteroError('The target item is not a Zotero note.', ZOTERO_INVALID_ARGUMENT)
      }
      const { libraryVersion } = await send({ note: markdownToNoteHtml(markdown) })
      return { kind: 'applied', ref: resultRef, version: libraryVersion, libraryVersion, serverId }
    },
  )
}

/** Restore trashed items by setting Zotero's deleted flag back to zero. */
export async function restoreItems(
  deps: WriteDomainDeps,
  request: ZoteroRestoreItemsRequest,
  signal?: AbortSignal,
): Promise<ZoteroRestoreItemsResult> {
  if (request.items.length === 0)
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  if (request.items.length > ZOTERO_WRITE_OBJECT_BATCH)
    throw new ZoteroError(
      writeListTooLongMessage('restore items', ZOTERO_WRITE_OBJECT_BATCH),
      ZOTERO_INVALID_ARGUMENT,
    )
  const restored: ZoteroRestoreItemsResult['restored'] = []
  const failed: ZoteroBatchOperationFailure[] = []
  const serverId = await ensureServerId(deps, signal)
  for (const item of request.items) {
    try {
      const ref = requireWritableRefAtServer(item, ['item'], serverId)
      const result = await withItemWrite(
        deps,
        ref,
        signal,
        async ({ serverId: effective, resultRef, send }) => {
          const { libraryVersion } = await send({ deleted: 0 })
          return {
            ref: resultRef,
            restored: true as const,
            version: libraryVersion,
            libraryVersion,
            serverId: effective,
          }
        },
      )
      restored.push(result)
    } catch (error) {
      if (!(error instanceof ZoteroError)) throw error
      failed.push({ op: 'update', ref: formatRef(item), code: error.code, message: error.message })
    }
  }
  return { kind: 'restored', restored, failed, serverId }
}

/**
 * The library-wide tags delete path: `DELETE users/0/tags?tag=<enc1>||<enc2>`.
 * Each name is encoded on its own so the `||` separator survives intact.
 */
function tagsDeletePath(tags: readonly string[]): string {
  return `${libraryPrefix(PERSONAL_LIBRARY)}/tags?tag=${tags
    .map((name) => encodeURIComponent(name))
    .join('||')}`
}

/**
 * Delete tags library-wide. Names are idempotent (Zotero silently ignores
 * unknown names), the precondition is the library version of a preceding
 * read, and any concurrent write fails the delete rather than slipping past
 * it. Irreversible: the plan card must state the blast radius first.
 */
export async function deleteLibraryTags(
  deps: WriteDomainDeps,
  request: ZoteroDeleteLibraryTagsRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteLibraryTagsResult> {
  const tags = normalizeWriteList('tags', request.tags ?? [])
  if (tags.length === 0) {
    throw new ZoteroError(writeListEmptyMessage('tags'), ZOTERO_INVALID_ARGUMENT)
  }
  const serverId = await ensureServerId(deps, signal)
  const { libraryVersion: precondition, serverId: effectiveServerId } = await readLibraryVersion(
    deps,
    serverId,
    signal,
  )
  const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => {
    return await deps.writer.delete(tagsDeletePath(tags), {
      serverId: effectiveServerId,
      apiKey,
      ifUnmodifiedSinceVersion: precondition,
      tagDeleteLimit: true,
      signal,
    })
  })
  return {
    kind: 'deleted',
    deletedTags: [...tags].sort(),
    libraryVersion,
    serverId: effectiveServerId,
  }
}

/**
 * Execute a batch of item operations: creates, updates, and deletes.
 * Operations are bounded by deps.config.writeListMaxItems.
 * Creates land via a single multi-entry POST; updates and deletes run
 * sequentially under per-item version preconditions to avoid concurrency races.
 */
/** One pre-validated batch update: a writable item ref plus its normalized list edits. */
interface CheckedBatchUpdate {
  readonly ref: ZoteroObjectRef
  readonly addTags: string[]
  readonly removeTags: string[]
  readonly addColInputs: string[]
  readonly removeColInputs: string[]
}

/** One pre-validated batch create: the closed field set the wire entry is built from. */
interface CheckedBatchCreate {
  readonly itemType: string
  readonly title: string | undefined
  readonly url: string | undefined
  readonly date: string | undefined
  readonly doi: string | undefined
  readonly abstractNote: string | undefined
  readonly publicationTitle: string | undefined
  readonly creators: ReturnType<typeof normalizeCreator>[] | undefined
  readonly tags: string[]
  readonly colInputs: string[]
}

function prevalidateBatchDeletes(
  deletes: readonly NonNullable<ZoteroBatchItemsRequest['delete']>[number][],
  serverId: string,
): ZoteroObjectRef[] {
  return deletes.map((ref) => {
    const writable = requireWritableRef(ref, ['item'])
    return requireWritableRefAtServer(writable, ['item'], serverId)
  })
}

function prevalidateBatchUpdates(
  updates: readonly NonNullable<ZoteroBatchItemsRequest['update']>[number][],
  serverId: string,
): CheckedBatchUpdate[] {
  return updates.map((u) => {
    const writable = requireWritableRef(u.ref, ['item'])
    const ref = requireWritableRefAtServer(writable, ['item'], serverId)
    const addTags = normalizeWriteList('addTags', u.addTags ?? [])
    const removeTags = normalizeWriteList('removeTags', u.removeTags ?? [])
    const addColInputs = (u.addCollections ?? []).map((c) =>
      typeof c === 'string' ? normalizeCollectionInput('addCollections', c) : formatRef(c),
    )
    const removeColInputs = (u.removeCollections ?? []).map((c) =>
      typeof c === 'string' ? normalizeCollectionInput('removeCollections', c) : formatRef(c),
    )
    if (
      addTags.length === 0 &&
      removeTags.length === 0 &&
      addColInputs.length === 0 &&
      removeColInputs.length === 0
    ) {
      throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
    }
    return {
      ref,
      addTags,
      removeTags,
      addColInputs,
      removeColInputs,
    }
  })
}

function prevalidateBatchCreates(
  creates: readonly NonNullable<ZoteroBatchItemsRequest['create']>[number][],
): CheckedBatchCreate[] {
  return creates.map((c) => {
    const itemType = requireCreatableItemType(requireNonBlank('itemType', c.itemType))
    const title = c.title?.trim() ?? ''
    const url = c.url?.trim() ?? ''
    requireTitleOrUrl(title, url)
    const tags = normalizeWriteList('tags', c.tags ?? [])
    const colInputs = (c.collections ?? []).map((col) =>
      typeof col === 'string' ? normalizeCollectionInput('collections', col) : formatRef(col),
    )
    const creators = (c.creators ?? []).map((cr, idx) => normalizeCreator(cr, idx))
    return {
      itemType,
      title: title !== '' ? title : undefined,
      url: url !== '' ? url : undefined,
      date: c.date?.trim() || undefined,
      doi: c.doi?.trim() || undefined,
      abstractNote: c.abstractNote?.trim() || undefined,
      publicationTitle: c.publicationTitle?.trim() || undefined,
      creators: creators.length > 0 ? creators : undefined,
      tags,
      colInputs,
    }
  })
}

/**
 * Resolve every collection referenced across the batch's creates and updates
 * in one request set, keyed by the input spelling the rows carry.
 */
async function resolveBatchCollections(
  deps: WriteDomainDeps,
  checkedCreates: readonly CheckedBatchCreate[],
  checkedUpdates: readonly CheckedBatchUpdate[],
  serverId: string,
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const allColInputs = [
    ...checkedCreates.flatMap((c) => c.colInputs),
    ...checkedUpdates.flatMap((u) => [...u.addColInputs, ...u.removeColInputs]),
  ]
  const uniqueColInputs = [...new Set(allColInputs)]
  const resolvedColsMap = new Map<string, string>()
  if (uniqueColInputs.length > 0) {
    const resolved = await deps.resolveCollections(uniqueColInputs, signal)
    for (let i = 0; i < uniqueColInputs.length; i++) {
      const key = requireWritableRefAtServer(resolved[i], ['collection'], serverId).key
      resolvedColsMap.set(uniqueColInputs[i], key)
    }
  }
  return resolvedColsMap
}

/**
 * Phase 1: send the creates as one native POST batch and settle its buckets.
 * Fills `created`/`unverified`/`failed`; returns the library version the
 * batch advanced to, or undefined when the batch could not be sent.
 */
async function runBatchCreates(
  deps: WriteDomainDeps,
  checkedCreates: readonly CheckedBatchCreate[],
  resolvedColsMap: ReadonlyMap<string, string>,
  serverId: string,
  signal: AbortSignal | undefined,
  created: ZoteroBatchCreateItemResult[],
  unverified: ZoteroBatchCreateUnverified[],
  failed: ZoteroBatchOperationFailure[],
): Promise<number | undefined> {
  if (checkedCreates.length === 0) return undefined
  const entries = checkedCreates.map((c) => {
    const colKeys = c.colInputs
      .map((input) => resolvedColsMap.get(input))
      .filter((k): k is string => k !== undefined)
    return {
      itemType: c.itemType,
      ...(c.title !== undefined ? { title: c.title } : {}),
      ...(c.url !== undefined ? { url: c.url } : {}),
      ...(c.date !== undefined ? { date: c.date } : {}),
      ...(c.doi !== undefined ? { DOI: c.doi } : {}),
      ...(c.abstractNote !== undefined ? { abstractNote: c.abstractNote } : {}),
      ...(c.publicationTitle !== undefined ? { publicationTitle: c.publicationTitle } : {}),
      ...(c.creators !== undefined ? { creators: c.creators } : {}),
      ...(c.tags.length > 0 ? { tags: c.tags.map((tag) => ({ tag })) } : {}),
      ...(colKeys.length > 0 ? { collections: colKeys } : {}),
    }
  })

  try {
    const batch = await withWriteKey(deps, serverId, signal, (apiKey) =>
      deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/items`, entries, {
        serverId,
        apiKey,
        signal,
      }),
    )
    const libraryVersion = batch.libraryVersion
    settleBatchCreates(batch, checkedCreates, serverId, created, unverified, failed)
    return libraryVersion
  } catch (err) {
    if (isWriteUnauthorized(err)) throw err
    if (err instanceof ZoteroWriteCommitUnknownError) {
      for (let i = 0; i < checkedCreates.length; i++) {
        unverified.push(batchCreateUnverified(i, 'commit-unknown', serverId))
      }
    } else {
      signal?.throwIfAborted()
      for (let i = 0; i < checkedCreates.length; i++) {
        failed.push({
          op: 'create',
          index: i,
          code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return undefined
}

/**
 * Phase 2: sequential read-modify-write per update. Fills `updated`/`failed`;
 * returns the last library version an applied update advanced to.
 */
async function runBatchUpdates(
  deps: WriteDomainDeps,
  checkedUpdates: readonly CheckedBatchUpdate[],
  resolvedColsMap: ReadonlyMap<string, string>,
  serverId: string,
  signal: AbortSignal | undefined,
  updated: ZoteroBatchUpdateItemResult[],
  failed: ZoteroBatchOperationFailure[],
): Promise<number | undefined> {
  let lastLibraryVersion: number | undefined
  for (const u of checkedUpdates) {
    try {
      const wantsTags = u.addTags.length > 0 || u.removeTags.length > 0
      const wantsCollections = u.addColInputs.length > 0 || u.removeColInputs.length > 0
      // Only the lists this update touches are required to be present; the
      // plan reads the same fields back and never re-derives the condition.
      const readUpdateState = (data: Record<string, unknown>) => ({
        tags: wantsTags ? tagState(data).tags : undefined,
        collectionKeys: wantsCollections ? collectionState(data).collectionKeys : undefined,
      })
      const res = await withItemStateWrite(
        deps,
        u.ref,
        signal,
        readUpdateState,
        async ({ snapshot, serverId: effServerId, resultRef, send }) => {
          let tagsChanged = false
          let nextTags = snapshot.tags
          let addedTags: string[] = []
          let removedTags: string[] = []
          if (snapshot.tags !== undefined) {
            const merged = mergeTagList(snapshot.tags, u.removeTags, u.addTags)
            tagsChanged = merged.changed
            nextTags = merged.merged
            addedTags = merged.added
            removedTags = merged.removed
          }

          let colsChanged = false
          let nextColKeys = snapshot.collectionKeys
          let addedCols: string[] = []
          let removedCols: string[] = []
          if (snapshot.collectionKeys !== undefined) {
            const addKeys = u.addColInputs
              .map((input) => resolvedColsMap.get(input))
              .filter((k): k is string => k !== undefined)
            const removeKeys = u.removeColInputs
              .map((input) => resolvedColsMap.get(input))
              .filter((k): k is string => k !== undefined)
            const mergedCols = mergeList(snapshot.collectionKeys, removeKeys, addKeys)
            colsChanged = mergedCols.changed
            nextColKeys = mergedCols.merged
            addedCols = mergedCols.added
            removedCols = mergedCols.removed
          }

          const changed = tagsChanged || colsChanged
          if (!changed) {
            return {
              ref: resultRef,
              version: snapshot.version,
              addedTags: [],
              removedTags: [],
              addedCollections: [],
              removedCollections: [],
              unchanged: true,
            }
          }

          const patchBody: Record<string, unknown> = {}
          if (tagsChanged) patchBody.tags = nextTags
          if (colsChanged) patchBody.collections = nextColKeys

          const { libraryVersion } = await send(patchBody)
          lastLibraryVersion = libraryVersion
          return {
            ref: resultRef,
            version: libraryVersion,
            addedTags,
            removedTags,
            addedCollections: addedCols.map((k) => collectionRef(k, effServerId)),
            removedCollections: removedCols.map((k) => collectionRef(k, effServerId)),
            unchanged: false,
          }
        },
      )
      updated.push(res)
    } catch (err) {
      failed.push({
        op: 'update',
        ref: itemRef(u.ref.key, serverId),
        code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return lastLibraryVersion
}

/**
 * Phase 3: move complete item graphs to Trash under object versions. Fills
 * `deleted`/`failed`; returns the last library version a Trash write
 * advanced to.
 */
async function runBatchDeletes(
  deps: WriteDomainDeps,
  checkedDeletes: readonly ZoteroObjectRef[],
  serverId: string,
  signal: AbortSignal | undefined,
  deleted: ZoteroBatchDeleteItemResult[],
  failed: ZoteroBatchOperationFailure[],
): Promise<number | undefined> {
  let lastLibraryVersion: number | undefined
  for (const delRef of checkedDeletes) {
    const completedRefs: string[] = []
    try {
      const graph = await readTrashGraph(deps.client, delRef.key, serverId, signal)
      for (const node of graph) {
        if (node.deleted) continue
        const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
          deps.writer.patch(
            `${libraryPrefix(PERSONAL_LIBRARY)}/items/${node.key}`,
            { deleted: 1 },
            {
              serverId,
              apiKey,
              ifUnmodifiedSinceVersion: node.version,
              signal,
            },
          ),
        )
        lastLibraryVersion = libraryVersion
        completedRefs.push(itemRef(node.key, serverId))
      }
      const saved = await readTrashGraph(deps.client, delRef.key, serverId, signal)
      const keys = new Set(graph.map((node) => node.key))
      if (
        saved.length !== graph.length ||
        saved.some((node) => !node.deleted || !keys.has(node.key))
      ) {
        throw new ZoteroError(
          `Zotero did not verify the complete graph for ${delRef.key} in Trash. Check the completed refs before further action.`,
          ZOTERO_UNEXPECTED,
        )
      }
      const version = saved[saved.length - 1].version
      deleted.push({
        ref: itemRef(delRef.key, serverId),
        key: delRef.key,
        deleted: true,
        version,
        children: graph
          .filter((node) => node.key !== delRef.key)
          .map((node) => itemRef(node.key, serverId)),
      })
    } catch (err) {
      failed.push({
        op: 'delete',
        ref: itemRef(delRef.key, serverId),
        code: err instanceof ZoteroError ? err.code : ZOTERO_UNEXPECTED,
        message: err instanceof Error ? err.message : String(err),
        ...(completedRefs.length > 0 ? { completedRefs } : {}),
      })
    }
  }
  return lastLibraryVersion
}

export async function batchItems(
  deps: WriteDomainDeps,
  request: ZoteroBatchItemsRequest,
  signal?: AbortSignal,
): Promise<ZoteroBatchItemsResult> {
  const creates = request.create ?? []
  const updates = request.update ?? []
  const deletes = request.delete ?? []
  const total = creates.length + updates.length + deletes.length

  if (total === 0) {
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  if (total > ZOTERO_WRITE_OBJECT_BATCH) {
    throw new ZoteroError(
      writeListTooLongMessage('batch items', ZOTERO_WRITE_OBJECT_BATCH),
      ZOTERO_INVALID_ARGUMENT,
    )
  }

  const serverId = await ensureServerId(deps, signal)

  const checkedDeletes = prevalidateBatchDeletes(deletes, serverId)
  const checkedUpdates = prevalidateBatchUpdates(updates, serverId)
  const checkedCreates = prevalidateBatchCreates(creates)
  const resolvedColsMap = await resolveBatchCollections(
    deps,
    checkedCreates,
    checkedUpdates,
    serverId,
    signal,
  )

  const createdResults: ZoteroBatchCreateItemResult[] = []
  const updatedResults: ZoteroBatchUpdateItemResult[] = []
  const deletedResults: ZoteroBatchDeleteItemResult[] = []
  const unverifiedResults: ZoteroBatchCreateUnverified[] = []
  const failedResults: ZoteroBatchOperationFailure[] = []
  let latestLibraryVersion: number | undefined
  const versions = [
    await runBatchCreates(
      deps,
      checkedCreates,
      resolvedColsMap,
      serverId,
      signal,
      createdResults,
      unverifiedResults,
      failedResults,
    ),
    await runBatchUpdates(
      deps,
      checkedUpdates,
      resolvedColsMap,
      serverId,
      signal,
      updatedResults,
      failedResults,
    ),
    await runBatchDeletes(deps, checkedDeletes, serverId, signal, deletedResults, failedResults),
  ]
  for (const version of versions) {
    if (version !== undefined) latestLibraryVersion = version
  }

  return {
    kind: 'applied',
    total,
    created: createdResults,
    updated: updatedResults,
    deleted: deletedResults,
    unverified: unverifiedResults,
    failed: failedResults,
    ...(latestLibraryVersion !== undefined ? { libraryVersion: latestLibraryVersion } : {}),
    serverId,
  }
}

/**
 * The typed error a write-capability-less provider raises. It is unreachable
 * through the service's capability gate, but the direct-provider contract
 * fails with the same code instead of crashing.
 */
export function writeCapabilityUnavailableMessage(providerId: string): string {
  return `Zotero provider "${providerId}" does not support the write capability.`
}
